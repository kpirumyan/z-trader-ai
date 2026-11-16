// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTraceId, LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { describe, expect, it } from "vitest";

import {
  advanceCursorForTurns,
  getSpoolFilePath,
  listSpoolFiles,
  mergeTurnsForExport,
  readCursorState,
  readPendingSpool,
  readSpoolEntry,
  removeSpoolFile,
  resolveSpoolDir,
  runSessionStartHook,
  runStopHook,
  writeCursorState,
  writePendingSpool,
  type ParsedTurnTrace,
} from "../index.ts";

function buildTranscriptLines(prompt: string, response: string, createdAtBase: string): string {
  return [
    JSON.stringify({
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: `${createdAtBase}00Z`,
      content: `<USER_REQUEST>\n${prompt}\n</USER_REQUEST>`,
    }),
    JSON.stringify({
      step_index: 1,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: `${createdAtBase}02Z`,
      input_tokens: 100,
      output_tokens: 20,
      content: response,
    }),
  ].join("\n");
}

describe("spool: cursor, write-ahead spool, and cross-session Maildir draining", () => {
  it("resolves spool directory across Antigravity brain paths and temp test layouts", () => {
    const antigravityTranscript = path.join(
      "C:",
      "Users",
      "Dev",
      ".gemini",
      "antigravity",
      "brain",
      "conv-123",
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );

    expect(resolveSpoolDir({ transcriptPath: antigravityTranscript })).toBe(
      path.join("C:", "Users", "Dev", ".gemini", "antigravity", "brain", ".langfuse-spool"),
    );

    const antigravityArtifact = path.join(
      "C:",
      "Users",
      "Dev",
      ".gemini",
      "antigravity",
      "brain",
      "conv-456",
    );

    expect(resolveSpoolDir({ artifactDirectoryPath: antigravityArtifact })).toBe(
      path.join("C:", "Users", "Dev", ".gemini", "antigravity", "brain", ".langfuse-spool"),
    );

    expect(resolveSpoolDir({ homeDir: "/home/dev" })).toBe(
      path.join("/home/dev", ".gemini", "antigravity", "brain", ".langfuse-spool"),
    );
  });

  it("reads, writes, and merges cursor state and pending spool turns", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-spool-unit-"));

    try {
      const cursorPath = path.join(tempDir, ".langfuse-cursor.json");
      const spoolDir = path.join(tempDir, ".langfuse-spool");
      const spoolPath = getSpoolFilePath(spoolDir, "conv-1");

      expect(readCursorState(cursorPath)).toBeNull();
      expect(readPendingSpool(spoolPath)).toEqual([]);
      expect(listSpoolFiles(spoolDir)).toEqual([]);

      writeCursorState(cursorPath, {
        lastExportedStepIndex: 10,
        lastExportedTurnIndex: 2,
        updatedAt: "2026-11-11T19:00:00.000Z",
      });

      expect(readCursorState(cursorPath)).toEqual({
        lastExportedStepIndex: 10,
        lastExportedTurnIndex: 2,
        updatedAt: "2026-11-11T19:00:00.000Z",
      });

      const sampleTurn: ParsedTurnTrace = {
        turnIndex: 1,
        traceSeed: "conv-1-turn-1",
        traceName: "agent-turn",
        sessionId: "conv-1",
        startStepIndex: 0,
        endStepIndex: 2,
        endLineIndex: 2,
        startTime: new Date("2026-11-11T19:00:00.000Z"),
        endTime: new Date("2026-11-11T19:00:05.000Z"),
        input: "Prompt 1",
        output: "Output 1",
        children: [],
        usageSummary: { input: 10, output: 5, cacheReadInputTokens: 0, total: 15 },
        tags: [],
        metadata: {},
      };

      advanceCursorForTurns(cursorPath, [sampleTurn]);
      expect(readCursorState(cursorPath)?.lastExportedStepIndex).toBe(10);
      expect(readCursorState(cursorPath)?.lastExportedLineIndex).toBe(2);

      writePendingSpool(spoolPath, [sampleTurn], {
        conversationId: "conv-1",
        cursorPath,
      });

      expect(listSpoolFiles(spoolDir)).toEqual([spoolPath]);

      const entry = readSpoolEntry(spoolPath);

      expect(entry?.conversationId).toBe("conv-1");
      expect(entry?.cursorPath).toBe(cursorPath);

      const rehydrated = readPendingSpool(spoolPath);

      expect(rehydrated).toHaveLength(1);
      expect(rehydrated[0]!.startTime).toBeInstanceOf(Date);

      const merged = mergeTurnsForExport(rehydrated, [
        { ...sampleTurn, output: "Updated Output 1" },
        { ...sampleTurn, turnIndex: 2, traceSeed: "conv-1-turn-2" },
      ]);

      expect(merged).toHaveLength(2);
      expect(merged[0]!.output).toBe("Updated Output 1");
      expect(merged[1]!.turnIndex).toBe(2);

      expect(removeSpoolFile(spoolPath)).toBe(true);
      expect(removeSpoolFile(spoolPath)).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("spools failed Stop exports to brain/.langfuse-spool/<convId>.json and drains via SessionStart days later", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-spool-session-"));

    try {
      const brainDir = path.join(tempDir, "brain");
      const conv1LogsDir = path.join(brainDir, "conv-day-1", ".system_generated", "logs");
      const conv2LogsDir = path.join(brainDir, "conv-day-2", ".system_generated", "logs");

      fs.mkdirSync(conv1LogsDir, { recursive: true });
      fs.mkdirSync(conv2LogsDir, { recursive: true });

      const fullPath1 = path.join(conv1LogsDir, "transcript_full.jsonl");
      const fullPath2 = path.join(conv2LogsDir, "transcript_full.jsonl");

      fs.writeFileSync(
        fullPath1,
        buildTranscriptLines("Day 1 prompt", "Day 1 response", "2026-11-11T19:00:"),
        "utf8",
      );

      const warnings: string[] = [];

      const failResult = await runStopHook(
        {
          conversationId: "conv-day-1",
          transcriptPath: fullPath1,
          modelName: "gemini-4-argon",
          cwd: process.cwd(),
        },
        {
          onWarning: (msg) => warnings.push(msg),
          simulateFlushFailure: new Error("Simulated Langfuse network timeout"),
        },
      );

      expect(failResult.decision).toBe("allow");
      expect(failResult.exportedTurns).toBe(0);
      expect(failResult.spooledTurns).toBe(1);
      expect(warnings.some((w) => w.includes("Simulated Langfuse network timeout"))).toBe(true);

      const spoolDir = path.join(brainDir, ".langfuse-spool");
      const spoolFilePath = path.join(spoolDir, "conv-day-1.json");
      const cursor1Path = path.join(conv1LogsDir, ".langfuse-cursor.json");

      expect(fs.existsSync(spoolFilePath)).toBe(true);
      expect(fs.existsSync(cursor1Path)).toBe(false);

      // Simulate SessionStart failing while still offline: spool file remains intact
      const offlineDrain = await runSessionStartHook(
        {
          conversationId: "conv-day-2",
          transcriptPath: fullPath2,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          onWarning: (msg) => warnings.push(msg),
          simulateFlushFailure: new Error("Still offline"),
        },
      );

      expect(offlineDrain.continue).toBe(true);
      expect(offlineDrain.drainedFiles).toBe(0);
      expect(offlineDrain.failedFiles).toBe(1);
      expect(fs.existsSync(spoolFilePath)).toBe(true);

      // Days later, Antigravity reopens in a completely new conversation (conv-day-2) with working network
      const drainedSpans: Array<{
        name: string;
        traceId: string;
        startTime: [number, number];
        attributes: Record<string, unknown>;
      }> = [];

      const sessionStartResult = await runSessionStartHook(
        {
          conversationId: "conv-day-2",
          transcriptPath: fullPath2,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                drainedSpans.push({
                  name: s.name,
                  traceId: s.spanContext().traceId,
                  startTime: s.startTime,
                  attributes: { ...s.attributes },
                });
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(sessionStartResult.continue).toBe(true);
      expect(sessionStartResult.drainedFiles).toBe(1);
      expect(sessionStartResult.drainedTurns).toBe(1);
      expect(sessionStartResult.failedFiles).toBe(0);

      const expectedTraceId = await createTraceId("conv-day-1-turn-1");
      const rootSpan = drainedSpans.find((s) => s.name === "agent-turn");

      expect(rootSpan).toBeDefined();
      expect(rootSpan?.traceId).toBe(expectedTraceId);
      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID]).toBe("conv-day-1");
      // Preserves original Day 1 contextAnchor (version/release) instead of Day 2's tempDir
      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.VERSION]).toBe(failResult.version);
      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.RELEASE]).toBe(failResult.release);

      // Spool file unlinked atomically and Day 1 cursor updated
      expect(fs.existsSync(spoolFilePath)).toBe(false);
      expect(fs.existsSync(cursor1Path)).toBe(true);
      expect(readCursorState(cursor1Path)?.lastExportedTurnIndex).toBe(1);

      // Subsequent SessionStart hits O(1) empty fast path
      const secondStart = await runSessionStartHook(
        {
          conversationId: "conv-day-3",
          artifactDirectoryPath: path.join(brainDir, "conv-day-3"),
          cwd: tempDir,
        },
        {
          skillDirs: [],
        },
      );

      expect(secondStart.drainedFiles).toBe(0);
      expect(secondStart.drainedTurns).toBe(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("drains another conversation's spooled turns during Stop hook and migrates legacy .pending-export.json", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-spool-cross-stop-"));

    try {
      const brainDir = path.join(tempDir, "brain");
      const convALogsDir = path.join(brainDir, "conv-a", ".system_generated", "logs");
      const convBLogsDir = path.join(brainDir, "conv-b", ".system_generated", "logs");

      fs.mkdirSync(convALogsDir, { recursive: true });
      fs.mkdirSync(convBLogsDir, { recursive: true });

      const fullPathA = path.join(convALogsDir, "transcript_full.jsonl");
      const fullPathB = path.join(convBLogsDir, "transcript_full.jsonl");

      fs.writeFileSync(
        fullPathA,
        buildTranscriptLines("Prompt A", "Response A", "2026-11-11T10:00:"),
        "utf8",
      );

      fs.writeFileSync(
        fullPathB,
        buildTranscriptLines("Prompt B", "Response B", "2026-11-12T10:00:"),
        "utf8",
      );

      // Put legacy .pending-export.json in convA and fail Stop on convA without credentials
      const prevPublicKey = process.env.LANGFUSE_PUBLIC_KEY;
      const prevSecretKey = process.env.LANGFUSE_SECRET_KEY;

      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;

      try {
        const legacyPath = path.join(convALogsDir, ".pending-export.json");

        writePendingSpool(legacyPath, []);

        const warnings: string[] = [];
        const missingCredsResult = await runStopHook(
          {
            conversationId: "conv-a",
            transcriptPath: fullPathA,
            cwd: tempDir,
          },
          {
            skillDirs: [],
            onWarning: (msg) => warnings.push(msg),
          },
        );

        expect(missingCredsResult.exportedTurns).toBe(0);
        expect(missingCredsResult.spooledTurns).toBe(1);
        expect(warnings.some((w) => w.includes("Missing LANGFUSE_PUBLIC_KEY"))).toBe(true);
        expect(fs.existsSync(legacyPath)).toBe(false);
        expect(fs.existsSync(path.join(brainDir, ".langfuse-spool", "conv-a.json"))).toBe(true);
      } finally {
        if (prevPublicKey !== undefined) {
          process.env.LANGFUSE_PUBLIC_KEY = prevPublicKey;
        }

        if (prevSecretKey !== undefined) {
          process.env.LANGFUSE_SECRET_KEY = prevSecretKey;
        }
      }

      // Now convB runs Stop with working exporter -> exports convB AND drains convA
      const exportedSessions = new Set<string>();
      const stopB = await runStopHook(
        {
          conversationId: "conv-b",
          transcriptPath: fullPathB,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                const sid = s.attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID];

                if (typeof sid === "string") {
                  exportedSessions.add(sid);
                }
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(stopB.exportedTurns).toBe(1);
      expect(stopB.drainedFiles).toBe(1);
      expect(stopB.drainedTurns).toBe(1);
      expect(exportedSessions.has("conv-b")).toBe(true);
      expect(exportedSessions.has("conv-a")).toBe(true);
      expect(fs.existsSync(path.join(brainDir, ".langfuse-spool", "conv-a.json"))).toBe(false);
      expect(fs.existsSync(path.join(convALogsDir, ".langfuse-cursor.json"))).toBe(true);
      expect(fs.existsSync(path.join(convBLogsDir, ".langfuse-cursor.json"))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createTraceId, LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { describe, expect, it } from "vitest";

import {
  acquireSpoolLock,
  advanceCursorForTurns,
  getSpoolFilePath,
  listSpoolFiles,
  mergeTurnsForExport,
  readCursorState,
  readPendingSpool,
  readSpoolEntry,
  releaseSpoolLock,
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
      expect(rehydrated[0].startTime).toBeInstanceOf(Date);

      const merged = mergeTurnsForExport(rehydrated, [
        { ...sampleTurn, output: "Updated Output 1" },
        { ...sampleTurn, turnIndex: 2, traceSeed: "conv-1-turn-2" },
      ]);

      expect(merged).toHaveLength(2);
      expect(merged[0].output).toBe("Updated Output 1");
      expect(merged[1].turnIndex).toBe(2);

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

  it("defers subagent when finishing before parent, links on parent export, and drains offline parent+subagent in topological waves", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-spool-subagent-"));

    try {
      const brainDir = path.join(tempDir, "brain");
      const parentId = "aaaa0000-1111-2222-3333-444455556666";
      const subId = "bbbb0000-1111-2222-3333-444455556666";
      const otherId = "cccc0000-1111-2222-3333-444455556666";

      const parentLogsDir = path.join(brainDir, parentId, ".system_generated", "logs");
      const subLogsDir = path.join(brainDir, subId, ".system_generated", "logs");
      const otherLogsDir = path.join(brainDir, otherId, ".system_generated", "logs");

      fs.mkdirSync(parentLogsDir, { recursive: true });
      fs.mkdirSync(subLogsDir, { recursive: true });
      fs.mkdirSync(otherLogsDir, { recursive: true });

      const parentFull = path.join(parentLogsDir, "transcript_full.jsonl");
      const subFull = path.join(subLogsDir, "transcript_full.jsonl");
      const otherFull = path.join(otherLogsDir, "transcript_full.jsonl");

      fs.writeFileSync(
        subFull,
        [
          JSON.stringify({
            step_index: 0,
            source: "SYSTEM",
            type: "SYSTEM_MESSAGE",
            status: "DONE",
            created_at: "2026-11-23T20:00:01Z",
            content: `<SYSTEM_MESSAGE>\n[Message] sender=${parentId} content=Do work\n</SYSTEM_MESSAGE>`,
          }),
          JSON.stringify({
            step_index: 1,
            source: "MODEL",
            type: "PLANNER_RESPONSE",
            status: "DONE",
            created_at: "2026-11-23T20:00:02Z",
            input_tokens: 200,
            output_tokens: 20,
            content: "Subagent work done.",
          }),
        ].join("\n"),
        "utf8",
      );

      fs.writeFileSync(
        parentFull,
        [
          JSON.stringify({
            step_index: 0,
            source: "USER_EXPLICIT",
            type: "USER_INPUT",
            status: "DONE",
            created_at: "2026-11-23T20:00:00Z",
            content: "<USER_REQUEST>\nDelegate work\n</USER_REQUEST>",
          }),
          JSON.stringify({
            step_index: 1,
            source: "MODEL",
            type: "PLANNER_RESPONSE",
            status: "DONE",
            created_at: "2026-11-23T20:00:01Z",
            input_tokens: 300,
            output_tokens: 30,
            tool_calls: [
              {
                name: "invoke_subagent",
                args: { TypeName: '"research"', Role: '"Worker"', Prompt: '"Do work"' },
              },
            ],
          }),
          JSON.stringify({
            step_index: 2,
            source: "MODEL",
            type: "GENERIC",
            status: "DONE",
            created_at: "2026-11-23T20:00:03Z",
            content: `conversationId: ${subId}`,
          }),
          JSON.stringify({
            step_index: 3,
            source: "MODEL",
            type: "PLANNER_RESPONSE",
            status: "DONE",
            created_at: "2026-11-23T20:00:04Z",
            input_tokens: 400,
            output_tokens: 25,
            content: "Parent finished.",
          }),
        ].join("\n"),
        "utf8",
      );

      const spoolDir = path.join(brainDir, ".langfuse-spool");

      // Case 1: Subagent finishes BEFORE parent -> spools with parentConversationId, does not export standalone
      const subEarly = await runStopHook(
        {
          conversationId: subId,
          transcriptPath: subFull,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: {
            export() {
              throw new Error("Subagent should defer rather than export standalone");
            },
            shutdown: async () => {},
          },
        },
      );

      expect(subEarly.exportedTurns).toBe(0);
      expect(subEarly.spooledTurns).toBe(1);

      const subSpoolPath = getSpoolFilePath(spoolDir, subId);
      const subSpoolEntry = readSpoolEntry(subSpoolPath);

      expect(subSpoolEntry?.parentConversationId).toBe(parentId);

      // Unrelated SessionStart within grace period leaves deferred child intact for active parent
      const earlySessionDrain = await runSessionStartHook(
        {
          conversationId: otherId,
          transcriptPath: otherFull,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          orphanGraceMs: 60_000,
          spanExporter: {
            export() {
              throw new Error("Should not drain active child within grace window");
            },
            shutdown: async () => {},
          },
        },
      );

      expect(earlySessionDrain.drainedFiles).toBe(0);
      expect(earlySessionDrain.failedFiles).toBe(0);
      expect(fs.existsSync(subSpoolPath)).toBe(true);

      // Case 2: Parent fails offline too -> both parent & subagent are in spool
      const parentFail = await runStopHook(
        {
          conversationId: parentId,
          transcriptPath: parentFull,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          simulateFlushFailure: new Error("Offline"),
          onWarning: () => {},
        },
      );

      expect(parentFail.exportedTurns).toBe(0);
      expect(parentFail.spooledTurns).toBe(1);
      expect(fs.existsSync(getSpoolFilePath(spoolDir, parentId))).toBe(true);
      expect(fs.existsSync(subSpoolPath)).toBe(true);

      // Next SessionStart drains parent (Wave 0) -> writes link -> drains subagent (Wave 1) under parent span
      const drainedSpans: Array<{
        name: string;
        traceId: string;
        spanId: string;
        parentSpanId?: string;
        attributes: Record<string, unknown>;
      }> = [];

      const drainBoth = await runSessionStartHook(
        {
          conversationId: otherId,
          transcriptPath: otherFull,
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
                  spanId: s.spanContext().spanId,
                  parentSpanId: s.parentSpanContext?.spanId,
                  attributes: { ...s.attributes },
                });
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(drainBoth.drainedFiles).toBe(2);
      expect(drainBoth.drainedTurns).toBe(2);
      expect(drainBoth.failedFiles).toBe(0);

      const expectedParentTraceId = await createTraceId(`${parentId}-turn-1`);
      const workerSpan = drainedSpans.find((s) => s.name === "subagent:worker");

      expect(workerSpan).toBeDefined();
      expect(workerSpan?.traceId).toBe(expectedParentTraceId);

      // Subagent's generation span was linked under workerSpan without IS_APP_ROOT
      const subGenSpans = drainedSpans.filter(
        (s) => s.name === "llm-generation" && s.parentSpanId === workerSpan?.spanId,
      );

      expect(subGenSpans).toHaveLength(1);
      expect(subGenSpans[0]?.traceId).toBe(expectedParentTraceId);
      expect(subGenSpans[0]?.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBeUndefined();

      expect(fs.existsSync(getSpoolFilePath(spoolDir, parentId))).toBe(false);
      expect(fs.existsSync(subSpoolPath)).toBe(false);
      expect(fs.existsSync(path.join(subLogsDir, ".langfuse-cursor.json"))).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("skips locked spool files during concurrent drain to prevent duplicate exports", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-spool-lock-test-"));

    try {
      const brainDir = path.join(tempDir, "brain");
      const convLogsDir = path.join(brainDir, "conv-locked", ".system_generated", "logs");
      const otherLogsDir = path.join(brainDir, "conv-other", ".system_generated", "logs");

      fs.mkdirSync(convLogsDir, { recursive: true });
      fs.mkdirSync(otherLogsDir, { recursive: true });

      const fullPathLocked = path.join(convLogsDir, "transcript_full.jsonl");
      const fullPathOther = path.join(otherLogsDir, "transcript_full.jsonl");

      fs.writeFileSync(
        fullPathLocked,
        buildTranscriptLines("Locked prompt", "Locked response", "2026-11-23T22:06:"),
        "utf8",
      );

      // Fail once so conv-locked.json sits in the spool directory
      await runStopHook(
        {
          conversationId: "conv-locked",
          transcriptPath: fullPathLocked,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          simulateFlushFailure: new Error("Simulated offline"),
          onWarning: () => {},
        },
      );

      const spoolDir = path.join(brainDir, ".langfuse-spool");
      const lock = acquireSpoolLock(spoolDir, "conv-conv-locked");

      expect(lock).not.toBeNull();

      try {
        // Concurrent SessionStart must skip the locked file instead of double-exporting it
        const whileLockedDrain = await runSessionStartHook(
          {
            conversationId: "conv-other",
            transcriptPath: fullPathOther,
            cwd: tempDir,
          },
          {
            skillDirs: [],
            spanExporter: {
              export() {
                throw new Error("Locked spool file should not be drained while in flight");
              },
              shutdown: async () => {},
            },
          },
        );

        expect(whileLockedDrain.drainedFiles).toBe(0);
        expect(fs.existsSync(getSpoolFilePath(spoolDir, "conv-locked"))).toBe(true);
      } finally {
        releaseSpoolLock(lock);
      }

      // Once lock is released, SessionStart drains conv-locked normally
      const exportedNames: string[] = [];
      const afterUnlockDrain = await runSessionStartHook(
        {
          conversationId: "conv-other",
          transcriptPath: fullPathOther,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                exportedNames.push(s.name);
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(afterUnlockDrain.drainedFiles).toBe(1);
      expect(afterUnlockDrain.drainedTurns).toBe(1);
      expect(exportedNames).toContain("agent-turn");
      expect(fs.existsSync(getSpoolFilePath(spoolDir, "conv-locked"))).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("links run_workflow workers into parent sessionId as separate workflow-worker traces (Option A)", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-workflow-link-test-"));

    try {
      const brainDir = path.join(tempDir, "brain");
      const parentId = "ce6cf2f0-8ba6-486d-ab2e-189ea56630eb";
      const worker1Id = "e1c2439a-0f8f-4b8c-9975-08cdc822686a";
      const worker2Id = "5cc0b9b8-4fd5-4d0d-985a-0734aa5f1c59";

      const parentLogsDir = path.join(brainDir, parentId, ".system_generated", "logs");
      const parentTasksDir = path.join(brainDir, parentId, ".system_generated", "tasks");
      const worker1LogsDir = path.join(brainDir, worker1Id, ".system_generated", "logs");
      const worker2LogsDir = path.join(brainDir, worker2Id, ".system_generated", "logs");

      fs.mkdirSync(parentLogsDir, { recursive: true });
      fs.mkdirSync(parentTasksDir, { recursive: true });
      fs.mkdirSync(worker1LogsDir, { recursive: true });
      fs.mkdirSync(worker2LogsDir, { recursive: true });

      const taskLogPath = path.join(parentTasksDir, "task-43.log");
      const taskLogUrl = pathToFileURL(taskLogPath).href;
      const parentFull = path.join(parentLogsDir, "transcript_full.jsonl");
      const worker1Full = path.join(worker1LogsDir, "transcript_full.jsonl");
      const worker2Full = path.join(worker2LogsDir, "transcript_full.jsonl");

      // Parent Turn 1 launches run_workflow asynchronously
      const parentTurn1Lines = [
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-23T22:00:00Z",
          content: "<USER_REQUEST>\nCollect cards\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-23T22:03:10Z",
          input_tokens: 500,
          output_tokens: 40,
          tool_calls: [
            {
              name: "run_workflow",
              args: { Description: '"Process articles"', ScriptPath: '"workflow.py"' },
            },
          ],
        }),
        JSON.stringify({
          step_index: 2,
          source: "MODEL",
          type: "GENERIC",
          status: "RUNNING",
          created_at: "2026-11-23T22:03:13Z",
          content: [
            `Tool is running as a background task with task id: ${parentId}/task-43`,
            `Task logs are available at: ${taskLogUrl}`,
          ].join("\n"),
        }),
        JSON.stringify({
          step_index: 3,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-23T22:03:29Z",
          input_tokens: 600,
          output_tokens: 30,
          content: "Started workflow.",
        }),
      ];

      fs.writeFileSync(parentFull, parentTurn1Lines.join("\n"), "utf8");

      const exportedSpans: Array<{
        name: string;
        traceId: string;
        attributes: Record<string, unknown>;
      }> = [];
      const collector = {
        export(
          spans: Array<{
            name: string;
            spanContext: () => { traceId: string };
            attributes: Record<string, unknown>;
          }>,
          resultCallback: (res: { code: number }) => void,
        ) {
          for (const s of spans) {
            exportedSpans.push({
              name: s.name,
              traceId: s.spanContext().traceId,
              attributes: { ...s.attributes },
            });
          }

          resultCallback({ code: 0 });
        },
        shutdown: async () => {},
      };

      const parentTurn1Res = await runStopHook(
        {
          conversationId: parentId,
          transcriptPath: parentFull,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: collector,
        },
      );

      expect(parentTurn1Res.exportedTurns).toBe(1);

      const buildWorkerTranscript = (title: string, tsBase: string) =>
        [
          JSON.stringify({
            step_index: 0,
            source: "USER_EXPLICIT",
            type: "USER_INPUT",
            status: "DONE",
            created_at: `${tsBase}10Z`,
            content: `<USER_REQUEST>\nRead ${title}\n\nWhen you are done, call the finish tool with your result.\n</USER_REQUEST>`,
          }),
          JSON.stringify({
            step_index: 1,
            source: "MODEL",
            type: "PLANNER_RESPONSE",
            status: "DONE",
            created_at: `${tsBase}18Z`,
            input_tokens: 200,
            output_tokens: 50,
            tool_calls: [{ name: "finish", args: { result: `{"title":"${title}"}` } }],
          }),
          JSON.stringify({
            step_index: 2,
            source: "MODEL",
            type: "GENERIC",
            status: "DONE",
            created_at: `${tsBase}29Z`,
            content: "Task is complete. Summarize what you did and do not call any more tools.",
          }),
        ].join("\n");

      fs.writeFileSync(
        worker1Full,
        buildWorkerTranscript("Article 1", "2026-11-23T22:06:"),
        "utf8",
      );

      fs.writeFileSync(
        worker2Full,
        buildWorkerTranscript("Article 2", "2026-11-23T22:06:"),
        "utf8",
      );

      // Case 1: Worker 1 finishes BEFORE task-43.log is flushed -> defers in spool
      const worker1Early = await runStopHook(
        {
          conversationId: worker1Id,
          transcriptPath: worker1Full,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: collector,
        },
      );

      expect(worker1Early.exportedTurns).toBe(0);
      expect(worker1Early.spooledTurns).toBe(1);

      // Now task-43.log has worker 2 logged when worker 2 finishes -> exports immediately in parent session
      fs.writeFileSync(
        taskLogPath,
        `- [agent:self] [blog] Article 2: done (${worker2Id}): {"title":"Article 2"}\n`,
        "utf8",
      );

      const worker2Res = await runStopHook(
        {
          conversationId: worker2Id,
          transcriptPath: worker2Full,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: collector,
        },
      );

      expect(worker2Res.exportedTurns).toBe(1);

      const worker2ExpectedTraceId = await createTraceId(`${worker2Id}-turn-1`);
      const worker2Root = exportedSpans.find(
        (s) => s.name === "agent-turn" && s.traceId === worker2ExpectedTraceId,
      );

      expect(worker2Root).toBeDefined();
      expect(worker2Root?.attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID]).toBe(parentId);

      expect(worker2Root?.attributes[LangfuseOtelSpanAttributes.TRACE_NAME]).toBe(
        "workflow-worker",
      );

      expect(worker2Root?.attributes["langfuse.observation.metadata.workerConversationId"]).toBe(
        JSON.stringify(worker2Id),
      );

      // Finally parent Turn 2 completes task-43 (logging worker 1 too) -> drains worker 1 into parent session
      fs.writeFileSync(
        taskLogPath,
        [
          `- [agent:self] [blog] Article 2: done (${worker2Id}): {"title":"Article 2"}`,
          `- [agent:self] [blog] Article 1: done (${worker1Id}): {"title":"Article 1"}`,
        ].join("\n"),
        "utf8",
      );

      const parentTurn2Lines = [
        ...parentTurn1Lines,
        JSON.stringify({
          step_index: 4,
          source: "SYSTEM",
          type: "SYSTEM_MESSAGE",
          status: "DONE",
          created_at: "2026-11-23T22:06:59Z",
          content: `<SYSTEM_MESSAGE>\n[Message] sender=${parentId}/task-43 content=Task finished.\n- [agent:self] [blog] Article 1: done (${worker1Id})\nLog: ${taskLogUrl}\n</SYSTEM_MESSAGE>`,
        }),
        JSON.stringify({
          step_index: 5,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-23T22:07:10Z",
          input_tokens: 700,
          output_tokens: 40,
          content: "All cards collected.",
        }),
      ];

      fs.writeFileSync(parentFull, parentTurn2Lines.join("\n"), "utf8");

      const parentTurn2Res = await runStopHook(
        {
          conversationId: parentId,
          transcriptPath: parentFull,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: collector,
        },
      );

      expect(parentTurn2Res.exportedTurns).toBe(1);
      expect(parentTurn2Res.drainedFiles).toBe(1);

      const worker1ExpectedTraceId = await createTraceId(`${worker1Id}-turn-1`);
      const worker1Root = exportedSpans.find(
        (s) => s.name === "agent-turn" && s.traceId === worker1ExpectedTraceId,
      );

      expect(worker1Root).toBeDefined();
      expect(worker1Root?.attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID]).toBe(parentId);

      expect(worker1Root?.attributes[LangfuseOtelSpanAttributes.TRACE_NAME]).toBe(
        "workflow-worker",
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps orphan subagents inside parentSessionId even after orphanGraceMs expires", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-orphan-session-test-"));

    try {
      const brainDir = path.join(tempDir, "brain");
      const parentId = "11110000-1111-2222-3333-444455556666";
      const subId = "22220000-1111-2222-3333-444455556666";
      const otherId = "33330000-1111-2222-3333-444455556666";

      const parentDir = path.join(brainDir, parentId);
      const subLogsDir = path.join(brainDir, subId, ".system_generated", "logs");
      const otherLogsDir = path.join(brainDir, otherId, ".system_generated", "logs");

      fs.mkdirSync(parentDir, { recursive: true });
      fs.mkdirSync(subLogsDir, { recursive: true });
      fs.mkdirSync(otherLogsDir, { recursive: true });

      const subFull = path.join(subLogsDir, "transcript_full.jsonl");
      const otherFull = path.join(otherLogsDir, "transcript_full.jsonl");

      fs.writeFileSync(
        subFull,
        [
          JSON.stringify({
            step_index: 0,
            source: "SYSTEM",
            type: "SYSTEM_MESSAGE",
            status: "DONE",
            created_at: "2026-11-23T20:00:01Z",
            content: `<SYSTEM_MESSAGE>\n[Message] sender=${parentId} content=Do work\n</SYSTEM_MESSAGE>`,
          }),
          JSON.stringify({
            step_index: 1,
            source: "MODEL",
            type: "PLANNER_RESPONSE",
            status: "DONE",
            created_at: "2026-11-23T20:00:02Z",
            input_tokens: 100,
            output_tokens: 20,
            content: "Done.",
          }),
        ].join("\n"),
        "utf8",
      );

      // Subagent defers initially
      await runStopHook(
        {
          conversationId: subId,
          transcriptPath: subFull,
          cwd: tempDir,
        },
        {
          skillDirs: [],
        },
      );

      // Drain with orphanGraceMs: 0 -> exports as orphan fallback inside parentId session
      const drainedSpans: Array<{ name: string; attributes: Record<string, unknown> }> = [];
      const drainRes = await runSessionStartHook(
        {
          conversationId: otherId,
          transcriptPath: otherFull,
          cwd: tempDir,
        },
        {
          skillDirs: [],
          orphanGraceMs: 0,
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                drainedSpans.push({ name: s.name, attributes: { ...s.attributes } });
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(drainRes.drainedFiles).toBe(1);

      const root = drainedSpans.find((s) => s.name === "agent-turn");

      expect(root).toBeDefined();
      expect(root?.attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID]).toBe(parentId);
      expect(root?.attributes[LangfuseOtelSpanAttributes.TRACE_TAGS]).toContain("subagent:orphan");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

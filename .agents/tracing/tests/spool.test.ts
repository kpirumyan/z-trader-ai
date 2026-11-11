// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  mergeTurnsForExport,
  readCursorState,
  readPendingSpool,
  runStopHook,
  writeCursorState,
  writePendingSpool,
  type ParsedTurnTrace,
} from "../index.ts";

describe("spool: cursor and fail-open buffer management", () => {
  it("reads, writes, and merges cursor state and pending spool turns", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-spool-unit-"));

    try {
      const cursorPath = path.join(tempDir, ".langfuse-cursor.json");
      const spoolPath = path.join(tempDir, ".pending-export.json");

      expect(readCursorState(cursorPath)).toBeNull();
      expect(readPendingSpool(spoolPath)).toEqual([]);

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
        startTime: new Date("2026-11-11T19:00:00.000Z"),
        endTime: new Date("2026-11-11T19:00:05.000Z"),
        input: "Prompt 1",
        output: "Output 1",
        children: [],
        usageSummary: { input: 10, output: 5, cacheReadInputTokens: 0, total: 15 },
        tags: [],
        metadata: {},
      };

      writePendingSpool(spoolPath, [sampleTurn]);

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
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("soft fails open into .pending-export.json when export fails and retries on next run", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-spool-test-"));

    try {
      const logsDir = path.join(tempDir, "conv-spool-1", ".system_generated", "logs");

      fs.mkdirSync(logsDir, { recursive: true });

      const fullPath = path.join(logsDir, "transcript_full.jsonl");

      fs.writeFileSync(
        fullPath,
        [
          JSON.stringify({
            step_index: 0,
            source: "USER_EXPLICIT",
            type: "USER_INPUT",
            status: "DONE",
            created_at: "2026-11-11T19:00:00Z",
            content: "<USER_REQUEST>\nTest spool retry\n</USER_REQUEST>",
          }),
          JSON.stringify({
            step_index: 1,
            source: "MODEL",
            type: "PLANNER_RESPONSE",
            status: "DONE",
            created_at: "2026-11-11T19:00:02Z",
            input_tokens: 100,
            output_tokens: 20,
            content: "Done.",
          }),
        ].join("\n"),
        "utf8",
      );

      const warnings: string[] = [];

      const failResult = await runStopHook(
        {
          conversationId: "conv-spool-1",
          transcriptPath: fullPath,
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

      const spoolPath = path.join(logsDir, ".pending-export.json");
      const cursorPath = path.join(logsDir, ".langfuse-cursor.json");

      expect(fs.existsSync(spoolPath)).toBe(true);
      expect(fs.existsSync(cursorPath)).toBe(false);

      const recoveredSpans: string[] = [];
      const retryResult = await runStopHook(
        {
          conversationId: "conv-spool-1",
          transcriptPath: fullPath,
          modelName: "gemini-4-argon",
          cwd: process.cwd(),
        },
        {
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                recoveredSpans.push(s.name);
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(retryResult.decision).toBe("allow");
      expect(retryResult.exportedTurns).toBe(1);
      expect(retryResult.spooledTurns).toBe(0);
      expect(recoveredSpans).toContain("agent-turn");
      expect(recoveredSpans).toContain("llm-generation");
      expect(fs.existsSync(spoolPath)).toBe(false);
      expect(fs.existsSync(cursorPath)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTraceId, LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { describe, expect, it } from "vitest";

import {
  createNoopSpanExporter,
  createTurnTraceId,
  DEFAULT_TIMEOUT_MS,
  runStopHook,
} from "../index.ts";

describe("exporter: end-to-end Langfuse OTel export", () => {
  it("exports turns via LangfuseSpanProcessor with deterministic traceId, root flags, and cursor deduplication", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-hook-test-"));

    try {
      const logsDir = path.join(tempDir, "conv-hook-1", ".system_generated", "logs");

      fs.mkdirSync(logsDir, { recursive: true });

      const compactPath = path.join(logsDir, "transcript.jsonl");
      const fullPath = path.join(logsDir, "transcript_full.jsonl");

      const transcriptLines = [
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-11T18:00:00Z",
          content: "<USER_REQUEST>\nCheck chart module\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-11T18:00:02Z",
          input_tokens: 400,
          cache_read_tokens: 100,
          output_tokens: 50,
          thinking: "Reading chart module.",
          tool_calls: [
            {
              id: "call-1",
              name: "read_file",
              args: {
                Path: '"src/modules/chart/index.ts"',
              },
            },
          ],
        }),
        JSON.stringify({
          step_index: 2,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-11T18:00:04Z",
          content:
            "Created At: 2026-11-11T18:00:03Z\nCompleted At: 2026-11-11T18:00:04Z\nexport {};",
        }),
        JSON.stringify({
          step_index: 3,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-11T18:00:06Z",
          input_tokens: 450,
          cache_read_tokens: 350,
          output_tokens: 30,
          content: "Chart module checked.",
        }),
      ].join("\n");

      fs.writeFileSync(compactPath, "{}", "utf8");
      fs.writeFileSync(fullPath, transcriptLines, "utf8");

      const exportedSpans: Array<{
        name: string;
        traceId: string;
        spanId: string;
        parentSpanId?: string;
        attributes: Record<string, unknown>;
      }> = [];

      const result1 = await runStopHook(
        {
          conversationId: "conv-hook-1",
          transcriptPath: compactPath,
          modelName: "gemini-4-argon",
          cwd: process.cwd(),
        },
        {
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                exportedSpans.push({
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

      expect(result1.decision).toBe("allow");
      expect(result1.exportedTurns).toBe(1);
      expect(result1.spooledTurns).toBe(0);
      expect(DEFAULT_TIMEOUT_MS).toBe(4500);

      expect(exportedSpans).toHaveLength(4);

      const expectedTraceId = await createTraceId("conv-hook-1-turn-1");
      const rootSpan = exportedSpans.find((s) => s.name === "agent-turn");

      expect(rootSpan).toBeDefined();
      expect(rootSpan?.traceId).toBe(expectedTraceId);
      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE]).toBe("agent");
      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(true);
      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.TRACE_NAME]).toBe("agent-turn");

      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID]).toBe("conv-hook-1");

      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.TRACE_TAGS]).toEqual(["module:chart"]);

      const childSpans = exportedSpans.filter((s) => s.name !== "agent-turn");

      for (const child of childSpans) {
        expect(child.traceId).toBe(expectedTraceId);
        expect(child.parentSpanId).toBe(rootSpan?.spanId);
        expect(child.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBeUndefined();
      }

      const cursorPath = path.join(logsDir, ".langfuse-cursor.json");

      expect(fs.existsSync(cursorPath)).toBe(true);

      const result2 = await runStopHook(
        {
          conversationId: "conv-hook-1",
          transcriptPath: compactPath,
          modelName: "gemini-4-argon",
          cwd: process.cwd(),
        },
        {
          spanExporter: createNoopSpanExporter(),
        },
      );

      expect(result2.exportedTurns).toBe(0);

      const directTraceId = await createTurnTraceId({
        turnIndex: 1,
        traceSeed: "conv-hook-1-turn-1",
        traceName: "agent-turn",
        sessionId: "conv-hook-1",
        startStepIndex: 0,
        endStepIndex: 3,
        startTime: new Date(),
        endTime: new Date(),
        input: "",
        output: "",
        children: [],
        usageSummary: { input: 0, output: 0, cacheReadInputTokens: 0, total: 0 },
        tags: [],
        metadata: {},
      });

      expect(directTraceId).toBe(expectedTraceId);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

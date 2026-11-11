// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTraceId, LangfuseOtelSpanAttributes } from "@langfuse/tracing";
import { describe, expect, it } from "vitest";

import { computeContextAnchor, runStopHook } from "../langfuse-stop-hook.ts";
import {
  createFilesystemSubagentResolver,
  deserializeToolArgs,
  extractUserRequest,
  parseTranscriptTurns,
  resolveFullTranscriptPath,
} from "../transcript-parser.ts";

describe("extractUserRequest", () => {
  it("extracts clean prompt text from <USER_REQUEST> and separates metadata blocks", () => {
    const raw = [
      "<USER_REQUEST>",
      "Implement task 1.2 using Langfuse v6 SDK",
      "</USER_REQUEST>",
      "<ADDITIONAL_METADATA>",
      "The current local time is: 2026-11-11T20:46:47+04:00.",
      "</ADDITIONAL_METADATA>",
      "<USER_SETTINGS_CHANGE>",
      "Model Selection changed to Gemini 4 Argon.",
      "</USER_SETTINGS_CHANGE>",
    ].join("\n");

    const extracted = extractUserRequest(raw);

    expect(extracted.prompt).toBe("Implement task 1.2 using Langfuse v6 SDK");

    expect(extracted.additionalMetadata).toBe(
      "The current local time is: 2026-11-11T20:46:47+04:00.",
    );

    expect(extracted.userSettingsChange).toBe("Model Selection changed to Gemini 4 Argon.");
  });

  it("returns trimmed raw content when <USER_REQUEST> wrapper is absent", () => {
    const extracted = extractUserRequest("  Plain user message  ");

    expect(extracted.prompt).toBe("Plain user message");
    expect(extracted.additionalMetadata).toBeUndefined();
    expect(extracted.userSettingsChange).toBeUndefined();
  });
});

describe("deserializeToolArgs", () => {
  it("deserializes double-encoded string, number, boolean, and JSON object arguments", () => {
    const rawArgs = {
      Path: '"c:\\\\DATA\\\\Development\\\\js\\\\z-trader-ai\\\\TASKS.md"',
      StartLine: "1",
      EndLine: "100",
      BypassSandbox: "false",
      Arguments: '{"pathOrUrl":"/docs/observability/best-practices"}',
      PlainString: "already-unquoted",
    };

    const parsed = deserializeToolArgs(rawArgs);

    expect(parsed).toEqual({
      Path: "c:\\DATA\\Development\\js\\z-trader-ai\\TASKS.md",
      StartLine: 1,
      EndLine: 100,
      BypassSandbox: false,
      Arguments: { pathOrUrl: "/docs/observability/best-practices" },
      PlainString: "already-unquoted",
    });
  });
});

describe("parseTranscriptTurns", () => {
  const conversationId = "5c98cb8c-04dd-48fe-9a4c-3856bf8c2863";

  it("slices multi-turn transcripts, sums tokens, pairs sibling tool calls, and auto-tags modules and skills", () => {
    const mainTranscriptLines = [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-11T16:46:47Z",
        content:
          "<USER_REQUEST>\nAudit chart module and langfuse skill\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nTime: 2026-11-11\n</ADDITIONAL_METADATA>",
      }),
      JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-11T16:46:48Z",
        input_tokens: 1200,
        cache_read_tokens: 800,
        output_tokens: 150,
        thinking: "Reading chart module and langfuse skill first.",
        tool_calls: [
          {
            name: "read_file",
            args: {
              Path: '"c:\\\\DATA\\\\Development\\\\js\\\\z-trader-ai\\\\src\\\\modules\\\\chart\\\\index.ts"',
            },
          },
          {
            name: "read_file",
            args: {
              Path: '"c:\\\\DATA\\\\Development\\\\js\\\\z-trader-ai\\\\.agents\\\\skills\\\\langfuse\\\\SKILL.md"',
            },
          },
          {
            name: "read_file",
            args: {
              Path: '"c:\\\\DATA\\\\Development\\\\js\\\\z-trader-ai\\\\missing.ts"',
            },
          },
        ],
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-11T16:46:50Z",
        content:
          "Created At: 2026-11-11T20:46:49+04:00\nCompleted At: 2026-11-11T20:46:50+04:00\nShowing lines 1-2 of 2\n1: export const Chart = {};",
      }),
      JSON.stringify({
        step_index: 3,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-11T16:46:51Z",
        content:
          "Created At: 2026-11-11T20:46:50+04:00\nCompleted At: 2026-11-11T20:46:51+04:00\nShowing lines 1-1 of 1\n1: # Langfuse Skill",
      }),
      JSON.stringify({
        step_index: 4,
        source: "MODEL",
        type: "GENERIC",
        status: "ERROR",
        error: "file does not exist",
        created_at: "2026-11-11T16:46:52Z",
        content:
          "Created At: 2026-11-11T20:46:51+04:00\nCompleted At: 2026-11-11T20:46:52+04:00\nEncountered error in step execution: file does not exist",
      }),
      JSON.stringify({
        step_index: 5,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-11T16:46:55Z",
        input_tokens: 1500,
        cache_read_tokens: 1000,
        output_tokens: 90,
        thinking: "All files checked, formulating final answer.",
        content: "Audit complete: chart module and langfuse skill verified.",
      }),
      // Second turn
      JSON.stringify({
        step_index: 6,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-11T16:48:00Z",
        content: "<USER_REQUEST>\nNow check order-book\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 7,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-11T16:48:05Z",
        input_tokens: 500,
        cache_read_tokens: 200,
        output_tokens: 60,
        content: "Order book checked.",
      }),
    ].join("\n");

    const turns = parseTranscriptTurns(mainTranscriptLines, {
      conversationId,
      modelName: "gemini-4-argon",
    });

    expect(turns).toHaveLength(2);

    const turn1 = turns[0]!;

    expect(turn1.turnIndex).toBe(1);
    expect(turn1.traceName).toBe("agent-turn");
    expect(turn1.traceSeed).toBe(`${conversationId}-turn-1`);
    expect(turn1.sessionId).toBe(conversationId);
    expect(turn1.input).toBe("Audit chart module and langfuse skill");
    expect(turn1.output).toBe("Audit complete: chart module and langfuse skill verified.");
    expect(turn1.startStepIndex).toBe(0);
    expect(turn1.endStepIndex).toBe(5);

    // Token summation for Turn 1: (1200 + 1500) input, (150 + 90) output, (800 + 1000) cache_read
    expect(turn1.usageSummary).toEqual({
      input: 2700,
      output: 240,
      cacheReadInputTokens: 1800,
      total: 4740,
    });

    // Tags extracted from tool calls
    expect(turn1.tags).toEqual(["module:chart", "skill:langfuse"]);

    // Observation hierarchy: gen1, tool1, tool2, tool3, gen2 (all siblings under root agent-turn)
    expect(turn1.children.map((c) => `${c.type}:${c.name}`)).toEqual([
      "generation:llm-generation",
      "tool:read_file",
      "tool:read_file",
      "tool:read_file",
      "generation:llm-generation",
    ]);

    const gen1 = turn1.children[0]!;

    expect(gen1.type).toBe("generation");

    if (gen1.type === "generation") {
      expect(gen1.model).toBe("gemini-4-argon");

      expect(gen1.usageDetails).toEqual({
        input: 1200,
        output: 150,
        cache_read_input_tokens: 800,
        total: 2150,
      });

      expect(gen1.metadata.thinking).toBe("Reading chart module and langfuse skill first.");
      expect(gen1.output.thinking).toBe("Reading chart module and langfuse skill first.");
      expect(gen1.output.tool_calls).toHaveLength(3);
    }

    const tool1 = turn1.children[1]!;

    expect(tool1.type).toBe("tool");

    if (tool1.type === "tool") {
      expect(tool1.input).toEqual({
        Path: "c:\\DATA\\Development\\js\\z-trader-ai\\src\\modules\\chart\\index.ts",
      });

      expect(tool1.output).toBe("Showing lines 1-2 of 2\n1: export const Chart = {};");
      expect(tool1.level).toBe("DEFAULT");
      expect(tool1.startTime.toISOString()).toBe("2026-11-11T16:46:49.000Z");
      expect(tool1.endTime.toISOString()).toBe("2026-11-11T16:46:50.000Z");
    }

    const failedTool = turn1.children[3]!;

    expect(failedTool.type).toBe("tool");

    if (failedTool.type === "tool") {
      expect(failedTool.level).toBe("ERROR");
      expect(failedTool.statusMessage).toBe("file does not exist");
    }

    // Cursor filtering: only return turns with endStepIndex > afterStepIndex
    const incrementalTurns = parseTranscriptTurns(mainTranscriptLines, {
      conversationId,
      modelName: "gemini-4-argon",
      afterStepIndex: 5,
    });

    expect(incrementalTurns).toHaveLength(1);
    expect(incrementalTurns[0]!.turnIndex).toBe(2);
    expect(incrementalTurns[0]!.traceSeed).toBe(`${conversationId}-turn-2`);
  });

  it("recursively parses invoke_subagent into a role-named agent observation without duplicate tool span", () => {
    const subagentId = "11111111-2222-3333-4444-555555555555";

    const parentTranscript = [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-11T17:00:00Z",
        content: "<USER_REQUEST>\nDelegate research to subagent\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-11T17:00:01Z",
        input_tokens: 400,
        cache_read_tokens: 100,
        output_tokens: 50,
        thinking: "Invoking research subagent.",
        tool_calls: [
          {
            name: "invoke_subagent",
            args: {
              TypeName: '"research"',
              Role: '"Codebase Researcher"',
              Prompt: '"Find all order-book stores"',
            },
          },
        ],
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-11T17:00:10Z",
        content: `Created At: 2026-11-11T17:00:02Z\nCompleted At: 2026-11-11T17:00:10Z\nSubagent completed. conversationId: ${subagentId}\nFound store in src/modules/order-book/index.ts`,
      }),
      JSON.stringify({
        step_index: 3,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-11T17:00:12Z",
        input_tokens: 600,
        cache_read_tokens: 400,
        output_tokens: 40,
        content: "Research complete.",
      }),
    ].join("\n");

    const subagentTranscript = [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-11T17:00:02Z",
        content: "Find all order-book stores",
      }),
      JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-11T17:00:03Z",
        input_tokens: 300,
        cache_read_tokens: 0,
        output_tokens: 35,
        thinking: "Reading order-book index.",
        tool_calls: [
          {
            name: "read_file",
            args: {
              Path: '"c:\\\\DATA\\\\Development\\\\js\\\\z-trader-ai\\\\src\\\\modules\\\\order-book\\\\index.ts"',
            },
          },
        ],
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-11T17:00:05Z",
        content:
          "Created At: 2026-11-11T17:00:04Z\nCompleted At: 2026-11-11T17:00:05Z\nexport const useOrderBookStore = {};",
      }),
      JSON.stringify({
        step_index: 3,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-11T17:00:08Z",
        input_tokens: 350,
        cache_read_tokens: 250,
        output_tokens: 25,
        content: "Found useOrderBookStore.",
      }),
    ].join("\n");

    const turns = parseTranscriptTurns(parentTranscript, {
      conversationId,
      modelName: "gemini-4-argon",
      resolveSubagentTranscript: (id) => (id === subagentId ? subagentTranscript : null),
    });

    expect(turns).toHaveLength(1);

    const turn = turns[0]!;

    // Verify no duplicate "tool:invoke_subagent" node — only generation, agent, generation
    expect(turn.children.map((c) => `${c.type}:${c.name}`)).toEqual([
      "generation:llm-generation",
      "agent:subagent:codebase-researcher",
      "generation:llm-generation",
    ]);

    const agentObs = turn.children[1]!;

    expect(agentObs.type).toBe("agent");

    if (agentObs.type === "agent") {
      expect(agentObs.subagentConversationId).toBe(subagentId);

      expect(agentObs.children.map((c) => `${c.type}:${c.name}`)).toEqual([
        "generation:llm-generation",
        "tool:read_file",
        "generation:llm-generation",
      ]);

      expect(agentObs.usageSummary).toEqual({
        input: 650,
        output: 60,
        cacheReadInputTokens: 250,
        total: 960,
      });
    }

    // Parent turn usageSummary includes both parent (1000 in, 90 out, 500 cache) and subagent (650 in, 60 out, 250 cache)
    expect(turn.usageSummary).toEqual({
      input: 1650,
      output: 150,
      cacheReadInputTokens: 750,
      total: 2550,
    });

    // Subagent's touched module is rolled up into turn tags
    expect(turn.tags).toEqual(["module:order-book"]);
  });

  it("resolves sibling transcript_full.jsonl and subagent transcripts on disk", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-transcript-test-"));

    try {
      const parentLogsDir = path.join(tempDir, "conv-parent", ".system_generated", "logs");
      const subLogsDir = path.join(tempDir, "conv-sub", ".system_generated", "logs");

      fs.mkdirSync(parentLogsDir, { recursive: true });
      fs.mkdirSync(subLogsDir, { recursive: true });

      const compactPath = path.join(parentLogsDir, "transcript.jsonl");
      const fullPath = path.join(parentLogsDir, "transcript_full.jsonl");
      const subFullPath = path.join(subLogsDir, "transcript_full.jsonl");

      fs.writeFileSync(compactPath, "{}", "utf8");
      fs.writeFileSync(fullPath, '{"step_index":0}', "utf8");
      fs.writeFileSync(subFullPath, '{"step_index":0,"type":"USER_INPUT"}', "utf8");

      expect(resolveFullTranscriptPath(compactPath)).toBe(fullPath);

      const resolver = createFilesystemSubagentResolver(fullPath);

      expect(resolver("conv-sub")).toBe('{"step_index":0,"type":"USER_INPUT"}');
      expect(resolver("non-existent")).toBeNull();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("langfuse-stop-hook", () => {
  it("computes deterministic context anchor (gitShortSha-agentsHash) excluding test files", () => {
    const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-anchor-test-"));

    try {
      fs.writeFileSync(path.join(tempWorkspace, "AGENTS.md"), "# Agent Rules\n", "utf8");

      fs.mkdirSync(path.join(tempWorkspace, ".agents", "skills", "langfuse"), {
        recursive: true,
      });

      fs.mkdirSync(path.join(tempWorkspace, ".agents", "hooks", "tests"), {
        recursive: true,
      });

      fs.writeFileSync(
        path.join(tempWorkspace, ".agents", "skills", "langfuse", "SKILL.md"),
        "name: langfuse\n",
        "utf8",
      );

      fs.writeFileSync(
        path.join(tempWorkspace, ".agents", "hooks", "tests", "some.test.ts"),
        "// test v1\n",
        "utf8",
      );

      const anchor1 = computeContextAnchor(tempWorkspace);

      expect(anchor1.agentsHash).toMatch(/^[0-9a-f]{8}$/);
      expect(anchor1.version).toBe(`${anchor1.gitShortSha}-${anchor1.agentsHash}`);

      // Modifying a test file inside .agents/**/tests/ should NOT change agentsHash
      fs.writeFileSync(
        path.join(tempWorkspace, ".agents", "hooks", "tests", "some.test.ts"),
        "// test v2 changed\n",
        "utf8",
      );

      const anchor2 = computeContextAnchor(tempWorkspace);

      expect(anchor2.agentsHash).toBe(anchor1.agentsHash);

      // Modifying a skill file inside .agents/skills/ MUST change agentsHash
      fs.writeFileSync(
        path.join(tempWorkspace, ".agents", "skills", "langfuse", "SKILL.md"),
        "name: langfuse-updated\n",
        "utf8",
      );

      const anchor3 = computeContextAnchor(tempWorkspace);

      expect(anchor3.agentsHash).not.toBe(anchor1.agentsHash);
    } finally {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    }
  });

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

      // Should have 4 spans: 1 root agent-turn + 2 llm-generation + 1 read_file tool
      expect(exportedSpans).toHaveLength(4);

      const expectedTraceId = await createTraceId("conv-hook-1-turn-1");
      const rootSpan = exportedSpans.find((s) => s.name === "agent-turn");

      expect(rootSpan).toBeDefined();
      expect(rootSpan?.traceId).toBe(expectedTraceId);
      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE]).toBe("agent");
      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBe(true);
      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.TRACE_NAME]).toBe("agent-turn");

      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID]).toBe(
        "conv-hook-1",
      );

      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.TRACE_TAGS]).toEqual([
        "module:chart",
      ]);

      const childSpans = exportedSpans.filter((s) => s.name !== "agent-turn");

      for (const child of childSpans) {
        expect(child.traceId).toBe(expectedTraceId);
        expect(child.parentSpanId).toBe(rootSpan?.spanId);
        expect(child.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBeUndefined();
      }

      // Cursor file must exist and prevent duplicate re-export on second invocation
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
          spanExporter: {
            export(_spans, resultCallback) {
              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(result2.exportedTurns).toBe(0);
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

      // First run: force failure via flushErrorSimulation / failing exporter
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

      // Second run: exporter succeeds, rehydrates spooled turn, exports it, and clears .pending-export.json
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

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
  discoverAvailableSkills,
  LINK_ANCHOR_SPAN_NAME,
  readSubagentLink,
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

      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.RELEASE]).toBe(result1.release);
      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.VERSION]).toBe(result1.version);
      expect(result1.release).not.toBe(result1.version);

      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.TRACE_TAGS]).toEqual(["module:chart"]);

      const childSpans = exportedSpans.filter((s) => s.name !== "agent-turn");

      for (const child of childSpans) {
        expect(child.traceId).toBe(expectedTraceId);
        expect(child.parentSpanId).toBe(rootSpan?.spanId);
        expect(child.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBeUndefined();
        expect(child.attributes[LangfuseOtelSpanAttributes.RELEASE]).toBe(result1.release);
        expect(child.attributes[LangfuseOtelSpanAttributes.VERSION]).toBe(result1.version);
      }

      const toolSpan = childSpans.find((s) => s.name === "read_file");

      expect(toolSpan).toBeDefined();
      expect(toolSpan?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE]).toBe("retriever");
      expect(toolSpan?.attributes["gen_ai.tool.name"]).toBe("read_file");
      expect(toolSpan?.attributes["gen_ai.tool.call.id"]).toBe("call-1");
      expect(toolSpan?.attributes["langfuse.observation.metadata.toolCallId"]).toBe('"call-1"');

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

  it("emits semantic observation types (event, retriever, evaluator, guardrail, tool) and attaches discovered skills", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-semantic-test-"));

    try {
      const projectSkillsDir = path.join(tempDir, "project-skills");
      const userSkillsDir = path.join(tempDir, "user-skills");

      fs.mkdirSync(path.join(projectSkillsDir, "adr"), { recursive: true });
      fs.mkdirSync(path.join(userSkillsDir, "adr"), { recursive: true });
      fs.mkdirSync(path.join(userSkillsDir, "vitest"), { recursive: true });

      fs.writeFileSync(
        path.join(projectSkillsDir, "adr", "SKILL.md"),
        "---\nname: adr\ndescription: Project ADR governance skill.\n---\n# Project ADR",
        "utf8",
      );

      fs.writeFileSync(
        path.join(userSkillsDir, "adr", "SKILL.md"),
        "---\nname: adr\ndescription: User ADR fallback.\n---\n# User ADR",
        "utf8",
      );

      fs.writeFileSync(
        path.join(userSkillsDir, "vitest", "SKILL.md"),
        "---\nname: vitest\ndescription: Vitest testing standards.\n---\n# Vitest",
        "utf8",
      );

      fs.writeFileSync(
        path.join(projectSkillsDir, "langfuse-skills.lock"),
        JSON.stringify({
          lockVersion: 1,
          skills: [{ name: "adr", version: 2, path: "adr" }],
        }),
        "utf8",
      );

      fs.writeFileSync(
        path.join(userSkillsDir, "langfuse-skills.lock"),
        JSON.stringify({
          lockVersion: 1,
          skills: [{ name: "adr", version: 1, path: "adr" }],
        }),
        "utf8",
      );

      const discovered = await discoverAvailableSkills([projectSkillsDir, userSkillsDir]);

      expect(discovered).toEqual([{ name: "adr", version: 2 }, { name: "vitest" }]);

      const logsDir = path.join(tempDir, "conv-semantic", ".system_generated", "logs");

      fs.mkdirSync(logsDir, { recursive: true });

      const compactPath = path.join(logsDir, "transcript.jsonl");
      const lines = [
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-12T10:00:00Z",
          content: "<USER_REQUEST>\nVerify chart module\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 1,
          source: "SYSTEM",
          type: "SYSTEM_MESSAGE",
          status: "DONE",
          created_at: "2026-11-12T10:00:01Z",
          content: "<SYSTEM_MESSAGE>\n[Notice] Context ready.\n</SYSTEM_MESSAGE>",
        }),
        JSON.stringify({
          step_index: 2,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-12T10:00:02Z",
          input_tokens: 100,
          output_tokens: 40,
          tool_calls: [
            {
              id: "c-skill",
              name: "read_file",
              args: { Path: "C:/Users/Karen/.gemini/config/skills/vitest/SKILL.md" },
            },
            {
              id: "c-read",
              name: "read_file",
              args: { Path: "src/modules/chart/index.ts" },
            },
            {
              id: "c-guard",
              name: "run_command",
              args: { CommandLine: "pnpm lint" },
            },
            {
              id: "c-eval",
              name: "run_command",
              args: { CommandLine: "pnpm test:unit" },
            },
            {
              id: "c-mcp",
              name: "call_mcp_tool",
              args: {
                ServerName: "langfuse-docs",
                ToolName: "getLangfuseDocsPage",
                Arguments: '{"pathOrUrl":"/docs"}',
              },
            },
            {
              id: "c-tool",
              name: "write_to_file",
              args: { TargetFile: "src/modules/chart/index.ts", CodeContent: "// ok" },
            },
          ],
        }),
        JSON.stringify({
          step_index: 3,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-12T10:00:03Z",
          content: "# Vitest",
        }),
        JSON.stringify({
          step_index: 4,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-12T10:00:04Z",
          content: "export const Chart = {};",
        }),
        JSON.stringify({
          step_index: 5,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-12T10:00:05Z",
          content: "lint ok",
        }),
        JSON.stringify({
          step_index: 6,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-12T10:00:06Z",
          content: "tests ok",
        }),
        JSON.stringify({
          step_index: 7,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-12T10:00:07Z",
          content: "docs content",
        }),
        JSON.stringify({
          step_index: 8,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-12T10:00:08Z",
          content: "written",
        }),
        JSON.stringify({
          step_index: 9,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-12T10:00:09Z",
          input_tokens: 120,
          output_tokens: 20,
          content: "Done.",
        }),
      ].join("\n");

      fs.writeFileSync(compactPath, lines, "utf8");

      const exportedSpans: Array<{
        name: string;
        attributes: Record<string, unknown>;
      }> = [];

      const result = await runStopHook(
        {
          conversationId: "conv-semantic",
          transcriptPath: compactPath,
          modelName: "gemini-4-argon",
          cwd: tempDir,
        },
        {
          skillDirs: [projectSkillsDir, userSkillsDir],
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                exportedSpans.push({
                  name: s.name,
                  attributes: { ...s.attributes },
                });
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(result.exportedTurns).toBe(1);

      const byName = new Map(exportedSpans.map((s) => [s.name, s]));

      expect(
        byName.get("system:notice")?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE],
      ).toBe("event");

      expect(
        byName.get("skill_read")?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE],
      ).toBe("tool");

      expect(byName.get("skill_read")?.attributes["gen_ai.tool.name"]).toBe("skill_read");

      expect(
        byName.get("skill_read")?.attributes["langfuse.observation.metadata.rawToolName"],
      ).toBe('"read_file"');

      expect(byName.get("skill_read")?.attributes["langfuse.observation.metadata.skillName"]).toBe(
        '"vitest"',
      );

      expect(byName.get("read_file")?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE]).toBe(
        "retriever",
      );

      expect(
        byName.get("mcp:langfuse-docs:getLangfuseDocsPage")?.attributes[
          LangfuseOtelSpanAttributes.OBSERVATION_TYPE
        ],
      ).toBe("retriever");

      expect(
        byName.get("mcp:langfuse-docs:getLangfuseDocsPage")?.attributes["gen_ai.tool.name"],
      ).toBe("mcp:langfuse-docs:getLangfuseDocsPage");

      expect(
        byName.get("mcp:langfuse-docs:getLangfuseDocsPage")?.attributes[
          "langfuse.observation.metadata.rawToolName"
        ],
      ).toBe('"call_mcp_tool"');

      expect(
        byName.get("run_command:lint")?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE],
      ).toBe("guardrail");

      expect(byName.get("run_command:lint")?.attributes["gen_ai.tool.name"]).toBe(
        "run_command:lint",
      );

      expect(
        byName.get("run_command:lint")?.attributes["langfuse.observation.metadata.rawToolName"],
      ).toBe('"run_command"');

      expect(
        byName.get("run_command:test:unit")?.attributes[
          LangfuseOtelSpanAttributes.OBSERVATION_TYPE
        ],
      ).toBe("evaluator");

      expect(
        byName.get("write_to_file")?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE],
      ).toBe("tool");

      const rootSpan = byName.get("agent-turn");

      expect(rootSpan?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE]).toBe("agent");

      expect(rootSpan?.attributes["langfuse.observation.skills_available"]).toBe(
        JSON.stringify([{ name: "adr", version: 2 }, { name: "vitest" }]),
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("exports settings:model-change event and updates generation model attribute after Model Selection change", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-model-switch-test-"));

    try {
      const logsDir = path.join(tempDir, "conv-model-switch", ".system_generated", "logs");

      fs.mkdirSync(logsDir, { recursive: true });

      const compactPath = path.join(logsDir, "transcript.jsonl");
      const lines = [
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-15T14:56:08Z",
          content: [
            "<USER_REQUEST>",
            "git status",
            "</USER_REQUEST>",
            "<USER_SETTINGS_CHANGE>",
            "The user changed setting `Model Selection` from Gemini 3.8 Flash (Low) to Gemini 3.8 Flash (High).",
            "</USER_SETTINGS_CHANGE>",
          ].join("\n"),
        }),
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-15T14:56:25Z",
          content: "<USER_REQUEST>\ngit status\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-15T14:56:25Z",
          input_tokens: 100,
          output_tokens: 20,
          content: "Clean.",
        }),
      ].join("\n");

      fs.writeFileSync(compactPath, lines, "utf8");

      const exportedSpans: Array<{
        name: string;
        attributes: Record<string, unknown>;
      }> = [];

      const result = await runStopHook(
        {
          conversationId: "conv-model-switch",
          transcriptPath: compactPath,
          modelName: "gemini-3.8-flash-low",
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                exportedSpans.push({
                  name: s.name,
                  attributes: { ...s.attributes },
                });
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(result.exportedTurns).toBe(2);

      const byName = new Map(exportedSpans.map((s) => [s.name, s]));
      const modelEventSpan = byName.get("settings:model-change");
      const genSpan = byName.get("llm-generation");
      const rootSpans = exportedSpans.filter((s) => s.name === "agent-turn");

      expect(modelEventSpan).toBeDefined();
      expect(modelEventSpan?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE]).toBe("event");
      expect(genSpan).toBeDefined();

      expect(genSpan?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_MODEL]).toBe(
        "gemini-3.8-flash-high",
      );

      expect(rootSpans[0]?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL]).toBe(
        "WARNING",
      );

      expect(rootSpans[1]?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT]).toBe(
        "git status",
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("exports interrupted turns with WARNING level and tracks monotonic lineIndex across reused step_index", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-cursor-line-test-"));

    try {
      const logsDir = path.join(tempDir, "conv-line-cursor", ".system_generated", "logs");

      fs.mkdirSync(logsDir, { recursive: true });

      const compactPath = path.join(logsDir, "transcript.jsonl");
      const cursorPath = path.join(logsDir, ".langfuse-cursor.json");

      // Phase 1: Turn 1 (step 20..21) + interrupted "ds" (step 22)
      const phase1Lines = [
        JSON.stringify({
          step_index: 20,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-15T16:22:43Z",
          content: "<USER_REQUEST>\nsdds\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 21,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-15T16:22:43Z",
          input_tokens: 100,
          output_tokens: 20,
          content: "Looks like a typo.",
        }),
        JSON.stringify({
          step_index: 22,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-15T16:22:53Z",
          content: "<USER_REQUEST>\nds\n</USER_REQUEST>",
        }),
      ];

      fs.writeFileSync(compactPath, phase1Lines.join("\n"), "utf8");

      const phase1Spans: Array<{ name: string; attributes: Record<string, unknown> }> = [];
      const phase1 = await runStopHook(
        {
          conversationId: "conv-line-cursor",
          transcriptPath: compactPath,
          modelName: "gemini-3.8-flash-high",
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                phase1Spans.push({ name: s.name, attributes: { ...s.attributes } });
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(phase1.exportedTurns).toBe(2);

      const interruptedRoot = phase1Spans.filter((s) => s.name === "agent-turn")[1];

      expect(interruptedRoot?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_INPUT]).toBe("ds");

      expect(interruptedRoot?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL]).toBe(
        "WARNING",
      );

      const savedCursor1 = JSON.parse(fs.readFileSync(cursorPath, "utf8")) as {
        lastExportedStepIndex: number;
        lastExportedLineIndex?: number;
      };

      expect(savedCursor1.lastExportedStepIndex).toBe(22);
      expect(savedCursor1.lastExportedLineIndex).toBe(2);

      // Phase 2: "s" arrives (step 23..24) AND another turn reuses step_index 23..24
      const phase2Lines = [
        ...phase1Lines,
        JSON.stringify({
          step_index: 23,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-15T16:23:00Z",
          content: "<USER_REQUEST>\ns\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 24,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-15T16:23:00Z",
          input_tokens: 150,
          output_tokens: 25,
          content: "I am online.",
        }),
        JSON.stringify({
          step_index: 23,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-15T16:23:54Z",
          content: "<USER_REQUEST>\ns\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 24,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-15T16:23:54Z",
          input_tokens: 200,
          output_tokens: 30,
          content: "Messages arrived as random chars.",
        }),
      ];

      fs.writeFileSync(compactPath, phase2Lines.join("\n"), "utf8");

      const phase2Spans: Array<{ name: string; attributes: Record<string, unknown> }> = [];
      const phase2 = await runStopHook(
        {
          conversationId: "conv-line-cursor",
          transcriptPath: compactPath,
          modelName: "gemini-3.8-flash-high",
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                phase2Spans.push({ name: s.name, attributes: { ...s.attributes } });
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(phase2.exportedTurns).toBe(2);

      // Export through Turn 3 first, then append Turn 4 with reused step_index 23..24
      fs.writeFileSync(compactPath, phase2Lines.slice(0, 5).join("\n"), "utf8");
      fs.rmSync(cursorPath, { force: true });

      await runStopHook(
        {
          conversationId: "conv-line-cursor",
          transcriptPath: compactPath,
          modelName: "gemini-3.8-flash-high",
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: {
            export(_spans, resultCallback) {
              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      fs.writeFileSync(compactPath, phase2Lines.join("\n"), "utf8");

      const phase3Spans: Array<{ name: string; attributes: Record<string, unknown> }> = [];
      const phase3 = await runStopHook(
        {
          conversationId: "conv-line-cursor",
          transcriptPath: compactPath,
          modelName: "gemini-3.8-flash-high",
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                phase3Spans.push({ name: s.name, attributes: { ...s.attributes } });
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(phase3.exportedTurns).toBe(1);

      const finalGen = phase3Spans.find((s) => s.name === "llm-generation");

      expect(finalGen?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT]).toBe(
        JSON.stringify({
          role: "assistant",
          content: "Messages arrived as random chars.",
        }),
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("propagates hasPreviousTurn string attribute and exports terminationReason, failedTools, and gateSummary on agent-turn spans", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-eval-ctx-test-"));

    try {
      const logsDir = path.join(tempDir, "conv-eval-ctx", ".system_generated", "logs");

      fs.mkdirSync(logsDir, { recursive: true });

      const compactPath = path.join(logsDir, "transcript.jsonl");
      const lines = [
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-16T14:00:00Z",
          content: "<USER_REQUEST>\nRun lint\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-16T14:00:01Z",
          tool_calls: [{ name: "run_command", args: { CommandLine: "pnpm lint" } }],
        }),
        JSON.stringify({
          step_index: 2,
          source: "MODEL",
          type: "GENERIC",
          status: "ERROR",
          error: "Lint error",
          created_at: "2026-11-16T14:00:02Z",
          content: "Lint error",
        }),
        JSON.stringify({
          step_index: 3,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-16T14:00:03Z",
          content: "Lint failed.",
        }),
        JSON.stringify({
          step_index: 4,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-16T14:01:00Z",
          content: "<USER_REQUEST>\nFix and recheck\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 5,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-16T14:01:01Z",
          content: "Working on fix...",
          tool_calls: [{ name: "run_command", args: { CommandLine: "pnpm lint" } }],
        }),
        JSON.stringify({
          step_index: 6,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-16T14:01:02Z",
          content: "lint ok",
        }),
      ].join("\n");

      fs.writeFileSync(compactPath, lines, "utf8");

      const exportedSpans: Array<{
        name: string;
        attributes: Record<string, unknown>;
      }> = [];

      const result = await runStopHook(
        {
          conversationId: "conv-eval-ctx",
          transcriptPath: compactPath,
          modelName: "gemini-4-hydrogen-high",
          cwd: tempDir,
          terminationReason: "USER_CANCELED",
          fullyIdle: true,
          continuationActive: false,
        },
        {
          skillDirs: [],
          spanExporter: {
            export(spans, resultCallback) {
              for (const s of spans) {
                exportedSpans.push({
                  name: s.name,
                  attributes: { ...s.attributes },
                });
              }

              resultCallback({ code: 0 });
            },
            shutdown: async () => {},
          },
        },
      );

      expect(result.exportedTurns).toBe(2);

      const rootSpans = exportedSpans.filter((s) => s.name === "agent-turn");

      expect(rootSpans).toHaveLength(2);

      const turn1Root = rootSpans[0]!;
      const turn2Root = rootSpans[1]!;

      expect(turn1Root.attributes["langfuse.trace.metadata.hasPreviousTurn"]).toBe('"false"');

      expect(turn1Root.attributes["langfuse.observation.metadata.failedTools"]).toBe(
        JSON.stringify(["run_command:lint (step 2)"]),
      );

      expect(turn1Root.attributes["langfuse.observation.metadata.gateSummary"]).toBe(
        JSON.stringify({
          totalRuns: 1,
          firstTryPassed: false,
          finalPassed: false,
          retryCount: 0,
          failedGates: ["run_command:lint"],
        }),
      );

      expect(
        turn1Root.attributes["langfuse.observation.metadata.terminationReason"],
      ).toBeUndefined();

      expect(turn2Root.attributes["langfuse.trace.metadata.hasPreviousTurn"]).toBe('"true"');

      expect(turn2Root.attributes["langfuse.observation.metadata.previousTurnInput"]).toBe(
        '"Run lint"',
      );

      expect(turn2Root.attributes["langfuse.observation.metadata.previousTurnOutput"]).toBe(
        '"Lint failed."',
      );

      expect(turn2Root.attributes["langfuse.observation.metadata.terminationReason"]).toBe(
        '"USER_CANCELED"',
      );

      expect(turn2Root.attributes["langfuse.observation.metadata.interrupted"]).toBe("true");
      expect(turn2Root.attributes[LangfuseOtelSpanAttributes.OBSERVATION_LEVEL]).toBe("WARNING");

      expect(turn2Root.attributes[LangfuseOtelSpanAttributes.OBSERVATION_STATUS_MESSAGE]).toBe(
        "Turn canceled by user (USER_CANCELED)",
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("links async swarm worker spans as children of parent trace and avoids duplicate root spans on reactive wakeup", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-swarm-link-test-"));

    try {
      const brainDir = path.join(tempDir, "brain");
      const parentId = "3f087a98-f295-4f0a-9d71-46226c1ff802";
      const workerId = "05a9b8a6-d0f5-410d-97a9-206aac18256b";
      const parentLogsDir = path.join(brainDir, parentId, ".system_generated", "logs");
      const workerLogsDir = path.join(brainDir, workerId, ".system_generated", "logs");

      fs.mkdirSync(parentLogsDir, { recursive: true });
      fs.mkdirSync(workerLogsDir, { recursive: true });

      const parentFullPath = path.join(parentLogsDir, "transcript_full.jsonl");
      const workerFullPath = path.join(workerLogsDir, "transcript_full.jsonl");

      const parentPhase1Lines = [
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-23T19:47:43Z",
          content: "<USER_REQUEST>\nLaunch worker and greet\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-23T19:47:50Z",
          input_tokens: 1000,
          output_tokens: 50,
          tool_calls: [
            {
              name: "swarm",
              args: { action: '"add"', name: '"worker"', brief: '"Say hello"' },
            },
          ],
        }),
        JSON.stringify({
          step_index: 2,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-23T19:47:51Z",
          content: `{"status":"added","conversation_id":"${workerId}"}`,
        }),
        JSON.stringify({
          step_index: 3,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-23T19:47:53Z",
          input_tokens: 1100,
          output_tokens: 40,
          content: "Worker launched.",
        }),
      ];

      fs.writeFileSync(parentFullPath, parentPhase1Lines.join("\n"), "utf8");

      const exportedSpans: Array<{
        name: string;
        traceId: string;
        spanId: string;
        parentSpanId?: string;
        attributes: Record<string, unknown>;
      }> = [];

      const collectExporter = {
        export(
          spans: Array<{
            name: string;
            spanContext: () => { traceId: string; spanId: string };
            parentSpanContext?: { spanId?: string };
            attributes: Record<string, unknown>;
          }>,
          resultCallback: (res: { code: number }) => void,
        ) {
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
      };

      const parentTurn1Res = await runStopHook(
        {
          conversationId: parentId,
          transcriptPath: parentFullPath,
          modelName: "gemini-3.8-flash-high",
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: collectExporter,
        },
      );

      expect(parentTurn1Res.exportedTurns).toBe(1);

      const expectedTurn1TraceId = await createTraceId(`${parentId}-turn-1`);
      const workerAgentSpan = exportedSpans.find((s) => s.name === "subagent:worker");

      expect(workerAgentSpan).toBeDefined();
      expect(workerAgentSpan?.traceId).toBe(expectedTurn1TraceId);

      expect(workerAgentSpan?.attributes[LangfuseOtelSpanAttributes.OBSERVATION_TYPE]).toBe(
        "agent",
      );

      const spoolDir = path.join(brainDir, ".langfuse-spool");
      const savedLink = readSubagentLink(spoolDir, workerId);

      expect(savedLink?.parentTraceId).toBe(expectedTurn1TraceId);
      expect(savedLink?.parentSpanId).toBe(workerAgentSpan?.spanId);

      // Now worker completes its own turn in its own Stop Hook
      const workerLines = [
        JSON.stringify({
          step_index: 0,
          source: "SYSTEM",
          type: "SYSTEM_MESSAGE",
          status: "DONE",
          created_at: "2026-11-23T19:48:00Z",
          content: `<SYSTEM_MESSAGE>\n[Message] sender=${parentId} content=Say hello\n</SYSTEM_MESSAGE>`,
        }),
        JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-23T19:48:02Z",
          input_tokens: 500,
          output_tokens: 30,
          tool_calls: [{ name: "post_board", args: { message: '"Hello!"' } }],
        }),
        JSON.stringify({
          step_index: 2,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-23T19:48:03Z",
          content: "Posted.",
        }),
        JSON.stringify({
          step_index: 3,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-23T19:48:04Z",
          input_tokens: 550,
          output_tokens: 20,
          content: "Greeted user.",
        }),
      ];

      fs.writeFileSync(workerFullPath, workerLines.join("\n"), "utf8");

      const spansBeforeWorker = exportedSpans.length;
      const workerRes = await runStopHook(
        {
          conversationId: workerId,
          transcriptPath: workerFullPath,
          modelName: "gemini-3.8-flash-low",
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: collectExporter,
        },
      );

      expect(workerRes.exportedTurns).toBe(1);
      expect(workerRes.summary[0]?.traceId).toBe(expectedTurn1TraceId);

      const workerSpans = exportedSpans.slice(spansBeforeWorker);

      expect(workerSpans.some((s) => s.name === LINK_ANCHOR_SPAN_NAME)).toBe(false);
      expect(workerSpans.some((s) => s.name === "agent-turn")).toBe(false);
      expect(workerSpans.length).toBeGreaterThanOrEqual(4);

      for (const ws of workerSpans) {
        expect(ws.traceId).toBe(expectedTurn1TraceId);
        expect(ws.parentSpanId).toBe(workerAgentSpan?.spanId);
        expect(ws.attributes[LangfuseOtelSpanAttributes.TRACE_SESSION_ID]).toBe(parentId);
        expect(ws.attributes[LangfuseOtelSpanAttributes.IS_APP_ROOT]).toBeUndefined();
      }

      // Now coordinator receives reactive wakeup and runs Stop Hook again
      const parentPhase2Lines = [
        ...parentPhase1Lines,
        JSON.stringify({
          step_index: 4,
          source: "SYSTEM",
          type: "SYSTEM_MESSAGE",
          status: "DONE",
          created_at: "2026-11-23T19:48:13Z",
          content: `<SYSTEM_MESSAGE>\n[Message] sender=${workerId} content=[swarm] new board message #2\n</SYSTEM_MESSAGE>`,
        }),
        JSON.stringify({
          step_index: 5,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-23T19:48:14Z",
          input_tokens: 1200,
          output_tokens: 25,
          content: "Worker finished greeting.",
        }),
      ];

      fs.writeFileSync(parentFullPath, parentPhase2Lines.join("\n"), "utf8");

      const spansBeforeTurn2 = exportedSpans.length;
      const parentTurn2Res = await runStopHook(
        {
          conversationId: parentId,
          transcriptPath: parentFullPath,
          modelName: "gemini-3.8-flash-high",
          cwd: tempDir,
        },
        {
          skillDirs: [],
          spanExporter: collectExporter,
        },
      );

      expect(parentTurn2Res.exportedTurns).toBe(1);

      const expectedTurn2TraceId = await createTraceId(`${parentId}-turn-2`);

      expect(parentTurn2Res.summary[0]?.traceId).toBe(expectedTurn2TraceId);

      const turn2Spans = exportedSpans.slice(spansBeforeTurn2);
      const turn2Root = turn2Spans.find((s) => s.name === "agent-turn");

      expect(turn2Root).toBeDefined();
      expect(turn2Root?.traceId).toBe(expectedTurn2TraceId);
      expect(turn2Root?.attributes["langfuse.trace.metadata.hasPreviousTurn"]).toBe('"false"');
      // Ensure Turn 1 steps (swarm call) were NOT re-emitted in Turn 2
      expect(turn2Spans.some((s) => s.name === "subagent:worker")).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("emits deterministic spanIds across repeated exports of the same turn", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "z-trader-deterministic-span-test-"));

    try {
      const logsDir = path.join(tempDir, "conv-det-1", ".system_generated", "logs");

      fs.mkdirSync(logsDir, { recursive: true });

      const fullPath = path.join(logsDir, "transcript_full.jsonl");
      const cursorPath = path.join(logsDir, ".langfuse-cursor.json");

      const lines = [
        JSON.stringify({
          step_index: 0,
          source: "USER_EXPLICIT",
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-23T22:06:10Z",
          content: "<USER_REQUEST>\nRead doc\n</USER_REQUEST>",
        }),
        JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-23T22:06:18Z",
          input_tokens: 100,
          output_tokens: 20,
          tool_calls: [{ id: "call-read-1", name: "read_file", args: { Path: '"README.md"' } }],
        }),
        JSON.stringify({
          step_index: 2,
          source: "MODEL",
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-23T22:06:20Z",
          content: "# Readme",
        }),
        JSON.stringify({
          step_index: 3,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-23T22:06:22Z",
          input_tokens: 150,
          output_tokens: 30,
          content: "Done.",
        }),
      ].join("\n");

      fs.writeFileSync(fullPath, lines, "utf8");

      const captureRun = async () => {
        const captured: Array<{
          name: string;
          traceId: string;
          spanId: string;
          parentSpanId?: string;
        }> = [];

        await runStopHook(
          {
            conversationId: "conv-det-1",
            transcriptPath: fullPath,
            cwd: tempDir,
          },
          {
            skillDirs: [],
            spanExporter: {
              export(spans, resultCallback) {
                for (const s of spans) {
                  captured.push({
                    name: s.name,
                    traceId: s.spanContext().traceId,
                    spanId: s.spanContext().spanId,
                    parentSpanId: s.parentSpanContext?.spanId,
                  });
                }

                resultCallback({ code: 0 });
              },
              shutdown: async () => {},
            },
          },
        );

        return captured;
      };

      const first = await captureRun();

      fs.rmSync(cursorPath, { force: true });

      const second = await captureRun();

      expect(first).toHaveLength(4);
      expect(second).toEqual(first);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

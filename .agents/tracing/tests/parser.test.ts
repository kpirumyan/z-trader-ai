// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSyntheticToolCallId,
  collectTagsFromValue,
  createFilesystemSubagentResolver,
  deriveSubagentObservationName,
  deserializeToolArgs,
  extractGenericTimingAndBody,
  extractSubagentConversationId,
  extractSystemMessageContent,
  extractUserRequest,
  parseIsoTimestamp,
  parseJsonlSteps,
  parseTranscriptTurns,
  resolveFullTranscriptPath,
} from "../index.ts";

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

describe("extractSystemMessageContent", () => {
  it("extracts inner content from <SYSTEM_MESSAGE> blocks excluding preamble text", () => {
    const raw = [
      "The following is a <SYSTEM_MESSAGE> not actually sent by the user. It is provided by the system as important information to pay attention to.",
      "",
      "<SYSTEM_MESSAGE>",
      "[Message] timestamp=2026-11-12T21:47:03Z sender=system priority=MESSAGE_PRIORITY_LOW content=[Notice] Server restarted.",
      "</SYSTEM_MESSAGE>",
    ].join("\n");

    const content = extractSystemMessageContent(raw);

    expect(content).toBe(
      "[Message] timestamp=2026-11-12T21:47:03Z sender=system priority=MESSAGE_PRIORITY_LOW content=[Notice] Server restarted.",
    );
  });

  it("returns trimmed raw content when <SYSTEM_MESSAGE> wrapper is absent", () => {
    const content = extractSystemMessageContent("  System notification: task resumed.  ");

    expect(content).toBe("System notification: task resumed.");
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

describe("buildSyntheticToolCallId", () => {
  it("generates deterministic, collision-free tool call IDs scoped by conversation slug, step index, and tool index", () => {
    // UUID conversation ID uses first 8 hex characters
    expect(buildSyntheticToolCallId("5c98cb8c-04dd-48fe-9a4c-3856bf8c2863", 1, 0)).toBe(
      "call_5c98cb8c_s1_0",
    );

    expect(buildSyntheticToolCallId("5c98cb8c-04dd-48fe-9a4c-3856bf8c2863", 1, 1)).toBe(
      "call_5c98cb8c_s1_1",
    );

    // Subagent with distinct UUID has completely different ID prefix even on step 1 tool 0
    expect(buildSyntheticToolCallId("9ddfebd8-12ae-4c62-a4d5-f022c9a8519d", 1, 0)).toBe(
      "call_9ddfebd8_s1_0",
    );

    // Custom named conversations
    expect(buildSyntheticToolCallId("conv-hook-1", 1, 0)).toBe("call_convhook1_s1_0");
    expect(buildSyntheticToolCallId("conv-system-msg", 2, 0)).toBe("call_convsystemms_s2_0");
    expect(buildSyntheticToolCallId("", 1, 0)).toBe("call_agent_s1_0");
  });
});

describe("timing-extractor, tagger, subagent-resolver, and jsonl-reader helpers", () => {
  it("parses ISO timestamps with fallback and extracts Created At / Completed At headers", () => {
    const fallback = new Date("2026-11-11T00:00:00Z");

    expect(parseIsoTimestamp("invalid-date", fallback)).toBe(fallback);

    const extracted = extractGenericTimingAndBody(
      "Created At: 2026-11-11T10:00:00Z\nCompleted At: 2026-11-11T10:00:05Z\nOutput body",
      fallback,
    );

    expect(extracted.startTime.toISOString()).toBe("2026-11-11T10:00:00.000Z");
    expect(extracted.endTime.toISOString()).toBe("2026-11-11T10:00:05.000Z");
    expect(extracted.cleanBody).toBe("Output body");
  });

  it("collects module and skill tags and derives subagent identifiers", () => {
    const tags = new Set<string>();

    collectTagsFromValue(
      {
        files: ["src/modules/order-book/index.ts", ".agents/skills/adr/SKILL.md"],
      },
      tags,
    );

    expect([...tags].sort()).toEqual(["module:order-book", "skill:adr"]);

    expect(deriveSubagentObservationName({ Role: "Database Debugger" })).toBe(
      "subagent:database-debugger",
    );

    expect(
      extractSubagentConversationId(
        {},
        "Done: conversationId: 12345678-1234-1234-1234-123456789abc",
      ),
    ).toBe("12345678-1234-1234-1234-123456789abc");

    expect(
      parseJsonlSteps(
        '{"step_index":2,"type":"GENERIC"}\ncorrupt\n{"step_index":1,"type":"USER_INPUT"}',
      ).map((s) => s.step_index),
    ).toEqual([1, 2]);
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

    expect(turn1.usageSummary).toEqual({
      input: 2700,
      output: 240,
      cacheReadInputTokens: 1800,
      total: 4740,
    });

    expect(turn1.tags).toEqual(["module:chart", "skill:langfuse"]);

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

      expect(gen1.input).toEqual([
        { role: "user", content: "Audit chart module and langfuse skill" },
      ]);
    }

    const gen2 = turn1.children[4]!;

    expect(gen2.type).toBe("generation");

    if (gen2.type === "generation") {
      expect(gen2.input).toHaveLength(5);

      expect(gen2.input[0]).toEqual({
        role: "user",
        content: "Audit chart module and langfuse skill",
      });

      expect(gen2.input[1]?.role).toBe("assistant");
      expect(gen2.input[1]?.tool_calls).toHaveLength(3);

      expect(gen2.input[2]).toEqual({
        role: "tool",
        tool_call_id: "call_5c98cb8c_s1_0",
        content: "Showing lines 1-2 of 2\n1: export const Chart = {};",
      });

      expect(gen2.input[3]).toEqual({
        role: "tool",
        tool_call_id: "call_5c98cb8c_s1_1",
        content: "Showing lines 1-1 of 1\n1: # Langfuse Skill",
      });

      expect(gen2.input[4]).toEqual({
        role: "tool",
        tool_call_id: "call_5c98cb8c_s1_2",
        content: "file does not exist",
      });
    }

    const tool1 = turn1.children[1]!;

    expect(tool1.type).toBe("tool");

    if (tool1.type === "tool") {
      expect(tool1.toolCallId).toBe("call_5c98cb8c_s1_0");
      expect(tool1.metadata.toolCallId).toBe("call_5c98cb8c_s1_0");

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

    const turn2 = turns[1]!;
    const turn2Gen = turn2.children[0]!;

    expect(turn2Gen.type).toBe("generation");

    if (turn2Gen.type === "generation") {
      expect(turn2Gen.input).toHaveLength(7);

      expect(turn2Gen.input[5]).toEqual({
        role: "assistant",
        content: "Audit complete: chart module and langfuse skill verified.",
      });

      expect(turn2Gen.input[6]).toEqual({
        role: "user",
        content: "Now check order-book",
      });
    }

    const incrementalTurns = parseTranscriptTurns(mainTranscriptLines, {
      conversationId,
      modelName: "gemini-4-argon",
      afterStepIndex: 5,
    });

    expect(incrementalTurns).toHaveLength(1);
    expect(incrementalTurns[0]!.turnIndex).toBe(2);
    expect(incrementalTurns[0]!.traceSeed).toBe(`${conversationId}-turn-2`);

    const incGen = incrementalTurns[0]!.children[0]!;

    expect(incGen.type).toBe("generation");

    if (incGen.type === "generation") {
      expect(incGen.input).toHaveLength(7);

      expect(incGen.input[6]).toEqual({
        role: "user",
        content: "Now check order-book",
      });
    }
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

    expect(turn.children.map((c) => `${c.type}:${c.name}`)).toEqual([
      "generation:llm-generation",
      "agent:subagent:codebase-researcher",
      "generation:llm-generation",
    ]);

    const agentObs = turn.children[1]!;

    expect(agentObs.type).toBe("agent");

    if (agentObs.type === "agent") {
      expect(agentObs.subagentConversationId).toBe(subagentId);
      expect(agentObs.toolCallId).toBe("call_5c98cb8c_s1_0");
      expect(agentObs.metadata.toolCallId).toBe("call_5c98cb8c_s1_0");

      expect(agentObs.children.map((c) => `${c.type}:${c.name}`)).toEqual([
        "generation:llm-generation",
        "tool:read_file",
        "generation:llm-generation",
      ]);

      const subagentTool = agentObs.children[1]!;

      expect(subagentTool.type).toBe("tool");

      if (subagentTool.type === "tool") {
        expect(subagentTool.toolCallId).toBe("call_11111111_s1_0");
        expect(subagentTool.metadata.toolCallId).toBe("call_11111111_s1_0");
      }

      expect(agentObs.usageSummary).toEqual({
        input: 650,
        output: 60,
        cacheReadInputTokens: 250,
        total: 960,
      });
    }

    expect(turn.usageSummary).toEqual({
      input: 1650,
      output: 150,
      cacheReadInputTokens: 750,
      total: 2550,
    });

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

  it("truncates huge tool outputs exceeding 30,000 characters in conversation history", () => {
    const hugeOutput = "A".repeat(40000);
    const lines = [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-11T18:00:00Z",
        content: "<USER_REQUEST>\nPrint large output\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-11T18:00:01Z",
        tool_calls: [{ name: "run_command", args: { CommandLine: "echo large" } }],
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-11T18:00:03Z",
        content: `Created At: 2026-11-11T18:00:02Z\nCompleted At: 2026-11-11T18:00:03Z\n${hugeOutput}`,
      }),
      JSON.stringify({
        step_index: 3,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-11T18:00:05Z",
        content: "Done processing large output.",
      }),
    ].join("\n");

    const turns = parseTranscriptTurns(lines, {
      conversationId: "conv-large",
    });

    expect(turns).toHaveLength(1);

    const turn = turns[0]!;
    const gen2 = turn.children[2]!;

    expect(gen2.type).toBe("generation");

    if (gen2.type === "generation") {
      const toolMsg = gen2.input.find((m) => m.role === "tool");

      expect(toolMsg).toBeDefined();
      expect(toolMsg?.content?.length).toBeLessThan(35000);
      expect(toolMsg?.content).toContain("... [truncated for observation history]");
    }
  });

  it("records SYSTEM_MESSAGE steps as role: system messages in generation history", () => {
    const lines = [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-12T10:00:00Z",
        content: "<USER_REQUEST>\nCheck status\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 1,
        source: "SYSTEM",
        type: "SYSTEM_MESSAGE",
        status: "DONE",
        created_at: "2026-11-12T10:00:01Z",
        content:
          "The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Notice] System rebooted.\n</SYSTEM_MESSAGE>",
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-12T10:00:02Z",
        input_tokens: 100,
        output_tokens: 20,
        tool_calls: [{ name: "run_command", args: { CommandLine: "echo test" } }],
      }),
      JSON.stringify({
        step_index: 3,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-12T10:00:04Z",
        content:
          "Created At: 2026-11-12T10:00:03Z\nCompleted At: 2026-11-12T10:00:04Z\ntest output",
      }),
      JSON.stringify({
        step_index: 4,
        source: "SYSTEM",
        type: "SYSTEM_MESSAGE",
        status: "DONE",
        created_at: "2026-11-12T10:00:05Z",
        content:
          "The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[BROWSER_HOST_FACTS] visited_origins: none\n</SYSTEM_MESSAGE>",
      }),
      JSON.stringify({
        step_index: 5,
        source: "SYSTEM",
        type: "SYSTEM_MESSAGE",
        status: "DONE",
        created_at: "2026-11-12T10:00:06Z",
        content:
          "The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n[Subagent] task done.\n</SYSTEM_MESSAGE>",
      }),
      JSON.stringify({
        step_index: 6,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-12T10:00:07Z",
        input_tokens: 200,
        output_tokens: 30,
        content: "All clear.",
      }),
    ].join("\n");

    const turns = parseTranscriptTurns(lines, {
      conversationId: "conv-system-msg",
      modelName: "gemini-3.8-flash",
    });

    expect(turns).toHaveLength(1);

    const turn = turns[0]!;

    expect(turn.metadata.systemMessageCount).toBe(3);

    const gen1 = turn.children[0]!;

    expect(gen1.type).toBe("generation");

    if (gen1.type === "generation") {
      expect(gen1.input).toEqual([
        { role: "user", content: "Check status" },
        { role: "system", content: "[Notice] System rebooted." },
      ]);
    }

    const gen2 = turn.children[2]!;

    expect(gen2.type).toBe("generation");

    if (gen2.type === "generation") {
      expect(gen2.input).toEqual([
        { role: "user", content: "Check status" },
        { role: "system", content: "[Notice] System rebooted." },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_convsystemms_s2_0",
              type: "function",
              function: {
                name: "run_command",
                arguments: JSON.stringify({ CommandLine: "echo test" }),
              },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_convsystemms_s2_0", content: "test output" },
        { role: "system", content: "[BROWSER_HOST_FACTS] visited_origins: none" },
        { role: "system", content: "[Subagent] task done." },
      ]);
    }
  });

  it("truncates oversized SYSTEM_MESSAGE content exceeding 30,000 characters", () => {
    const hugeMsg = "X".repeat(40000);
    const lines = [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-12T10:00:00Z",
        content: "Hello",
      }),
      JSON.stringify({
        step_index: 1,
        source: "SYSTEM",
        type: "SYSTEM_MESSAGE",
        status: "DONE",
        created_at: "2026-11-12T10:00:01Z",
        content: `<SYSTEM_MESSAGE>\n${hugeMsg}\n</SYSTEM_MESSAGE>`,
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-12T10:00:02Z",
        content: "Received.",
      }),
    ].join("\n");

    const turns = parseTranscriptTurns(lines, {
      conversationId: "conv-huge-system",
    });

    const turn = turns[0]!;
    const gen = turn.children[0]!;

    expect(gen.type).toBe("generation");

    if (gen.type === "generation") {
      const sysMsg = gen.input.find((m) => m.role === "system");

      expect(sysMsg).toBeDefined();
      expect(sysMsg?.content?.length).toBeLessThan(35000);
      expect(sysMsg?.content).toContain("... [truncated for observation history]");
    }
  });
});

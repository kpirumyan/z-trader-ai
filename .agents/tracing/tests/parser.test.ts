// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSyntheticToolCallId,
  classifySystemMessageName,
  classifyToolCall,
  collectModuleTagsFromToolArgs,
  collectTagsFromValue,
  createFilesystemSubagentResolver,
  deriveSubagentObservationName,
  deserializeToolArgs,
  extractGenericTimingAndBody,
  extractSubagentConversationId,
  extractSystemMessageContent,
  extractUserRequest,
  matchSkillFilePath,
  normalizeModelIdentifier,
  parseIsoTimestamp,
  parseJsonlSteps,
  parseTranscriptTurns,
  parseUserSettingsChanges,
  resolveFullTranscriptPath,
  type ParsedSettingsChange,
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

    const multiHeader = extractGenericTimingAndBody(
      "Created At: 2026-11-11T10:00:00Z\nCompleted At: 2026-11-11T10:00:02Z\nCreated At: 2026-11-11T10:00:02Z\nCompleted At: 2026-11-11T10:00:05Z\nCommand failed to run: deny .env",
      fallback,
    );

    expect(multiHeader.startTime.toISOString()).toBe("2026-11-11T10:00:00.000Z");
    expect(multiHeader.endTime.toISOString()).toBe("2026-11-11T10:00:05.000Z");
    expect(multiHeader.cleanBody).toBe("Command failed to run: deny .env");
  });

  it("collects module tags strictly from path/command args and derives subagent identifiers", () => {
    const tags = new Set<string>();

    collectTagsFromValue(
      {
        files: ["src/modules/order-book/index.ts", ".agents/skills/adr/SKILL.md"],
      },
      tags,
    );

    expect([...tags].sort()).toEqual(["module:order-book"]);

    const argTags = new Set<string>();

    collectModuleTagsFromToolArgs(
      {
        Path: "c:\\DATA\\Development\\js\\z-trader-ai\\src\\modules\\chart\\index.ts",
        CommandLine: "pnpm test:unit src/modules/orders/orders.test.ts",
        Content: "Mentions src/modules/fake-prose/index.ts in docs",
        Prompt: "Ignore src/modules/another-prose/index.ts",
      },
      argTags,
    );

    expect([...argTags].sort()).toEqual(["module:chart", "module:orders"]);

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
    ).toEqual([2, 1]);
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

    expect(turn1.tags).toEqual(["module:chart"]);

    expect(turn1.metadata.observationCounts).toEqual({
      generation: 2,
      agent: 0,
      retriever: 2,
      evaluator: 0,
      guardrail: 0,
      tool: 1,
      event: 0,
    });

    expect(turn1.children.map((c) => `${c.type}:${c.name}`)).toEqual([
      "generation:llm-generation",
      "retriever:read_file",
      "tool:skill_read",
      "retriever:read_file",
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

      expect(gen1.output.tool_calls?.map((tc) => tc.function.name)).toEqual([
        "read_file",
        "read_file",
        "read_file",
      ]);

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

    expect(tool1.type).toBe("retriever");

    if (tool1.type === "retriever") {
      expect(tool1.rawToolName).toBe("read_file");
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

    const skillTool = turn1.children[2]!;

    expect(skillTool.type).toBe("tool");

    if (skillTool.type === "tool") {
      expect(skillTool.name).toBe("skill_read");
      expect(skillTool.rawToolName).toBe("read_file");

      expect(skillTool.input).toEqual({
        Path: "c:\\DATA\\Development\\js\\z-trader-ai\\.agents\\skills\\langfuse\\SKILL.md",
        skillName: "langfuse",
        path: "SKILL.md",
      });

      expect(skillTool.metadata.skillName).toBe("langfuse");
      expect(skillTool.metadata.skillPath).toBe("SKILL.md");
    }

    const failedTool = turn1.children[3]!;

    expect(failedTool.type).toBe("retriever");

    if (failedTool.type === "retriever") {
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

  it("preserves execution sequence across retried turns with identical step indexes and pairs tool outputs", () => {
    const raw = [
      JSON.stringify({
        step_index: 12,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-14T17:26:13Z",
        content: "<USER_REQUEST>\ngit status\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 12,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-14T17:26:32Z",
        content: "<USER_REQUEST>\ngit status\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 13,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-14T17:26:32Z",
        tool_calls: [{ name: "run_command", args: { CommandLine: "git status" } }],
      }),
      JSON.stringify({
        step_index: 14,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-14T17:26:37Z",
        content:
          "Created At: 2026-11-14T21:26:37+04:00\nCompleted At: 2026-11-14T21:26:37+04:00\nCommand failed to run: sandbox configuration error: deny .env: non-absolute file path.",
      }),
      JSON.stringify({
        step_index: 15,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-14T17:26:37Z",
        tool_calls: [
          { name: "run_command", args: { BypassSandbox: true, CommandLine: "git status" } },
        ],
      }),
      JSON.stringify({
        step_index: 16,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-14T17:26:39Z",
        content:
          "Created At: 2026-11-14T21:26:39+04:00\nCompleted At: 2026-11-14T21:26:40+04:00\nOn branch main\nnothing to commit",
      }),
      JSON.stringify({
        step_index: 17,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-14T17:26:40Z",
        content: "Branch is clean.",
      }),
      JSON.stringify({
        step_index: 12,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-14T17:55:14Z",
        content: "<USER_REQUEST>\ngit status\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 13,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-14T17:55:14Z",
        tool_calls: [{ name: "run_command", args: { CommandLine: "git status" } }],
      }),
      JSON.stringify({
        step_index: 14,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-14T17:55:16Z",
        content: "Command failed to run: sandbox configuration error",
      }),
      JSON.stringify({
        step_index: 15,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-14T17:55:17Z",
        content: "Done retry.",
      }),
    ].join("\n");

    const turns = parseTranscriptTurns(raw, {
      conversationId: "test-retry-conv",
      modelName: "test-model",
    });

    expect(turns).toHaveLength(3);

    const abandonedTurn = turns[0]!;

    expect(abandonedTurn.startStepIndex).toBe(12);
    expect(abandonedTurn.endStepIndex).toBe(12);
    expect(abandonedTurn.metadata.interrupted).toBe(true);
    expect(abandonedTurn.level).toBe("WARNING");
    expect(abandonedTurn.children).toHaveLength(0);

    const firstTurn = turns[1]!;

    expect(firstTurn.children).toHaveLength(5);

    const firstTurnGen = firstTurn.children[0]!;

    expect(firstTurnGen.type).toBe("generation");

    if (firstTurnGen.type === "generation") {
      expect(firstTurnGen.input).toEqual([{ role: "user", content: "git status" }]);
    }

    const firstTool = firstTurn.children[1]!;

    expect(firstTool.type).toBe("tool");

    if (firstTool.type === "tool") {
      expect(firstTool.output).toBe(
        "Command failed to run: sandbox configuration error: deny .env: non-absolute file path.",
      );
    }

    const secondTool = firstTurn.children[3]!;

    expect(secondTool.type).toBe("tool");

    if (secondTool.type === "tool") {
      expect(secondTool.output).toBe("On branch main\nnothing to commit");
    }

    const secondTurn = turns[2]!;

    expect(secondTurn.children).toHaveLength(3);

    const retryTool = secondTurn.children[1]!;

    expect(retryTool.type).toBe("tool");

    if (retryTool.type === "tool") {
      expect(retryTool.output).toBe("Command failed to run: sandbox configuration error");
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
        "retriever:read_file",
        "generation:llm-generation",
      ]);

      const subagentTool = agentObs.children[1]!;

      expect(subagentTool.type).toBe("retriever");

      if (subagentTool.type === "retriever") {
        expect(subagentTool.rawToolName).toBe("read_file");
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

    expect(turn.metadata.observationCounts).toEqual({
      generation: 2,
      agent: 0,
      retriever: 0,
      evaluator: 0,
      guardrail: 0,
      tool: 1,
      event: 3,
    });

    expect(turn.children.map((c) => `${c.type}:${c.name}`)).toEqual([
      "event:system:notice",
      "generation:llm-generation",
      "tool:run_command:echo",
      "event:system:browser-facts",
      "event:system:subagent",
      "generation:llm-generation",
    ]);

    const noticeEvent = turn.children[0]!;

    expect(noticeEvent.type).toBe("event");

    if (noticeEvent.type === "event") {
      expect(noticeEvent.input).toEqual({
        source: "SYSTEM",
        message: "[Notice] System rebooted.",
      });
    }

    const gen1 = turn.children[1]!;

    expect(gen1.type).toBe("generation");

    if (gen1.type === "generation") {
      expect(gen1.input).toEqual([
        { role: "user", content: "Check status" },
        { role: "system", content: "[Notice] System rebooted." },
      ]);
    }

    const gen2 = turn.children[5]!;

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
    const evt = turn.children[0]!;
    const gen = turn.children[1]!;

    expect(evt.type).toBe("event");
    expect(gen.type).toBe("generation");

    if (gen.type === "generation") {
      const sysMsg = gen.input.find((m) => m.role === "system");

      expect(sysMsg).toBeDefined();
      expect(sysMsg?.content?.length).toBeLessThan(35000);
      expect(sysMsg?.content).toContain("... [truncated for observation history]");
    }
  });

  it("enforces strict monotonic +1ms offset when timestamps collide between instantaneous tools and subsequent generations", () => {
    const lines = [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-12T14:26:59Z",
        content: "<USER_REQUEST>\ncheck docs\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-12T14:26:59Z",
        input_tokens: 100,
        output_tokens: 20,
        tool_calls: [
          {
            name: "read_file",
            args: { Path: '"doc.json"' },
          },
        ],
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-12T14:27:02Z",
        content:
          'Created At: 2026-11-12T14:27:02Z\nCompleted At: 2026-11-12T14:27:02Z\n{ "schema": true }',
      }),
      JSON.stringify({
        step_index: 3,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-12T14:27:02Z",
        input_tokens: 150,
        output_tokens: 30,
        tool_calls: [
          {
            name: "call_mcp_tool",
            args: { ToolName: '"search"' },
          },
        ],
      }),
      JSON.stringify({
        step_index: 4,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-12T14:28:08Z",
        content:
          "Created At: 2026-11-12T14:27:04Z\nCompleted At: 2026-11-12T14:28:08Z\nResults found",
      }),
      JSON.stringify({
        step_index: 5,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-12T14:28:08Z",
        input_tokens: 200,
        output_tokens: 50,
        content: "Here is the answer.",
      }),
    ].join("\n");

    const turns = parseTranscriptTurns(lines, {
      conversationId: "conv-monotonic-shift",
    });

    expect(turns).toHaveLength(1);

    const children = turns[0]!.children;

    expect(children).toHaveLength(5);

    expect(children.map((c) => `${c.type}:${c.name}`)).toEqual([
      "generation:llm-generation",
      "retriever:read_file",
      "generation:llm-generation",
      "retriever:mcp:search",
      "generation:llm-generation",
    ]);

    const gen1 = children[0]!;
    const tool1 = children[1]!;
    const gen2 = children[2]!;
    const tool2 = children[3]!;
    const gen3 = children[4]!;

    expect(gen1.startTime.toISOString()).toBe("2026-11-12T14:26:59.000Z");
    expect(gen1.endTime.toISOString()).toBe("2026-11-12T14:27:02.000Z");

    expect(tool1.startTime.toISOString()).toBe("2026-11-12T14:27:02.000Z");
    expect(tool1.endTime.toISOString()).toBe("2026-11-12T14:27:02.000Z");

    // Monotonic shift: gen2 starts 1ms after tool1 so it never collides or sorts before tool1 in Langfuse
    expect(gen2.startTime.toISOString()).toBe("2026-11-12T14:27:02.001Z");
    expect(gen2.endTime.toISOString()).toBe("2026-11-12T14:27:04.000Z");

    expect(tool2.startTime.toISOString()).toBe("2026-11-12T14:27:04.000Z");
    expect(tool2.endTime.toISOString()).toBe("2026-11-12T14:28:08.000Z");

    expect(gen3.startTime.toISOString()).toBe("2026-11-12T14:28:08.000Z");

    // Every consecutive observation must have strictly ascending start time
    for (let k = 0; k < children.length - 1; k++) {
      expect(children[k + 1]!.startTime.getTime()).toBeGreaterThan(
        children[k]!.startTime.getTime(),
      );
    }
  });
});

describe("semantic observation classification", () => {
  it("classifies retriever tools and skill reads across project, config, and builtin paths", () => {
    expect(classifyToolCall("grep_search", { Query: "OrderBook" })).toEqual({
      type: "retriever",
      observationName: "grep_search",
    });

    expect(classifyToolCall("search_web", { query: "langfuse otel" })).toEqual({
      type: "retriever",
      observationName: "search_web",
    });

    expect(
      classifyToolCall("read_file", {
        Path: "C:\\Users\\Karen\\.gemini\\config\\skills\\tdd\\SKILL.md",
      }),
    ).toEqual({
      type: "tool",
      observationName: "skill_read",
      normalizedInput: {
        Path: "C:\\Users\\Karen\\.gemini\\config\\skills\\tdd\\SKILL.md",
        skillName: "tdd",
        path: "SKILL.md",
      },
      skillMatch: {
        skillName: "tdd",
        relativePath: "SKILL.md",
      },
    });

    expect(
      classifyToolCall("view_file", {
        AbsolutePath: "C:/Users/Karen/.gemini/antigravity/builtin/skills/plugin/SKILL.md",
      }),
    ).toMatchObject({
      type: "tool",
      observationName: "skill_read",
      skillMatch: {
        skillName: "plugin",
        relativePath: "SKILL.md",
      },
    });

    expect(matchSkillFilePath("src/modules/chart/index.ts")).toBeNull();
  });

  it("classifies run_command strictly into evaluator, guardrail, or tool", () => {
    expect(classifyToolCall("run_command", { CommandLine: "pnpm test:unit" })).toEqual({
      type: "evaluator",
      observationName: "run_command:test:unit",
    });

    expect(classifyToolCall("run_command", { CommandLine: "pnpm check:fast" })).toEqual({
      type: "evaluator",
      observationName: "run_command:check:fast",
    });

    expect(
      classifyToolCall("run_command", { CommandLine: "npx vitest run tests/app.test.ts" }),
    ).toEqual({
      type: "evaluator",
      observationName: "run_command:vitest",
    });

    expect(classifyToolCall("run_command", { CommandLine: "pnpm lint" })).toEqual({
      type: "guardrail",
      observationName: "run_command:lint",
    });

    expect(classifyToolCall("run_command", { CommandLine: "pnpm depcruise" })).toEqual({
      type: "guardrail",
      observationName: "run_command:depcruise",
    });

    expect(classifyToolCall("run_command", { CommandLine: "pnpm typecheck && pnpm knip" })).toEqual(
      {
        type: "guardrail",
        observationName: "run_command:guardrail-checks",
      },
    );

    // Evaluator wins over guardrail in pure verification chains
    expect(
      classifyToolCall("run_command", { CommandLine: "pnpm typecheck && pnpm test:unit" }),
    ).toEqual({
      type: "evaluator",
      observationName: "run_command:test:unit",
    });

    // Any mutating or unknown command in a chain forces the entire command to remain tool
    // while keeping a low-cardinality command label for UI visibility
    expect(
      classifyToolCall("run_command", { CommandLine: "pnpm lint:fix && pnpm test:unit" }),
    ).toEqual({
      type: "tool",
      observationName: "run_command:lint:fix+test:unit",
    });

    expect(
      classifyToolCall("run_command", { CommandLine: "rg -n Chart src && pnpm typecheck" }),
    ).toEqual({
      type: "tool",
      observationName: "run_command:rg+typecheck",
    });

    expect(classifyToolCall("run_command", { CommandLine: "eslint --fix src/index.ts" })).toEqual({
      type: "tool",
      observationName: "run_command:eslint",
    });

    expect(classifyToolCall("run_command", { CommandLine: "git status" })).toEqual({
      type: "tool",
      observationName: "run_command:git:status",
    });

    expect(classifyToolCall("run_command", {})).toEqual({
      type: "tool",
      observationName: "run_command",
    });
  });

  it("classifies MCP tool calls and SYSTEM_MESSAGE event names with low cardinality", () => {
    expect(
      classifyToolCall("call_mcp_tool", {
        ServerName: "langfuse-docs",
        ToolName: "searchLangfuseDocs",
      }),
    ).toEqual({
      type: "retriever",
      observationName: "mcp:langfuse-docs:searchLangfuseDocs",
    });

    expect(
      classifyToolCall("call_mcp_tool", {
        ServerName: "langfuse-docs",
        ToolName: "submitFeedback",
      }),
    ).toEqual({
      type: "tool",
      observationName: "mcp:langfuse-docs:submitFeedback",
    });

    expect(classifySystemMessageName("[BROWSER_HOST_FACTS] foo")).toBe("system:browser-facts");
    expect(classifySystemMessageName("[Subagent] finished")).toBe("system:subagent");
    expect(classifySystemMessageName("[Message] hi")).toBe("system:message");
    expect(classifySystemMessageName("[Notice] ok")).toBe("system:notice");
    expect(classifySystemMessageName("[Timer] fired")).toBe("system:timer");
    expect(classifySystemMessageName("Arbitrary system payload")).toBe("system:event");
  });
});

describe("USER_SETTINGS_CHANGE parsing and model tracking", () => {
  it("normalizes display model names and parses Antigravity settings changes", () => {
    expect(normalizeModelIdentifier("Gemini 3.8 Flash (Low)")).toBe("gemini-3.8-flash-low");
    expect(normalizeModelIdentifier("Gemini 3.8 Flash (High)")).toBe("gemini-3.8-flash-high");
    expect(normalizeModelIdentifier("Gemini 4 Hydrogen (High)")).toBe("gemini-4-hydrogen-high");
    expect(normalizeModelIdentifier("Gemini 4 Argon")).toBe("gemini-4-argon");
    expect(normalizeModelIdentifier("None")).toBeUndefined();

    const parsed: ParsedSettingsChange[] = parseUserSettingsChanges(
      [
        "The user changed setting `Model Selection` from Gemini 3.8 Flash (Low) to Gemini 3.8 Flash (High). No need to comment on this change if the user doesn't ask about it.",
        "The user changed setting `Terminal Policy` from Auto to Always Ask.",
      ].join("\n"),
    );

    expect(parsed).toEqual([
      {
        setting: "Model Selection",
        from: "Gemini 3.8 Flash (Low)",
        to: "Gemini 3.8 Flash (High)",
        raw: "The user changed setting `Model Selection` from Gemini 3.8 Flash (Low) to Gemini 3.8 Flash (High).",
        normalizedModel: "gemini-3.8-flash-high",
      },
      {
        setting: "Terminal Policy",
        from: "Auto",
        to: "Always Ask",
        raw: "The user changed setting `Terminal Policy` from Auto to Always Ask.",
      },
    ]);
  });

  it("preserves model switches across duplicate step_index USER_INPUT retries, emits settings:model-change events, and updates subsequent turns", () => {
    const transcript = [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-15T14:54:09Z",
        content: [
          "<USER_REQUEST>",
          "hello",
          "</USER_REQUEST>",
          "<USER_SETTINGS_CHANGE>",
          "The user changed setting `Model Selection` from None to Gemini 3.8 Flash (Low). No need to comment on this change if the user doesn't ask about it.",
          "</USER_SETTINGS_CHANGE>",
        ].join("\n"),
      }),
      JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-15T14:54:10Z",
        input_tokens: 100,
        output_tokens: 20,
        content: "Hi.",
      }),
      JSON.stringify({
        step_index: 12,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-15T14:56:08Z",
        content: [
          "<USER_REQUEST>",
          "git status",
          "</USER_REQUEST>",
          "<ADDITIONAL_METADATA>",
          "Time: 18:56:08",
          "</ADDITIONAL_METADATA>",
          "<USER_SETTINGS_CHANGE>",
          "The user changed setting `Model Selection` from Gemini 3.8 Flash (Low) to Gemini 3.8 Flash (High). No need to comment on this change if the user doesn't ask about it.",
          "</USER_SETTINGS_CHANGE>",
        ].join("\n"),
      }),
      JSON.stringify({
        step_index: 12,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-15T14:56:25Z",
        content: [
          "<USER_REQUEST>",
          "git status",
          "</USER_REQUEST>",
          "<ADDITIONAL_METADATA>",
          "Time: 18:56:25",
          "</ADDITIONAL_METADATA>",
        ].join("\n"),
      }),
      JSON.stringify({
        step_index: 13,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-15T14:56:25Z",
        input_tokens: 200,
        output_tokens: 30,
        content: "Clean.",
      }),
      JSON.stringify({
        step_index: 18,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-15T15:13:06Z",
        content: "<USER_REQUEST>\n1\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 19,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-15T15:13:06Z",
        input_tokens: 300,
        output_tokens: 40,
        content: "Clarify.",
      }),
    ].join("\n");

    const turns = parseTranscriptTurns(transcript, {
      conversationId: "conv-model-switch",
      modelName: "gemini-3.8-flash-low",
    });

    expect(turns).toHaveLength(4);

    const turn1 = turns[0]!;
    const turn2 = turns[1]!;
    const turn3 = turns[2]!;
    const turn4 = turns[3]!;

    expect(turn1.metadata.model).toBe("gemini-3.8-flash-low");

    expect(turn1.children.map((c) => `${c.type}:${c.name}`)).toEqual([
      "event:settings:model-change",
      "generation:llm-generation",
    ]);

    expect(turn2.turnIndex).toBe(2);
    expect(turn2.startStepIndex).toBe(12);
    expect(turn2.endStepIndex).toBe(12);
    expect(turn2.startTime.toISOString()).toBe("2026-11-15T14:56:08.000Z");
    expect(turn2.input).toBe("git status");
    expect(turn2.output).toBe("");
    expect(turn2.level).toBe("WARNING");
    expect(turn2.statusMessage).toBe("Interrupted before model generation");
    expect(turn2.metadata.model).toBe("gemini-3.8-flash-high");
    expect(turn2.metadata.interrupted).toBe(true);
    expect(turn2.metadata.userSettingsChange).toContain("Gemini 3.8 Flash (High)");

    expect(turn2.metadata.observationCounts).toEqual({
      generation: 0,
      agent: 0,
      retriever: 0,
      evaluator: 0,
      guardrail: 0,
      tool: 0,
      event: 1,
    });

    expect(turn2.children.map((c) => `${c.type}:${c.name}`)).toEqual([
      "event:settings:model-change",
    ]);

    const modelEvent = turn2.children[0]!;

    expect(modelEvent.type).toBe("event");

    if (modelEvent.type === "event") {
      expect(modelEvent.startTime.toISOString()).toBe("2026-11-15T14:56:08.000Z");

      expect(modelEvent.input).toEqual({
        setting: "Model Selection",
        from: "Gemini 3.8 Flash (Low)",
        to: "Gemini 3.8 Flash (High)",
        model: "gemini-3.8-flash-high",
      });
    }

    expect(turn3.turnIndex).toBe(3);
    expect(turn3.startStepIndex).toBe(12);
    expect(turn3.endStepIndex).toBe(13);
    expect(turn3.startTime.toISOString()).toBe("2026-11-15T14:56:25.000Z");
    expect(turn3.metadata.model).toBe("gemini-3.8-flash-high");
    expect(turn3.children.map((c) => `${c.type}:${c.name}`)).toEqual(["generation:llm-generation"]);

    const turn3Gen = turn3.children[0]!;

    expect(turn3Gen.type).toBe("generation");

    if (turn3Gen.type === "generation") {
      expect(turn3Gen.model).toBe("gemini-3.8-flash-high");

      expect(turn3Gen.input).toEqual([
        { role: "user", content: "hello" },
        { role: "assistant", content: "Hi." },
        { role: "user", content: "git status" },
      ]);
    }

    expect(turn4.turnIndex).toBe(4);
    expect(turn4.metadata.model).toBe("gemini-3.8-flash-high");
    expect(turn4.children.map((c) => `${c.type}:${c.name}`)).toEqual(["generation:llm-generation"]);

    const turn4Gen = turn4.children[0]!;

    if (turn4Gen.type === "generation") {
      expect(turn4Gen.model).toBe("gemini-3.8-flash-high");
    }

    // Incremental export after step 17 with a stale hook modelName still resolves the switched model
    const incremental = parseTranscriptTurns(transcript, {
      conversationId: "conv-model-switch",
      modelName: "gemini-3.8-flash-low",
      afterStepIndex: 17,
    });

    expect(incremental).toHaveLength(1);
    expect(incremental[0]!.turnIndex).toBe(4);
    expect(incremental[0]!.metadata.model).toBe("gemini-3.8-flash-high");

    const incGen = incremental[0]!.children[0]!;

    if (incGen.type === "generation") {
      expect(incGen.model).toBe("gemini-3.8-flash-high");
    }
  });

  it("traces interrupted queued prompts faithfully while keeping subsequent generation history and monotonic lineIndex", () => {
    const transcript = [
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
      JSON.stringify({
        step_index: 23,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-15T16:23:00Z",
        content: [
          "<USER_REQUEST>",
          "s",
          "</USER_REQUEST>",
          "<USER_SETTINGS_CHANGE>",
          "The user changed setting `Model Selection` from Gemini 3.8 Flash (High) to Gemini 3.8 Flash (Low).",
          "</USER_SETTINGS_CHANGE>",
        ].join("\n"),
      }),
      JSON.stringify({
        step_index: 24,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-15T16:23:00Z",
        input_tokens: 150,
        output_tokens: 25,
        content: "Online.",
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
        content: "Observed random messages.",
      }),
    ].join("\n");

    const turns = parseTranscriptTurns(transcript, {
      conversationId: "conv-queued",
      modelName: "gemini-3.8-flash-high",
    });

    expect(turns).toHaveLength(4);

    const interruptedTurn = turns[1]!;

    expect(interruptedTurn.turnIndex).toBe(2);
    expect(interruptedTurn.startStepIndex).toBe(22);
    expect(interruptedTurn.endStepIndex).toBe(22);
    expect(interruptedTurn.endLineIndex).toBe(2);
    expect(interruptedTurn.input).toBe("ds");
    expect(interruptedTurn.output).toBe("");
    expect(interruptedTurn.level).toBe("WARNING");
    expect(interruptedTurn.statusMessage).toBe("Interrupted before model generation");
    expect(interruptedTurn.metadata.interrupted).toBe(true);
    expect(interruptedTurn.metadata.generationCount).toBe(0);

    const nextTurn = turns[2]!;

    expect(nextTurn.turnIndex).toBe(3);
    expect(nextTurn.startStepIndex).toBe(23);
    expect(nextTurn.endStepIndex).toBe(24);
    expect(nextTurn.endLineIndex).toBe(4);
    expect(nextTurn.input).toBe("s");
    expect(nextTurn.output).toBe("Online.");
    expect(nextTurn.metadata.model).toBe("gemini-3.8-flash-low");

    const gen = nextTurn.children.find((c) => c.type === "generation");

    expect(gen?.type).toBe("generation");

    if (gen?.type === "generation") {
      expect(gen.input).toEqual([
        { role: "user", content: "sdds" },
        { role: "assistant", content: "Looks like a typo." },
        { role: "user", content: "ds" },
        { role: "user", content: "s" },
      ]);
    }

    const reusedStepTurn = turns[3]!;

    expect(reusedStepTurn.turnIndex).toBe(4);
    expect(reusedStepTurn.endStepIndex).toBe(24);
    expect(reusedStepTurn.endLineIndex).toBe(6);

    const incrementalByLine = parseTranscriptTurns(transcript, {
      conversationId: "conv-queued",
      modelName: "gemini-3.8-flash-high",
      afterLineIndex: nextTurn.endLineIndex,
    });

    expect(incrementalByLine).toHaveLength(1);
    expect(incrementalByLine[0]!.turnIndex).toBe(4);
    expect(incrementalByLine[0]!.output).toBe("Observed random messages.");
  });

  it("propagates ERROR and WARNING trace levels from failed or interrupted executions", () => {
    const transcript = [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-15T17:00:00Z",
        content: "<USER_REQUEST>\nRun tool\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-15T17:00:01Z",
        tool_calls: [{ name: "run_command", args: { CommandLine: "pnpm check:fast" } }],
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-15T17:00:02Z",
        content: "ok",
      }),
      JSON.stringify({
        step_index: 3,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-15T17:01:00Z",
        content: "<USER_REQUEST>\nFail generation\n</USER_REQUEST>",
      }),
      JSON.stringify({
        step_index: 4,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "ERROR",
        error: "Rate limit exceeded",
        created_at: "2026-11-15T17:01:01Z",
      }),
    ].join("\n");

    const turns = parseTranscriptTurns(transcript, {
      conversationId: "conv-levels",
      modelName: "gemini-3.8-flash-high",
    });

    expect(turns).toHaveLength(2);
    expect(turns[0]!.level).toBe("WARNING");
    expect(turns[0]!.metadata.interrupted).toBe(true);
    expect(turns[1]!.level).toBe("ERROR");
    expect(turns[1]!.statusMessage).toBe("Rate limit exceeded");
  });
});

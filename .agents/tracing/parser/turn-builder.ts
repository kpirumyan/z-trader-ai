import { parseJsonlSteps } from "./jsonl-reader.ts";
import {
  deriveSubagentObservationName,
  extractSubagentConversationId,
} from "./subagent-resolver.ts";
import { collectTagsFromValue } from "./tagger.ts";
import { extractGenericTimingAndBody, parseIsoTimestamp } from "./timing-extractor.ts";
import { deserializeToolArgs } from "./tool-deserializer.ts";

import type {
  AssistantToolCallOutput,
  ChatMessage,
  ExtractedUserRequest,
  ParsedAgentObservation,
  ParsedChildObservation,
  ParsedGenerationObservation,
  ParsedToolObservation,
  ParsedTurnTrace,
  ParseTranscriptOptions,
  RawTranscriptStep,
  TokenUsageSummary,
} from "../types.ts";

export function extractUserRequest(rawContent: string): ExtractedUserRequest {
  const userRequestMatch = rawContent.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  const metadataMatch = rawContent.match(
    /<ADDITIONAL_METADATA>\s*([\s\S]*?)\s*<\/ADDITIONAL_METADATA>/,
  );
  const settingsMatch = rawContent.match(
    /<USER_SETTINGS_CHANGE>\s*([\s\S]*?)\s*<\/USER_SETTINGS_CHANGE>/,
  );

  const prompt = userRequestMatch ? userRequestMatch[1]!.trim() : rawContent.trim();
  const result: ExtractedUserRequest = { prompt };

  if (metadataMatch && metadataMatch[1]?.trim()) {
    result.additionalMetadata = metadataMatch[1].trim();
  }

  if (settingsMatch && settingsMatch[1]?.trim()) {
    result.userSettingsChange = settingsMatch[1].trim();
  }

  return result;
}

const SYSTEM_MESSAGE_TAG_REGEX = /(?:^|\n)\s*<SYSTEM_MESSAGE>\s*([\s\S]*?)\s*<\/SYSTEM_MESSAGE>/;

export function extractSystemMessageContent(rawContent: string): string {
  const match = rawContent.match(SYSTEM_MESSAGE_TAG_REGEX);

  return match ? match[1]!.trim() : rawContent.trim();
}

export function buildSyntheticToolCallId(
  conversationId: string,
  stepIndex: number,
  toolIndex: number,
): string {
  const sanitized = conversationId.trim();
  const uuidPrefixMatch = sanitized.match(/^[0-9a-fA-F]{8}(?=-)/);
  const cleanConv = uuidPrefixMatch
    ? uuidPrefixMatch[0].toLowerCase()
    : sanitized.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "agent";

  return `call_${cleanConv}_s${stepIndex}_${toolIndex}`;
}

interface ParsedStepSequenceResult {
  children: ParsedChildObservation[];
  usageSummary: TokenUsageSummary;
  tags: Set<string>;
  lastAssistantContent: string;
  generationCount: number;
  toolCount: number;
  errorCount: number;
  systemMessageCount: number;
  history: ChatMessage[];
}

function parseStepSequence(
  steps: RawTranscriptStep[],
  promptText: string,
  options: ParseTranscriptOptions,
  visited: Set<string>,
  initialHistory: ChatMessage[] = [],
): ParsedStepSequenceResult {
  const children: ParsedChildObservation[] = [];
  const usageSummary: TokenUsageSummary = {
    input: 0,
    output: 0,
    cacheReadInputTokens: 0,
    total: 0,
  };
  const tags = new Set<string>();
  const modelName = options.modelName?.trim() || "antigravity-model";

  let lastAssistantContent = "";
  let generationCount = 0;
  let toolCount = 0;
  let errorCount = 0;
  let systemMessageCount = 0;

  const history: ChatMessage[] = [...initialHistory];

  if (promptText) {
    history.push({ role: "user", content: promptText });
  }

  let i = 0;
  let lastStartMs = -1;
  let lastEndMs = 0;

  while (i < steps.length) {
    const step = steps[i]!;

    if (step.type === "SYSTEM_MESSAGE") {
      systemMessageCount++;

      const systemContent = extractSystemMessageContent(step.content ?? "");

      if (systemContent) {
        const safeSystemOutput =
          systemContent.length > 30_000
            ? `${systemContent.slice(0, 30_000)}\n... [truncated for observation history]`
            : systemContent;

        history.push({
          role: "system",
          content: safeSystemOutput,
        });
      }

      i++;
      continue;
    }

    if (step.type !== "PLANNER_RESPONSE") {
      i++;
      continue;
    }

    generationCount++;

    const rawGenStartTime = parseIsoTimestamp(step.created_at, new Date(0));
    let genStartMs = rawGenStartTime.getTime();

    if (lastEndMs > 0 && genStartMs < lastEndMs) {
      genStartMs = lastEndMs;
    }

    if (genStartMs <= lastStartMs) {
      genStartMs = lastStartMs + 1;
    }

    const genStartTime = new Date(genStartMs);
    const inputTokens = step.input_tokens ?? 0;
    const outputTokens = step.output_tokens ?? 0;
    const cacheReadTokens = step.cache_read_tokens ?? 0;
    const stepTotalTokens = inputTokens + outputTokens + cacheReadTokens;

    usageSummary.input += inputTokens;
    usageSummary.output += outputTokens;
    usageSummary.cacheReadInputTokens += cacheReadTokens;
    usageSummary.total += stepTotalTokens;

    const rawToolCalls = step.tool_calls ?? [];
    const matchingGenerics: RawTranscriptStep[] = [];

    let lookahead = i + 1;

    while (
      lookahead < steps.length &&
      matchingGenerics.length < rawToolCalls.length &&
      steps[lookahead]!.type === "GENERIC"
    ) {
      matchingGenerics.push(steps[lookahead]!);
      lookahead++;
    }

    let rawGenEndTime = genStartTime;

    if (matchingGenerics.length > 0) {
      const firstTiming = extractGenericTimingAndBody(
        matchingGenerics[0]!.content,
        parseIsoTimestamp(matchingGenerics[0]!.created_at, genStartTime),
      );

      if (firstTiming.startTime.getTime() >= genStartTime.getTime()) {
        rawGenEndTime = firstTiming.startTime;
      }
    } else if (i + 1 < steps.length) {
      const nextTime = parseIsoTimestamp(steps[i + 1]!.created_at, genStartTime);

      if (nextTime.getTime() >= genStartTime.getTime()) {
        rawGenEndTime = nextTime;
      }
    }

    const genEndMs = Math.max(rawGenEndTime.getTime(), genStartMs);
    const genEndTime = new Date(genEndMs);

    lastStartMs = genStartMs;
    lastEndMs = genEndMs;

    const assistantToolCalls: AssistantToolCallOutput[] = rawToolCalls.map((tc, idx) => {
      const deserialized = deserializeToolArgs(tc.args);
      const rawId = tc.id?.trim();
      const toolCallId =
        rawId || buildSyntheticToolCallId(options.conversationId, step.step_index, idx);

      return {
        id: toolCallId,
        type: "function",
        function: {
          name: tc.name,
          arguments: JSON.stringify(deserialized),
        },
      };
    });

    const contentText = step.content?.trim() ? step.content.trim() : null;

    if (contentText) {
      lastAssistantContent = contentText;
    }

    const genMetadata: Record<string, unknown> = {
      stepIndex: step.step_index,
    };

    if (step.thinking?.trim()) {
      genMetadata.thinking = step.thinking.trim();
    }

    const genObservation: ParsedGenerationObservation = {
      type: "generation",
      name: "llm-generation",
      stepIndex: step.step_index,
      model: modelName,
      startTime: genStartTime,
      endTime: genEndTime,
      input: [...history],
      output: {
        role: "assistant",
        content: contentText,
        ...(step.thinking?.trim() ? { thinking: step.thinking.trim() } : {}),
        ...(assistantToolCalls.length > 0 ? { tool_calls: assistantToolCalls } : {}),
      },
      usageDetails: {
        input: inputTokens,
        output: outputTokens,
        ...(cacheReadTokens > 0 ? { cache_read_input_tokens: cacheReadTokens } : {}),
        total: stepTotalTokens,
      },
      metadata: genMetadata,
      ...(step.status === "ERROR"
        ? { level: "ERROR", statusMessage: step.error ?? "Generation failed" }
        : {}),
    };

    children.push(genObservation);

    const assistantHistoryMsg: ChatMessage = {
      role: "assistant",
      content: contentText ?? (assistantToolCalls.length > 0 ? null : ""),
      ...(assistantToolCalls.length > 0 ? { tool_calls: assistantToolCalls } : {}),
    };

    history.push(assistantHistoryMsg);

    for (let tcIdx = 0; tcIdx < rawToolCalls.length; tcIdx++) {
      const tc = rawToolCalls[tcIdx]!;
      const genericResult = matchingGenerics[tcIdx];
      const deserializedArgs = deserializeToolArgs(tc.args);

      collectTagsFromValue(deserializedArgs, tags);

      const fallbackStepTime = parseIsoTimestamp(genericResult?.created_at, genEndTime);
      const {
        startTime: rawToolStart,
        endTime: rawToolEnd,
        cleanBody,
      } = extractGenericTimingAndBody(genericResult?.content, fallbackStepTime);

      const duration = Math.max(0, rawToolEnd.getTime() - rawToolStart.getTime());
      let toolStartMs = Math.max(rawToolStart.getTime(), genEndMs);

      if (toolStartMs <= lastStartMs) {
        toolStartMs = lastStartMs + 1;
      }

      const toolEndMs = Math.max(toolStartMs + duration, toolStartMs);
      const startTime = new Date(toolStartMs);
      const endTime = new Date(toolEndMs);

      lastStartMs = toolStartMs;
      lastEndMs = Math.max(lastEndMs, toolEndMs);

      const isError = genericResult?.status === "ERROR" || Boolean(genericResult?.error);
      const statusMessage = genericResult?.error ?? (isError ? cleanBody.slice(0, 200) : undefined);

      if (isError) {
        errorCount++;
      }

      const resultStepIndex = genericResult?.step_index ?? step.step_index;

      if (genericResult) {
        const rawToolOutput = isError ? (statusMessage ?? cleanBody) : cleanBody;
        const safeToolOutput =
          rawToolOutput.length > 30_000
            ? `${rawToolOutput.slice(0, 30_000)}\n... [truncated for observation history]`
            : rawToolOutput;

        const toolCallId =
          assistantToolCalls[tcIdx]?.id ??
          (tc.id?.trim() ||
            buildSyntheticToolCallId(options.conversationId, step.step_index, tcIdx));

        history.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: safeToolOutput,
        });
      }

      if (tc.name === "invoke_subagent") {
        const subagentName = deriveSubagentObservationName(deserializedArgs);
        const subagentId = extractSubagentConversationId(deserializedArgs, cleanBody);
        let subagentChildren: ParsedChildObservation[] = [];
        let subagentUsage: TokenUsageSummary = {
          input: 0,
          output: 0,
          cacheReadInputTokens: 0,
          total: 0,
        };

        if (
          subagentId &&
          !visited.has(subagentId) &&
          typeof options.resolveSubagentTranscript === "function"
        ) {
          const childTranscriptRaw = options.resolveSubagentTranscript(subagentId);

          if (childTranscriptRaw) {
            const nextVisited = new Set(visited);

            nextVisited.add(subagentId);

            const subTurns = parseTranscriptTurns(childTranscriptRaw, {
              ...options,
              conversationId: subagentId,
              afterStepIndex: undefined,
              visitedConversationIds: nextVisited,
            });

            subagentChildren = subTurns.flatMap((t) => t.children);

            for (const st of subTurns) {
              subagentUsage = {
                input: subagentUsage.input + st.usageSummary.input,
                output: subagentUsage.output + st.usageSummary.output,
                cacheReadInputTokens:
                  subagentUsage.cacheReadInputTokens + st.usageSummary.cacheReadInputTokens,
                total: subagentUsage.total + st.usageSummary.total,
              };

              for (const tag of st.tags) {
                tags.add(tag);
              }
            }

            usageSummary.input += subagentUsage.input;
            usageSummary.output += subagentUsage.output;
            usageSummary.cacheReadInputTokens += subagentUsage.cacheReadInputTokens;
            usageSummary.total += subagentUsage.total;
          }
        }

        const toolCallId =
          assistantToolCalls[tcIdx]?.id ??
          (tc.id?.trim() ||
            buildSyntheticToolCallId(options.conversationId, step.step_index, tcIdx));

        const agentObs: ParsedAgentObservation = {
          type: "agent",
          name: subagentName,
          stepIndex: resultStepIndex,
          toolCallId,
          ...(subagentId ? { subagentConversationId: subagentId } : {}),
          ...(typeof deserializedArgs.Role === "string" ? { role: deserializedArgs.Role } : {}),
          ...(typeof deserializedArgs.TypeName === "string"
            ? { subagentType: deserializedArgs.TypeName }
            : {}),
          startTime,
          endTime,
          input: deserializedArgs,
          output: cleanBody,
          level: isError ? "ERROR" : "DEFAULT",
          ...(statusMessage ? { statusMessage } : {}),
          children: subagentChildren,
          usageSummary: subagentUsage,
          metadata: {
            stepIndex: resultStepIndex,
            toolCallIndex: tcIdx,
            toolCallId,
            ...(subagentId ? { subagentConversationId: subagentId } : {}),
          },
        };

        children.push(agentObs);
      } else {
        toolCount++;

        const toolCallId =
          assistantToolCalls[tcIdx]?.id ??
          (tc.id?.trim() ||
            buildSyntheticToolCallId(options.conversationId, step.step_index, tcIdx));

        const toolObs: ParsedToolObservation = {
          type: "tool",
          name: tc.name,
          stepIndex: resultStepIndex,
          toolCallId,
          startTime,
          endTime,
          input: deserializedArgs,
          output: cleanBody,
          level: isError ? "ERROR" : "DEFAULT",
          ...(statusMessage ? { statusMessage } : {}),
          metadata: {
            stepIndex: resultStepIndex,
            toolCallIndex: tcIdx,
            toolCallId,
          },
        };

        children.push(toolObs);
      }
    }

    i = lookahead;
  }

  return {
    children,
    usageSummary,
    tags,
    lastAssistantContent,
    generationCount,
    toolCount,
    errorCount,
    systemMessageCount,
    history,
  };
}

export function parseTranscriptTurns(
  jsonlContent: string,
  options: ParseTranscriptOptions,
): ParsedTurnTrace[] {
  const steps = parseJsonlSteps(jsonlContent);

  if (steps.length === 0) {
    return [];
  }

  const visited = new Set(options.visitedConversationIds ?? []);

  visited.add(options.conversationId.toLowerCase());

  const turnSlices: RawTranscriptStep[][] = [];
  let currentSlice: RawTranscriptStep[] = [];

  for (const step of steps) {
    if (step.type === "USER_INPUT" && currentSlice.length > 0) {
      turnSlices.push(currentSlice);
      currentSlice = [step];
    } else {
      currentSlice.push(step);
    }
  }

  if (currentSlice.length > 0) {
    turnSlices.push(currentSlice);
  }

  const parsedTurns: ParsedTurnTrace[] = [];
  let cumulativeSessionHistory: ChatMessage[] = [];

  for (let idx = 0; idx < turnSlices.length; idx++) {
    const slice = turnSlices[idx]!;
    const turnIndex = idx + 1;
    const firstStep = slice[0]!;
    const lastStep = slice[slice.length - 1]!;
    const startStepIndex = firstStep.step_index;
    const endStepIndex = lastStep.step_index;

    const userInputStep = slice.find((s) => s.type === "USER_INPUT");
    const extractedInput = extractUserRequest(userInputStep?.content ?? "");
    const startTime = parseIsoTimestamp(firstStep.created_at, new Date(0));

    const sequence = parseStepSequence(
      slice,
      extractedInput.prompt,
      options,
      visited,
      cumulativeSessionHistory,
    );

    cumulativeSessionHistory = sequence.history;

    if (options.afterStepIndex !== undefined && endStepIndex <= options.afterStepIndex) {
      continue;
    }

    let endTime = parseIsoTimestamp(lastStep.created_at, startTime);

    for (const child of sequence.children) {
      if (child.endTime.getTime() > endTime.getTime()) {
        endTime = child.endTime;
      }
    }

    const output =
      sequence.lastAssistantContent ||
      (sequence.children.length > 0
        ? `Completed ${sequence.generationCount} generation(s) and ${sequence.toolCount} tool call(s).`
        : "");

    const metadata: Record<string, unknown> = {
      turnIndex,
      startStepIndex,
      endStepIndex,
      generationCount: sequence.generationCount,
      toolCount: sequence.toolCount,
      errorCount: sequence.errorCount,
      systemMessageCount: sequence.systemMessageCount,
    };

    if (extractedInput.additionalMetadata) {
      metadata.additionalMetadata = extractedInput.additionalMetadata;
    }

    if (extractedInput.userSettingsChange) {
      metadata.userSettingsChange = extractedInput.userSettingsChange;
    }

    parsedTurns.push({
      turnIndex,
      traceSeed: `${options.conversationId}-turn-${turnIndex}`,
      traceName: "agent-turn",
      sessionId: options.conversationId,
      startStepIndex,
      endStepIndex,
      startTime,
      endTime,
      input: extractedInput.prompt,
      output,
      children: sequence.children,
      usageSummary: sequence.usageSummary,
      tags: [...sequence.tags].sort(),
      metadata,
    });
  }

  return parsedTurns;
}

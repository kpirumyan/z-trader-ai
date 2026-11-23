import { classifySystemMessageName, classifyToolCall } from "./classifier.ts";
import { parseJsonlSteps } from "./jsonl-reader.ts";
import { parseUserSettingsChanges } from "./settings-parser.ts";
import {
  deriveSubagentObservationName,
  extractSubagentConversationIds,
  isSubagentToolCall,
} from "./subagent-resolver.ts";
import { collectModuleTagsFromToolArgs } from "./tagger.ts";
import { extractGenericTimingAndBody, parseIsoTimestamp } from "./timing-extractor.ts";
import { deserializeToolArgs } from "./tool-deserializer.ts";

import type {
  AssistantToolCallOutput,
  ChatMessage,
  ExtractedUserRequest,
  ObservationCounts,
  ParsedAgentObservation,
  ParsedChildObservation,
  ParsedEventObservation,
  ParsedGenerationObservation,
  ParsedSettingsChange,
  ParsedToolObservation,
  ParsedTurnTrace,
  ParseTranscriptOptions,
  RawTranscriptStep,
  TokenUsageSummary,
  TurnGateSummary,
} from "../types.ts";

const MAX_PREVIOUS_TURN_TEXT_LENGTH = 4000;
const PREVIOUS_TURN_TRUNCATION_SUFFIX = "\n... [truncated]";

function truncatePreviousTurnText(value: string): string {
  if (value.length <= MAX_PREVIOUS_TURN_TEXT_LENGTH) {
    return value;
  }

  const headLength = Math.max(
    0,
    MAX_PREVIOUS_TURN_TEXT_LENGTH - PREVIOUS_TURN_TRUNCATION_SUFFIX.length,
  );

  return `${value.slice(0, headLength)}${PREVIOUS_TURN_TRUNCATION_SUFFIX}`;
}

function collectGateObservations(children: ParsedChildObservation[]): ParsedToolObservation[] {
  const gates: ParsedToolObservation[] = [];

  for (const child of children) {
    if (child.type === "evaluator" || child.type === "guardrail") {
      gates.push(child);
    } else if (child.type === "agent") {
      gates.push(...collectGateObservations(child.children));
    }
  }

  return gates;
}

function buildTurnGateSummary(children: ParsedChildObservation[]): TurnGateSummary {
  const gates = collectGateObservations(children);
  const totalRuns = gates.length;

  if (totalRuns === 0) {
    return {
      totalRuns: 0,
      firstTryPassed: null,
      finalPassed: null,
      retryCount: 0,
      failedGates: [],
    };
  }

  const firstFailureIndex = gates.findIndex((gate) => gate.level === "ERROR");
  const firstTryPassed = firstFailureIndex === -1;
  const finalPassed = gates[totalRuns - 1]!.level !== "ERROR";
  const retryCount = firstFailureIndex === -1 ? 0 : totalRuns - 1 - firstFailureIndex;
  const failedGates = Array.from(
    new Set(gates.filter((gate) => gate.level === "ERROR").map((gate) => gate.name)),
  );

  return {
    totalRuns,
    firstTryPassed,
    finalPassed,
    retryCount,
    failedGates,
  };
}

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

const CLIENT_META_COMMAND_REGEX = /^\/(compact|clear|help|exit|quit)(?:\s+[\s\S]*)?$/i;

export function isClientMetaCommand(prompt: string): boolean {
  return CLIENT_META_COMMAND_REGEX.test(prompt.trim());
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
  lastGenerationLevel?: "DEFAULT" | "WARNING" | "ERROR";
  lastGenerationStatusMessage?: string;
  generationCount: number;
  toolCount: number;
  errorCount: number;
  failedTools: string[];
  systemMessageCount: number;
  observationCounts: ObservationCounts;
  history: ChatMessage[];
}

function buildSettingsEvents(
  settingsChanges: ParsedSettingsChange[],
  stepIndex: number,
  turnStartTime: Date,
): ParsedEventObservation[] {
  return settingsChanges.map((change, idx) => {
    const eventTime = new Date(turnStartTime.getTime() + idx);
    const isModelChange =
      Boolean(change.normalizedModel) || /^model(?:\s*selection)?$/i.test(change.setting);
    const payload: Record<string, unknown> = {
      setting: change.setting,
      ...(change.from ? { from: change.from } : {}),
      to: change.to,
      ...(change.normalizedModel ? { model: change.normalizedModel } : {}),
    };

    return {
      type: "event",
      name: isModelChange ? "settings:model-change" : "settings:change",
      stepIndex,
      startTime: eventTime,
      endTime: eventTime,
      input: payload,
      level: "DEFAULT",
      metadata: {
        stepIndex,
        ...payload,
        raw: change.raw,
      },
    };
  });
}

function parseStepSequence(
  steps: RawTranscriptStep[],
  promptText: string,
  options: ParseTranscriptOptions,
  visited: Set<string>,
  initialHistory: ChatMessage[] = [],
  effectiveModelName = options.modelName?.trim() || "antigravity-model",
  initialEvents: ParsedEventObservation[] = [],
): ParsedStepSequenceResult {
  const children: ParsedChildObservation[] = [];
  const usageSummary: TokenUsageSummary = {
    input: 0,
    output: 0,
    cacheReadInputTokens: 0,
    total: 0,
  };
  const observationCounts: ObservationCounts = {
    generation: 0,
    agent: 0,
    retriever: 0,
    evaluator: 0,
    guardrail: 0,
    tool: 0,
    event: 0,
  };
  const tags = new Set<string>();
  const modelName = effectiveModelName;

  let lastAssistantContent = "";
  let lastGenerationLevel: "DEFAULT" | "WARNING" | "ERROR" | undefined;
  let lastGenerationStatusMessage: string | undefined;
  let generationCount = 0;
  let toolCount = 0;
  let errorCount = 0;
  const failedTools: string[] = [];
  let systemMessageCount = 0;

  const history: ChatMessage[] = [...initialHistory];

  if (promptText) {
    history.push({ role: "user", content: promptText });
  }

  let i = 0;
  let lastStartMs = -1;
  let lastEndMs = 0;

  for (const initialEvent of initialEvents) {
    children.push(initialEvent);
    observationCounts.event++;

    const evtMs = initialEvent.startTime.getTime();

    lastStartMs = Math.max(lastStartMs, evtMs);
    lastEndMs = Math.max(lastEndMs, evtMs);
  }

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

        const rawEventTime = parseIsoTimestamp(step.created_at, new Date(lastEndMs || 0));
        let eventStartMs = rawEventTime.getTime();

        if (lastEndMs > 0 && eventStartMs < lastEndMs) {
          eventStartMs = lastEndMs;
        }

        if (eventStartMs <= lastStartMs) {
          eventStartMs = lastStartMs + 1;
        }

        lastStartMs = eventStartMs;
        lastEndMs = Math.max(lastEndMs, eventStartMs);

        const eventTime = new Date(eventStartMs);
        const source = step.source ?? "SYSTEM";
        const eventObs: ParsedEventObservation = {
          type: "event",
          name: classifySystemMessageName(systemContent),
          stepIndex: step.step_index,
          startTime: eventTime,
          endTime: eventTime,
          input: {
            source,
            message: safeSystemOutput,
          },
          level: "DEFAULT",
          metadata: {
            stepIndex: step.step_index,
            source,
          },
        };

        children.push(eventObs);
        observationCounts.event++;
      }

      i++;
      continue;
    }

    if (step.type !== "PLANNER_RESPONSE") {
      i++;
      continue;
    }

    generationCount++;
    observationCounts.generation++;

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

    const preparedToolCalls = rawToolCalls.map((tc, idx) => {
      const deserializedArgs = deserializeToolArgs(tc.args);
      const rawId = tc.id?.trim();
      const toolCallId =
        rawId || buildSyntheticToolCallId(options.conversationId, step.step_index, idx);
      const isSubagent = isSubagentToolCall(tc.name, deserializedArgs);
      const classification = isSubagent ? null : classifyToolCall(tc.name, deserializedArgs);
      const resolvedName = isSubagent
        ? deriveSubagentObservationName(deserializedArgs)
        : classification!.observationName;

      return {
        tc,
        deserializedArgs,
        toolCallId,
        isSubagent,
        classification,
        resolvedName,
      };
    });

    const assistantToolCalls: AssistantToolCallOutput[] = preparedToolCalls.map((item) => ({
      id: item.toolCallId,
      type: "function",
      function: {
        name: item.tc.name,
        arguments: JSON.stringify(item.deserializedArgs),
      },
    }));

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
    lastGenerationLevel = genObservation.level;
    lastGenerationStatusMessage = genObservation.statusMessage;

    const assistantHistoryMsg: ChatMessage = {
      role: "assistant",
      content: contentText ?? (assistantToolCalls.length > 0 ? null : ""),
      ...(assistantToolCalls.length > 0 ? { tool_calls: assistantToolCalls } : {}),
    };

    history.push(assistantHistoryMsg);

    for (let tcIdx = 0; tcIdx < preparedToolCalls.length; tcIdx++) {
      const { tc, deserializedArgs, toolCallId, isSubagent, classification, resolvedName } =
        preparedToolCalls[tcIdx]!;
      const genericResult = matchingGenerics[tcIdx];

      collectModuleTagsFromToolArgs(deserializedArgs, tags);

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

      const resultStepIndex = genericResult?.step_index ?? step.step_index;

      if (isError) {
        errorCount++;
        failedTools.push(`${resolvedName} (step ${resultStepIndex})`);
      }

      if (genericResult) {
        const rawToolOutput = isError ? (statusMessage ?? cleanBody) : cleanBody;
        const safeToolOutput =
          rawToolOutput.length > 30_000
            ? `${rawToolOutput.slice(0, 30_000)}\n... [truncated for observation history]`
            : rawToolOutput;

        history.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: safeToolOutput,
        });
      }

      if (isSubagent) {
        observationCounts.agent++;

        const subagentIds = extractSubagentConversationIds(deserializedArgs, cleanBody);
        const subagentId = subagentIds[0];
        let subagentChildren: ParsedChildObservation[] = [];
        let subagentUsage: TokenUsageSummary = {
          input: 0,
          output: 0,
          cacheReadInputTokens: 0,
          total: 0,
        };

        if (subagentIds.length > 0 && typeof options.resolveSubagentTranscript === "function") {
          for (const candidateSubId of subagentIds) {
            if (visited.has(candidateSubId)) {
              continue;
            }

            const childTranscriptRaw = options.resolveSubagentTranscript(candidateSubId);

            if (!childTranscriptRaw) {
              continue;
            }

            const nextVisited = new Set(visited);

            nextVisited.add(candidateSubId);

            const subTurns = parseTranscriptTurns(childTranscriptRaw, {
              ...options,
              modelName: effectiveModelName,
              conversationId: candidateSubId,
              terminationReason: undefined,
              afterStepIndex: undefined,
              afterLineIndex: undefined,
              visitedConversationIds: nextVisited,
            });

            subagentChildren = [...subagentChildren, ...subTurns.flatMap((t) => t.children)];

            for (const st of subTurns) {
              subagentUsage = {
                input: subagentUsage.input + st.usageSummary.input,
                output: subagentUsage.output + st.usageSummary.output,
                cacheReadInputTokens:
                  subagentUsage.cacheReadInputTokens + st.usageSummary.cacheReadInputTokens,
                total: subagentUsage.total + st.usageSummary.total,
              };

              const subFailedTools = Array.isArray(st.metadata.failedTools)
                ? st.metadata.failedTools.filter((item): item is string => typeof item === "string")
                : [];

              if (subFailedTools.length > 0) {
                failedTools.push(...subFailedTools);
                errorCount += subFailedTools.length;
              } else if (typeof st.metadata.errorCount === "number" && st.metadata.errorCount > 0) {
                errorCount += st.metadata.errorCount;
              }

              for (const tag of st.tags) {
                tags.add(tag);
              }
            }
          }

          usageSummary.input += subagentUsage.input;
          usageSummary.output += subagentUsage.output;
          usageSummary.cacheReadInputTokens += subagentUsage.cacheReadInputTokens;
          usageSummary.total += subagentUsage.total;
        }

        const resolvedRole =
          typeof deserializedArgs.Role === "string"
            ? deserializedArgs.Role
            : typeof deserializedArgs.name === "string"
              ? deserializedArgs.name
              : undefined;
        const resolvedSubagentType =
          typeof deserializedArgs.TypeName === "string"
            ? deserializedArgs.TypeName
            : tc.name === "swarm"
              ? "swarm"
              : undefined;

        const agentObs: ParsedAgentObservation = {
          type: "agent",
          name: resolvedName,
          stepIndex: resultStepIndex,
          toolCallId,
          ...(subagentId ? { subagentConversationId: subagentId } : {}),
          ...(subagentIds.length > 1 ? { subagentConversationIds: subagentIds } : {}),
          ...(resolvedRole ? { role: resolvedRole } : {}),
          ...(resolvedSubagentType ? { subagentType: resolvedSubagentType } : {}),
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
            ...(subagentIds.length > 1 ? { subagentConversationIds: subagentIds } : {}),
          },
        };

        children.push(agentObs);
      } else {
        toolCount++;

        const resolvedClassification = classification!;

        observationCounts[resolvedClassification.type]++;

        const toolObs: ParsedToolObservation = {
          type: resolvedClassification.type,
          name: resolvedClassification.observationName,
          rawToolName: tc.name,
          stepIndex: resultStepIndex,
          toolCallId,
          startTime,
          endTime,
          input: resolvedClassification.normalizedInput ?? deserializedArgs,
          output: cleanBody,
          level: isError ? "ERROR" : "DEFAULT",
          ...(statusMessage ? { statusMessage } : {}),
          metadata: {
            stepIndex: resultStepIndex,
            toolCallIndex: tcIdx,
            toolCallId,
            rawToolName: tc.name,
            ...(resolvedClassification.skillMatch
              ? {
                  skillName: resolvedClassification.skillMatch.skillName,
                  skillPath: resolvedClassification.skillMatch.relativePath,
                }
              : {}),
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
    ...(lastGenerationLevel ? { lastGenerationLevel } : {}),
    ...(lastGenerationStatusMessage ? { lastGenerationStatusMessage } : {}),
    generationCount,
    toolCount,
    errorCount,
    failedTools,
    systemMessageCount,
    observationCounts,
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
  let sliceCompletedByPlanner = false;

  for (const step of steps) {
    if (step.type === "USER_INPUT") {
      if (currentSlice.length > 0) {
        turnSlices.push(currentSlice);
      }

      currentSlice = [step];
      sliceCompletedByPlanner = false;
      continue;
    }

    if (step.type === "SYSTEM_MESSAGE" && sliceCompletedByPlanner && currentSlice.length > 0) {
      turnSlices.push(currentSlice);
      currentSlice = [step];
      sliceCompletedByPlanner = false;
      continue;
    }

    currentSlice.push(step);

    if (step.type === "PLANNER_RESPONSE") {
      const hasToolCalls = Array.isArray(step.tool_calls) && step.tool_calls.length > 0;

      sliceCompletedByPlanner = !hasToolCalls;
    }
  }

  if (currentSlice.length > 0) {
    turnSlices.push(currentSlice);
  }

  const parsedTurns: ParsedTurnTrace[] = [];
  let cumulativeSessionHistory: ChatMessage[] = [];
  let activeModelName = options.modelName?.trim() || "antigravity-model";
  let previousTurnContext: { input: string; output: string } | undefined;

  for (let idx = 0; idx < turnSlices.length; idx++) {
    const slice = turnSlices[idx]!;
    const turnIndex = idx + 1;
    const firstStep = slice[0]!;
    const lastStep = slice[slice.length - 1]!;
    const startStepIndex = firstStep.step_index;
    const endStepIndex = lastStep.step_index;
    const endLineIndex = lastStep._lineIndex;

    const userInputStep = slice.find((s) => s.type === "USER_INPUT");
    const firstSystemStep = slice.find((s) => s.type === "SYSTEM_MESSAGE");
    const isReactiveWakeup = !userInputStep && firstSystemStep !== undefined;
    const extractedInput = extractUserRequest(userInputStep?.content ?? "");
    const systemInputText = firstSystemStep
      ? extractSystemMessageContent(firstSystemStep.content ?? "")
      : "";
    const turnInput = extractedInput.prompt || systemInputText;
    const startTime = parseIsoTimestamp(firstStep.created_at, new Date(0));

    const settingsChanges = extractedInput.userSettingsChange
      ? parseUserSettingsChanges(extractedInput.userSettingsChange)
      : [];

    for (const change of settingsChanges) {
      if (change.normalizedModel) {
        activeModelName = change.normalizedModel;
      }
    }

    const initialEvents = buildSettingsEvents(
      settingsChanges,
      userInputStep?.step_index ?? startStepIndex,
      startTime,
    );

    const sequence = parseStepSequence(
      slice,
      extractedInput.prompt,
      options,
      visited,
      cumulativeSessionHistory,
      activeModelName,
      initialEvents,
    );

    const nextSlice = turnSlices[idx + 1];
    const supersededBeforeGeneration =
      sequence.generationCount === 0 &&
      nextSlice !== undefined &&
      nextSlice[0]!.step_index <= startStepIndex;

    if (!supersededBeforeGeneration) {
      cumulativeSessionHistory = sequence.history;
    }

    const isClientCommand = isClientMetaCommand(extractedInput.prompt);
    const clientCommandMatch = isClientCommand
      ? extractedInput.prompt.trim().match(/^\/([a-zA-Z0-9_-]+)/)
      : null;
    const clientCommandName = clientCommandMatch?.[1]?.toLowerCase();

    const output =
      sequence.lastAssistantContent ||
      (sequence.generationCount > 0 || sequence.toolCount > 0
        ? `Completed ${sequence.generationCount} generation(s) and ${sequence.toolCount} tool call(s).`
        : isClientCommand
          ? `Executed client command: ${extractedInput.prompt.trim()}`
          : "");
    const priorTurn = previousTurnContext;

    previousTurnContext = {
      input: isReactiveWakeup ? (priorTurn?.input ?? systemInputText) : extractedInput.prompt,
      output,
    };

    if (options.afterLineIndex !== undefined && endLineIndex !== undefined) {
      if (endLineIndex <= options.afterLineIndex) {
        continue;
      }
    } else if (options.afterStepIndex !== undefined && endStepIndex <= options.afterStepIndex) {
      continue;
    }

    let endTime = parseIsoTimestamp(lastStep.created_at, startTime);

    if (endTime.getTime() < startTime.getTime()) {
      endTime = startTime;
    }

    for (const child of sequence.children) {
      if (child.endTime.getTime() > endTime.getTime()) {
        endTime = child.endTime;
      }
    }

    const normalizedTerminationReason =
      idx === turnSlices.length - 1 ? options.terminationReason?.trim() || undefined : undefined;
    const isUserCanceled = normalizedTerminationReason === "USER_CANCELED";
    const isFailedGeneration = sequence.lastGenerationLevel === "ERROR";
    const isInterrupted =
      isUserCanceled ||
      (!isClientCommand &&
        (sequence.generationCount === 0 ||
          (!isFailedGeneration && !sequence.lastAssistantContent)));

    const traceLevel = isUserCanceled
      ? "WARNING"
      : isFailedGeneration
        ? "ERROR"
        : isInterrupted
          ? "WARNING"
          : undefined;
    const traceStatusMessage = isUserCanceled
      ? "Turn canceled by user (USER_CANCELED)"
      : isFailedGeneration
        ? (sequence.lastGenerationStatusMessage ?? "Generation failed")
        : isInterrupted
          ? sequence.generationCount === 0
            ? "Interrupted before model generation"
            : "Turn ended without final assistant text"
          : undefined;

    const gateSummary = buildTurnGateSummary(sequence.children);
    const hasPreviousTurn = turnIndex > 1 && priorTurn !== undefined && !isReactiveWakeup;

    const metadata: Record<string, unknown> = {
      turnIndex,
      startStepIndex,
      endStepIndex,
      model: activeModelName,
      generationCount: sequence.generationCount,
      toolCount: sequence.toolCount,
      errorCount: sequence.errorCount,
      failedTools: sequence.failedTools,
      gateSummary,
      systemMessageCount: sequence.systemMessageCount,
      observationCounts: sequence.observationCounts,
      hasPreviousTurn,
      ...(isReactiveWakeup ? { reactiveWakeup: true, triggerType: "system-wakeup" } : {}),
      ...(isClientCommand ? { clientCommand: true } : {}),
      ...(hasPreviousTurn
        ? {
            previousTurnInput: truncatePreviousTurnText(priorTurn.input),
            previousTurnOutput: truncatePreviousTurnText(priorTurn.output),
          }
        : {}),
      ...(normalizedTerminationReason ? { terminationReason: normalizedTerminationReason } : {}),
      ...(isInterrupted ? { interrupted: true } : {}),
    };

    if (extractedInput.additionalMetadata) {
      metadata.additionalMetadata = extractedInput.additionalMetadata;
    }

    if (extractedInput.userSettingsChange) {
      metadata.userSettingsChange = extractedInput.userSettingsChange;
    }

    const turnTags = new Set(sequence.tags);

    if (clientCommandName) {
      turnTags.add(`command:${clientCommandName}`);
    }

    if (isReactiveWakeup) {
      turnTags.add("trigger:system-wakeup");
    }

    parsedTurns.push({
      turnIndex,
      traceSeed: `${options.conversationId}-turn-${turnIndex}`,
      traceName: "agent-turn",
      sessionId: options.conversationId,
      startStepIndex,
      endStepIndex,
      ...(typeof endLineIndex === "number" ? { endLineIndex } : {}),
      startTime,
      endTime,
      input: turnInput,
      output,
      ...(traceLevel ? { level: traceLevel } : {}),
      ...(traceStatusMessage ? { statusMessage: traceStatusMessage } : {}),
      children: sequence.children,
      usageSummary: sequence.usageSummary,
      tags: [...turnTags].sort(),
      metadata,
    });
  }

  return parsedTurns;
}

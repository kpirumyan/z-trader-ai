import fs from "node:fs";
import path from "node:path";

interface RawToolCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

interface RawTranscriptStep {
  step_index: number;
  source?: string;
  type: string;
  status?: string;
  created_at?: string;
  content?: string;
  thinking?: string;
  tool_calls?: RawToolCall[];
  input_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
  error?: string;
}

interface TokenUsageSummary {
  input: number;
  output: number;
  cacheReadInputTokens: number;
  total: number;
}

interface AssistantToolCallOutput {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface ParsedGenerationObservation {
  type: "generation";
  name: "llm-generation";
  stepIndex: number;
  model: string;
  startTime: Date;
  endTime: Date;
  input: Array<{ role: string; content: string }>;
  output: {
    role: "assistant";
    content: string | null;
    thinking?: string;
    tool_calls?: AssistantToolCallOutput[];
  };
  usageDetails: {
    input: number;
    output: number;
    cache_read_input_tokens?: number;
    total: number;
  };
  metadata: Record<string, unknown>;
  level?: "DEFAULT" | "WARNING" | "ERROR";
  statusMessage?: string;
}

interface ParsedToolObservation {
  type: "tool";
  name: string;
  stepIndex: number;
  startTime: Date;
  endTime: Date;
  input: Record<string, unknown>;
  output: string;
  level: "DEFAULT" | "ERROR";
  statusMessage?: string;
  metadata: Record<string, unknown>;
}

export interface ParsedAgentObservation {
  type: "agent";
  name: string;
  stepIndex: number;
  subagentConversationId?: string;
  role?: string;
  subagentType?: string;
  startTime: Date;
  endTime: Date;
  input: Record<string, unknown>;
  output: string;
  level: "DEFAULT" | "ERROR";
  statusMessage?: string;
  children: ParsedChildObservation[];
  usageSummary: TokenUsageSummary;
  metadata: Record<string, unknown>;
}

export type ParsedChildObservation =
  | ParsedGenerationObservation
  | ParsedToolObservation
  | ParsedAgentObservation;

export interface ParsedTurnTrace {
  turnIndex: number;
  traceSeed: string;
  traceName: "agent-turn";
  sessionId: string;
  startStepIndex: number;
  endStepIndex: number;
  startTime: Date;
  endTime: Date;
  input: string;
  output: string;
  children: ParsedChildObservation[];
  usageSummary: TokenUsageSummary;
  tags: string[];
  metadata: Record<string, unknown>;
}

interface ParseTranscriptOptions {
  conversationId: string;
  modelName?: string;
  afterStepIndex?: number;
  resolveSubagentTranscript?: (subagentConversationId: string) => string | null;
  visitedConversationIds?: Set<string>;
}

interface ExtractedUserRequest {
  prompt: string;
  additionalMetadata?: string;
  userSettingsChange?: string;
}

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CREATED_AT_HEADER_REGEX = /^Created At:\s*([^\r\n]+)\r?\nCompleted At:\s*([^\r\n]+)\r?\n?/;
const MODULE_PATH_REGEX = /(?:^|\/)src\/modules\/([a-zA-Z0-9_-]+)(?:\/|$)/g;
const SKILL_PATH_REGEX = /(?:^|\/)(?:\.agents\/)?skills\/([a-zA-Z0-9_-]+)(?:\/|$)/g;

export function resolveFullTranscriptPath(transcriptPath: string): string {
  const dir = path.dirname(transcriptPath);
  const fullCandidate = path.join(dir, "transcript_full.jsonl");

  if (fs.existsSync(fullCandidate)) {
    return fullCandidate;
  }

  return transcriptPath;
}

export function createFilesystemSubagentResolver(
  parentTranscriptPath: string,
): (subagentConversationId: string) => string | null {
  // Parent transcript lives at <brainDir>/<conversationId>/.system_generated/logs/transcript_full.jsonl
  const logsDir = path.dirname(parentTranscriptPath);
  const systemGeneratedDir = path.dirname(logsDir);
  const conversationDir = path.dirname(systemGeneratedDir);
  const brainDir = path.dirname(conversationDir);

  return (subagentConversationId: string): string | null => {
    const candidateLogsDir = path.join(brainDir, subagentConversationId, ".system_generated", "logs");
    const fullPath = path.join(candidateLogsDir, "transcript_full.jsonl");

    if (fs.existsSync(fullPath)) {
      return fs.readFileSync(fullPath, "utf8");
    }

    const compactPath = path.join(candidateLogsDir, "transcript.jsonl");

    if (fs.existsSync(compactPath)) {
      return fs.readFileSync(compactPath, "utf8");
    }

    return null;
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

export function deserializeToolArgs(
  rawArgs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!rawArgs) {
    return {};
  }

  const deserialized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawArgs)) {
    if (typeof value !== "string") {
      deserialized[key] = value;
      continue;
    }

    const trimmed = value.trim();
    const looksJsonEncoded =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      trimmed === "true" ||
      trimmed === "false" ||
      trimmed === "null" ||
      /^-?\d+(?:\.\d+)?$/.test(trimmed);

    if (looksJsonEncoded) {
      try {
        deserialized[key] = JSON.parse(trimmed) as unknown;
        continue;
      } catch {
        // Fallback to raw string when JSON parsing fails
      }
    }

    deserialized[key] = value;
  }

  return deserialized;
}

function parseIsoTimestamp(raw: string | undefined, fallback: Date): Date {
  if (!raw) {
    return fallback;
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed;
}

function extractGenericTimingAndBody(
  rawContent: string | undefined,
  stepCreatedAt: Date,
): { startTime: Date; endTime: Date; cleanBody: string } {
  if (!rawContent) {
    return {
      startTime: stepCreatedAt,
      endTime: stepCreatedAt,
      cleanBody: "",
    };
  }

  const match = rawContent.match(CREATED_AT_HEADER_REGEX);

  if (!match) {
    return {
      startTime: stepCreatedAt,
      endTime: stepCreatedAt,
      cleanBody: rawContent.trim(),
    };
  }

  const startTime = parseIsoTimestamp(match[1]?.trim(), stepCreatedAt);
  const rawEndTime = parseIsoTimestamp(match[2]?.trim(), startTime);
  const endTime = rawEndTime.getTime() >= startTime.getTime() ? rawEndTime : startTime;
  const cleanBody = rawContent.slice(match[0].length).trim();

  return {
    startTime,
    endTime,
    cleanBody,
  };
}

function deriveSubagentObservationName(deserializedArgs: Record<string, unknown>): string {
  const rawRole =
    typeof deserializedArgs.Role === "string" && deserializedArgs.Role.trim()
      ? deserializedArgs.Role.trim()
      : typeof deserializedArgs.TypeName === "string" && deserializedArgs.TypeName.trim()
        ? deserializedArgs.TypeName.trim()
        : "worker";

  const slug = rawRole
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `subagent:${slug || "worker"}`;
}

function extractSubagentConversationId(
  deserializedArgs: Record<string, unknown>,
  genericContent: string,
): string | undefined {
  if (typeof deserializedArgs.ConversationId === "string") {
    const argMatch = deserializedArgs.ConversationId.match(UUID_REGEX);

    if (argMatch) {
      return argMatch[0].toLowerCase();
    }
  }

  const labeledMatch = genericContent.match(
    /conversationId[:\s"=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );

  if (labeledMatch && labeledMatch[1]) {
    return labeledMatch[1].toLowerCase();
  }

  const anyUuidMatch = genericContent.match(UUID_REGEX);

  return anyUuidMatch ? anyUuidMatch[0].toLowerCase() : undefined;
}

function collectTagsFromValue(value: unknown, tagSet: Set<string>): void {
  if (typeof value === "string") {
    const normalized = value.replace(/\\/g, "/");

    for (const match of normalized.matchAll(MODULE_PATH_REGEX)) {
      if (match[1]) {
        tagSet.add(`module:${match[1]}`);
      }
    }

    for (const match of normalized.matchAll(SKILL_PATH_REGEX)) {
      if (match[1]) {
        tagSet.add(`skill:${match[1]}`);
      }
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTagsFromValue(item, tagSet);
    }

    return;
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectTagsFromValue(nested, tagSet);
    }
  }
}

function parseJsonlSteps(jsonlContent: string): RawTranscriptStep[] {
  const lines = jsonlContent.split(/\r?\n/);
  const steps: RawTranscriptStep[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as RawTranscriptStep;

      if (typeof parsed.step_index === "number" && typeof parsed.type === "string") {
        steps.push(parsed);
      }
    } catch {
      // Skip malformed or incomplete trailing JSONL lines
    }
  }

  return steps.sort((a, b) => a.step_index - b.step_index);
}

interface ParsedStepSequenceResult {
  children: ParsedChildObservation[];
  usageSummary: TokenUsageSummary;
  tags: Set<string>;
  lastAssistantContent: string;
  generationCount: number;
  toolCount: number;
  errorCount: number;
}

function parseStepSequence(
  steps: RawTranscriptStep[],
  promptText: string,
  options: ParseTranscriptOptions,
  visited: Set<string>,
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

  let i = 0;

  while (i < steps.length) {
    const step = steps[i]!;

    if (step.type !== "PLANNER_RESPONSE") {
      i++;
      continue;
    }

    generationCount++;

    const genStartTime = parseIsoTimestamp(step.created_at, new Date(0));
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

    // Determine generation endTime from first tool start or next step timestamp
    let genEndTime = genStartTime;

    if (matchingGenerics.length > 0) {
      const firstTiming = extractGenericTimingAndBody(
        matchingGenerics[0]!.content,
        parseIsoTimestamp(matchingGenerics[0]!.created_at, genStartTime),
      );

      if (firstTiming.startTime.getTime() >= genStartTime.getTime()) {
        genEndTime = firstTiming.startTime;
      }
    } else if (i + 1 < steps.length) {
      const nextTime = parseIsoTimestamp(steps[i + 1]!.created_at, genStartTime);

      if (nextTime.getTime() >= genStartTime.getTime()) {
        genEndTime = nextTime;
      }
    }

    const assistantToolCalls: AssistantToolCallOutput[] = rawToolCalls.map((tc, idx) => {
      const deserialized = deserializeToolArgs(tc.args);

      return {
        id: tc.id ?? `call_${step.step_index}_${idx}`,
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
      input: [{ role: "user", content: promptText }],
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

    // Emit sibling tool or subagent observations for each tool call
    for (let tcIdx = 0; tcIdx < rawToolCalls.length; tcIdx++) {
      const tc = rawToolCalls[tcIdx]!;
      const genericResult = matchingGenerics[tcIdx];
      const deserializedArgs = deserializeToolArgs(tc.args);

      collectTagsFromValue(deserializedArgs, tags);

      const fallbackStepTime = parseIsoTimestamp(genericResult?.created_at, genEndTime);
      const { startTime, endTime, cleanBody } = extractGenericTimingAndBody(
        genericResult?.content,
        fallbackStepTime,
      );
      const isError = genericResult?.status === "ERROR" || Boolean(genericResult?.error);
      const statusMessage =
        genericResult?.error ?? (isError ? cleanBody.slice(0, 200) : undefined);

      if (isError) {
        errorCount++;
      }

      const resultStepIndex = genericResult?.step_index ?? step.step_index;

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

        const agentObs: ParsedAgentObservation = {
          type: "agent",
          name: subagentName,
          stepIndex: resultStepIndex,
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
            ...(subagentId ? { subagentConversationId: subagentId } : {}),
          },
        };

        children.push(agentObs);
      } else {
        toolCount++;

        const toolObs: ParsedToolObservation = {
          type: "tool",
          name: tc.name,
          stepIndex: resultStepIndex,
          startTime,
          endTime,
          input: deserializedArgs,
          output: cleanBody,
          level: isError ? "ERROR" : "DEFAULT",
          ...(statusMessage ? { statusMessage } : {}),
          metadata: {
            stepIndex: resultStepIndex,
            toolCallIndex: tcIdx,
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

  // Group steps into turns starting at each USER_INPUT step
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

  for (let idx = 0; idx < turnSlices.length; idx++) {
    const slice = turnSlices[idx]!;
    const turnIndex = idx + 1;
    const firstStep = slice[0]!;
    const lastStep = slice[slice.length - 1]!;
    const startStepIndex = firstStep.step_index;
    const endStepIndex = lastStep.step_index;

    if (options.afterStepIndex !== undefined && endStepIndex <= options.afterStepIndex) {
      continue;
    }

    const userInputStep = slice.find((s) => s.type === "USER_INPUT");
    const extractedInput = extractUserRequest(userInputStep?.content ?? "");
    const startTime = parseIsoTimestamp(firstStep.created_at, new Date(0));

    const sequence = parseStepSequence(slice, extractedInput.prompt, options, visited);

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

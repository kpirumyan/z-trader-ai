import type { LangfuseSpanProcessor } from "@langfuse/otel";
import type { setLangfuseTracerProvider, startObservation } from "@langfuse/tracing";

export interface RawToolCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface RawTranscriptStep {
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

export interface TokenUsageSummary {
  input: number;
  output: number;
  cacheReadInputTokens: number;
  total: number;
}

export interface AssistantToolCallOutput {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: AssistantToolCallOutput[];
  tool_call_id?: string;
}

export interface ParsedGenerationObservation {
  type: "generation";
  name: "llm-generation";
  stepIndex: number;
  model: string;
  startTime: Date;
  endTime: Date;
  input: ChatMessage[];
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

export interface ParsedToolObservation {
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
  ParsedGenerationObservation | ParsedToolObservation | ParsedAgentObservation;

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

export interface ParseTranscriptOptions {
  conversationId: string;
  modelName?: string;
  afterStepIndex?: number;
  resolveSubagentTranscript?: (subagentConversationId: string) => string | null;
  visitedConversationIds?: Set<string>;
}

export interface ExtractedUserRequest {
  prompt: string;
  additionalMetadata?: string;
  userSettingsChange?: string;
}

export interface StopHookInput {
  conversationId?: string;
  transcriptPath?: string;
  modelName?: string;
  cwd?: string;
  workspacePaths?: string[];
}

export interface ContextAnchor {
  gitSha: string;
  gitShortSha: string;
  gitBranch: string;
  isDirty: boolean;
  agentsHash: string;
  version: string;
}

export type ReleaseContext = ContextAnchor;

export interface LangfuseCursorState {
  lastExportedStepIndex: number;
  lastExportedTurnIndex: number;
  updatedAt: string;
}

export interface PendingExportSpool {
  pendingTurns: ParsedTurnTrace[];
  updatedAt: string;
}

export type SpanExporterLike = NonNullable<
  ConstructorParameters<typeof LangfuseSpanProcessor>[0]
>["exporter"];

export type TracerProviderLike = Parameters<typeof setLangfuseTracerProvider>[0];

export type ParentSpanContextLike = NonNullable<
  Parameters<typeof startObservation>[2]
>["parentSpanContext"];

export interface RunStopHookOptions {
  dryRun?: boolean;
  persistCursorInDryRun?: boolean;
  timeoutMs?: number;
  spanExporter?: SpanExporterLike;
  simulateFlushFailure?: Error;
  onWarning?: (message: string) => void;
}

export interface RunStopHookResult {
  decision: "allow";
  exportedTurns: number;
  spooledTurns: number;
  version: string;
  dryRun: boolean;
  summary: Array<{
    turnIndex: number;
    traceId: string;
    childCount: number;
    tags: string[];
    totalTokens: number;
  }>;
}

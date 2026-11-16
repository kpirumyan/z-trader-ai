/**
 * Reference implementation of the `agent-turn-signals` Langfuse TypeScript Code Evaluator.
 * Keep this file strictly dependency-free and limited to erasable TypeScript syntax.
 * When syncing to Langfuse Code Evaluators, omit the `export` keyword on `evaluate`.
 */

type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
  type: string;
  index: number;
};

type EvaluationContext = {
  observation: {
    input: unknown;
    output: unknown;
    metadata: unknown;
    toolCalls: ToolCall[];
  };
  experiment:
    | {
        itemExpectedOutput: unknown;
        itemMetadata: unknown;
      }
    | undefined;
};

type ScoreBase = {
  name: string;
  comment?: string;
  configId?: string | null;
  metadata?: Record<string, unknown>;
};

type NumericScore = ScoreBase & {
  dataType: "NUMERIC";
  value: number;
};

type BooleanScore = ScoreBase & {
  dataType: "BOOLEAN";
  value: boolean;
};

type CategoricalScore = ScoreBase & {
  dataType: "CATEGORICAL";
  value: string;
};

type TextScore = ScoreBase & {
  dataType: "TEXT";
  value: string;
};

type Score = NumericScore | BooleanScore | CategoricalScore | TextScore;

type EvaluationResult = {
  scores: Score[];
};

type GateSummary = {
  totalRuns: number;
  firstTryPassed: boolean | null;
  finalPassed: boolean | null;
  retryCount: number;
  failedGates: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function parseOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return null;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);

        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0,
          );
        }
      } catch {
        return [];
      }
    }
  }

  return [];
}

function extractGateSummary(meta: Record<string, unknown>): GateSummary | null {
  let nested: Record<string, unknown> | null = null;

  if (isRecord(meta.gateSummary)) {
    nested = meta.gateSummary;
  } else if (typeof meta.gateSummary === "string" && meta.gateSummary.trim().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(meta.gateSummary);

      if (isRecord(parsed)) {
        nested = parsed;
      }
    } catch {
      nested = null;
    }
  }

  if (nested) {
    return {
      totalRuns: Math.max(0, Math.trunc(toFiniteNumber(nested.totalRuns, 0))),
      firstTryPassed: parseOptionalBoolean(nested.firstTryPassed),
      finalPassed: parseOptionalBoolean(nested.finalPassed),
      retryCount: Math.max(0, Math.trunc(toFiniteNumber(nested.retryCount, 0))),
      failedGates: toStringArray(nested.failedGates),
    };
  }

  if (
    "gateSummary.totalRuns" in meta ||
    "gateSummary.firstTryPassed" in meta ||
    "gateSummary.finalPassed" in meta
  ) {
    return {
      totalRuns: Math.max(0, Math.trunc(toFiniteNumber(meta["gateSummary.totalRuns"], 0))),
      firstTryPassed: parseOptionalBoolean(meta["gateSummary.firstTryPassed"]),
      finalPassed: parseOptionalBoolean(meta["gateSummary.finalPassed"]),
      retryCount: Math.max(0, Math.trunc(toFiniteNumber(meta["gateSummary.retryCount"], 0))),
      failedGates: toStringArray(meta["gateSummary.failedGates"]),
    };
  }

  return null;
}

/**
 * Evaluates a root `agent-turn` observation and emits deterministic quality/behavioral scores.
 */
export function evaluate({ observation: { metadata } }: EvaluationContext): EvaluationResult {
  const meta = isRecord(metadata) ? metadata : {};

  const failedTools = toStringArray(meta.failedTools);
  const errorCount =
    meta.errorCount != null
      ? Math.max(0, Math.trunc(toFiniteNumber(meta.errorCount, 0)))
      : failedTools.length;
  const hasToolErrors = errorCount > 0;
  const toolErrorComment =
    failedTools.length > 0
      ? `Failed tools (${failedTools.length}): ${failedTools.join(", ")}`
      : hasToolErrors
        ? `${errorCount} tool error(s) recorded`
        : "No tool errors";

  const scores: Score[] = [
    {
      name: "tool_error_occurred",
      value: hasToolErrors,
      dataType: "BOOLEAN",
      comment: toolErrorComment,
    },
    {
      name: "tool_error_count",
      value: errorCount,
      dataType: "NUMERIC",
      comment: toolErrorComment,
    },
  ];

  const gateSummary = extractGateSummary(meta);

  if (gateSummary && gateSummary.totalRuns > 0) {
    const gateOutcome =
      gateSummary.firstTryPassed === true && gateSummary.finalPassed === true
        ? "passed_first_try"
        : gateSummary.finalPassed === true
          ? "passed_after_retry"
          : "failed";
    const failedGatesPart =
      gateSummary.failedGates.length > 0
        ? `; failed gates: ${gateSummary.failedGates.join(", ")}`
        : "";

    scores.push({
      name: "gate_outcome",
      value: gateOutcome,
      dataType: "CATEGORICAL",
      comment: `Runs: ${gateSummary.totalRuns}, retries: ${gateSummary.retryCount}${failedGatesPart}`,
    });
  }

  const interruptedFlag = parseOptionalBoolean(meta.interrupted) === true;
  const terminationReason =
    typeof meta.terminationReason === "string" ? meta.terminationReason.trim() : "";
  const isInterrupted = interruptedFlag || terminationReason === "USER_CANCELED";
  const interruptComment = terminationReason
    ? `Termination reason: ${terminationReason}`
    : isInterrupted
      ? "Turn interrupted before completion"
      : "Completed normally";

  scores.push({
    name: "turn_interrupted",
    value: isInterrupted,
    dataType: "BOOLEAN",
    comment: interruptComment,
  });

  return { scores };
}

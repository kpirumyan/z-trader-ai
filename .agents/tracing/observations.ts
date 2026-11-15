import { createTraceId, propagateAttributes, startObservation } from "@langfuse/tracing";

import type {
  ContextAnchor,
  ParentSpanContextLike,
  ParsedChildObservation,
  ParsedToolObservation,
  ParsedTurnTrace,
} from "./types.ts";

const SYNTHETIC_PARENT_SPAN_ID = "0123456789abcdef";

function startToolCategoryObservation(
  child: ParsedToolObservation,
  parentSpanContext: ParentSpanContextLike,
) {
  const attributes = {
    input: child.input,
    output: child.output,
    level: child.level,
    statusMessage: child.statusMessage,
    metadata: {
      ...child.metadata,
      ...(child.toolCallId ? { toolCallId: child.toolCallId } : {}),
    },
  };

  switch (child.type) {
    case "retriever":
      return startObservation(child.name, attributes, {
        asType: "retriever",
        startTime: child.startTime,
        parentSpanContext,
      });

    case "evaluator":
      return startObservation(child.name, attributes, {
        asType: "evaluator",
        startTime: child.startTime,
        parentSpanContext,
      });

    case "guardrail":
      return startObservation(child.name, attributes, {
        asType: "guardrail",
        startTime: child.startTime,
        parentSpanContext,
      });

    case "tool":
      return startObservation(child.name, attributes, {
        asType: "tool",
        startTime: child.startTime,
        parentSpanContext,
      });
  }
}

export async function createTurnTraceId(turn: ParsedTurnTrace): Promise<string> {
  return createTraceId(turn.traceSeed);
}

export function emitChildObservations(
  children: ParsedChildObservation[],
  parentSpanContext: ParentSpanContextLike,
): void {
  for (const child of children) {
    if (child.type === "generation") {
      const genObs = startObservation(
        child.name,
        {
          model: child.model,
          input: child.input,
          output: child.output,
          usageDetails: child.usageDetails,
          metadata: child.metadata,
          level: child.level,
          statusMessage: child.statusMessage,
        },
        {
          asType: "generation",
          startTime: child.startTime,
          parentSpanContext,
        },
      );

      genObs.end(child.endTime);
    } else if (child.type === "event") {
      // LangfuseEvent ends its underlying OTel span inside the constructor at startTime.
      startObservation(
        child.name,
        {
          input: child.input,
          level: child.level,
          metadata: child.metadata,
        },
        {
          asType: "event",
          startTime: child.startTime,
          parentSpanContext,
        },
      );
    } else if (child.type === "agent") {
      const subagentObs = startObservation(
        child.name,
        {
          input: child.input,
          output: child.output,
          level: child.level,
          statusMessage: child.statusMessage,
          metadata: {
            ...child.metadata,
            ...(child.toolCallId ? { toolCallId: child.toolCallId } : {}),
            usageSummary: child.usageSummary,
          },
        },
        {
          asType: "agent",
          startTime: child.startTime,
          parentSpanContext,
        },
      );

      if (child.toolCallId) {
        subagentObs.otelSpan.setAttribute("gen_ai.tool.call.id", child.toolCallId);
      }

      emitChildObservations(child.children, subagentObs.otelSpan.spanContext());
      subagentObs.end(child.endTime);
    } else {
      const toolObs = startToolCategoryObservation(child, parentSpanContext);

      if (child.toolCallId) {
        toolObs.otelSpan.setAttribute("gen_ai.tool.call.id", child.toolCallId);
      }

      // Langfuse OTLP ingestion prioritizes gen_ai.tool.name over span.name when naming
      // observations; keep rawToolName in observation metadata so the classified name survives.
      toolObs.otelSpan.setAttribute("gen_ai.tool.name", child.name);

      toolObs.end(child.endTime);
    }
  }
}

export async function emitRootObservation(
  turn: ParsedTurnTrace,
  contextAnchor: ContextAnchor,
  traceId: string,
): Promise<void> {
  await propagateAttributes(
    {
      sessionId: turn.sessionId,
      version: contextAnchor.version,
      tags: turn.tags,
      traceName: "agent-turn",
      attachSkills: true,
      metadata: {
        gitSha: contextAnchor.gitSha.slice(0, 120),
        gitBranch: contextAnchor.gitBranch.slice(0, 120),
        isDirty: String(contextAnchor.isDirty),
        turnIndex: String(turn.turnIndex),
      },
    },
    async () => {
      const rootObs = startObservation(
        "agent-turn",
        {
          input: turn.input,
          output: turn.output,
          metadata: {
            ...turn.metadata,
            gitSha: contextAnchor.gitSha,
            gitBranch: contextAnchor.gitBranch,
            isDirty: contextAnchor.isDirty,
            usageSummary: turn.usageSummary,
          },
        },
        {
          asType: "agent",
          startTime: turn.startTime,
          parentSpanContext: {
            traceId,
            spanId: SYNTHETIC_PARENT_SPAN_ID,
            traceFlags: 1,
          },
        },
      );

      emitChildObservations(turn.children, rootObs.otelSpan.spanContext());
      rootObs.end(turn.endTime);
    },
  );
}

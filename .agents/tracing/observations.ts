import {
  createTraceId,
  propagateAttributes,
  startActiveObservation,
  startObservation,
} from "@langfuse/tracing";

import { LINK_ANCHOR_SPAN_NAME, withDeterministicSpanId } from "./instrumentation.ts";

import type {
  ContextAnchor,
  ParentSpanContextLike,
  ParsedChildObservation,
  ParsedToolObservation,
  ParsedTurnTrace,
  SubagentLinkRecord,
  WorkflowLinkRecord,
} from "./types.ts";

interface SubagentLinkCollectionContext {
  parentConversationId: string;
  parentSessionId: string;
  collectedLinks: SubagentLinkRecord[];
}

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

function emitChildObservations(
  children: ParsedChildObservation[],
  parentSpanContext: ParentSpanContextLike,
  linkContext?: SubagentLinkCollectionContext,
  seedPrefix = "turn",
): void {
  for (let idx = 0; idx < children.length; idx++) {
    const child = children[idx];
    const childIdPart =
      child.type === "agent" ||
      child.type === "tool" ||
      child.type === "retriever" ||
      child.type === "evaluator" ||
      child.type === "guardrail"
        ? (child.toolCallId ?? child.name)
        : child.name;
    const childSeed = `${seedPrefix}:${idx}:${child.type}:${child.stepIndex}:${childIdPart}`;

    if (child.type === "generation") {
      const genObs = withDeterministicSpanId(childSeed, () =>
        startObservation(
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
        ),
      );

      genObs.end(child.endTime);
    } else if (child.type === "event") {
      // LangfuseEvent ends its underlying OTel span inside the constructor at startTime.
      withDeterministicSpanId(childSeed, () =>
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
        ),
      );
    } else if (child.type === "agent") {
      const subagentObs = withDeterministicSpanId(childSeed, () =>
        startObservation(
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
        ),
      );

      if (child.toolCallId) {
        subagentObs.otelSpan.setAttribute("gen_ai.tool.call.id", child.toolCallId);
      }

      const subagentSpanContext = subagentObs.otelSpan.spanContext();

      if (linkContext) {
        const subagentIds =
          child.subagentConversationIds ??
          (child.subagentConversationId ? [child.subagentConversationId] : []);

        for (const subId of subagentIds) {
          linkContext.collectedLinks.push({
            subagentConversationId: subId,
            parentConversationId: linkContext.parentConversationId,
            parentTraceId: subagentSpanContext.traceId,
            parentSpanId: subagentSpanContext.spanId,
            parentSessionId: linkContext.parentSessionId,
            agentName: child.name,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      emitChildObservations(child.children, subagentSpanContext, linkContext, childSeed);
      subagentObs.end(child.endTime);
    } else {
      const toolObs = withDeterministicSpanId(childSeed, () =>
        startToolCategoryObservation(child, parentSpanContext),
      );

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
  options?: {
    sessionIdOverride?: string;
    workflowLink?: WorkflowLinkRecord;
    orphanParentConversationId?: string;
  },
): Promise<SubagentLinkRecord[]> {
  const collectedLinks: SubagentLinkRecord[] = [];
  const workflowLink = options?.workflowLink;
  const effectiveSessionId =
    workflowLink?.parentSessionId ?? options?.sessionIdOverride ?? turn.sessionId;
  const isWorkflowWorker = Boolean(workflowLink);
  const isOrphanFallback = Boolean(options?.orphanParentConversationId && !workflowLink);
  const traceName = isWorkflowWorker ? "workflow-worker" : "agent-turn";
  const effectiveTags = Array.from(
    new Set([
      ...turn.tags,
      ...(isWorkflowWorker ? ["workflow-worker"] : []),
      ...(isOrphanFallback ? ["subagent:orphan"] : []),
    ]),
  ).sort();

  await propagateAttributes(
    {
      sessionId: effectiveSessionId,
      version: contextAnchor.version,
      tags: effectiveTags,
      traceName,
      attachSkills: true,
      metadata: {
        gitSha: contextAnchor.gitSha.slice(0, 120),
        gitBranch: contextAnchor.gitBranch.slice(0, 120),
        isDirty: String(contextAnchor.isDirty),
        turnIndex: String(turn.turnIndex),
        hasPreviousTurn: String(Boolean(turn.metadata.hasPreviousTurn)),
        ...(workflowLink
          ? {
              workerConversationId: turn.sessionId.slice(0, 120),
              workflowTaskId: workflowLink.taskId.slice(0, 120),
              ...(workflowLink.parentTraceId
                ? { workflowParentTraceId: workflowLink.parentTraceId.slice(0, 120) }
                : {}),
            }
          : {}),
        ...(isOrphanFallback && options?.orphanParentConversationId
          ? {
              subagentConversationId: turn.sessionId.slice(0, 120),
              parentConversationId: options.orphanParentConversationId.slice(0, 120),
              orphanFallback: "true",
            }
          : {}),
      },
    },
    async () => {
      const rootObs = withDeterministicSpanId(`${turn.traceSeed}:root`, () =>
        startObservation(
          "agent-turn",
          {
            input: turn.input,
            output: turn.output,
            ...(turn.level ? { level: turn.level } : {}),
            ...(turn.statusMessage ? { statusMessage: turn.statusMessage } : {}),
            metadata: {
              ...turn.metadata,
              gitSha: contextAnchor.gitSha,
              gitBranch: contextAnchor.gitBranch,
              isDirty: contextAnchor.isDirty,
              usageSummary: turn.usageSummary,
              ...(workflowLink
                ? {
                    workerConversationId: turn.sessionId,
                    workflowTaskId: workflowLink.taskId,
                    parentConversationId: workflowLink.parentConversationId,
                    ...(workflowLink.parentTraceId
                      ? { workflowParentTraceId: workflowLink.parentTraceId }
                      : {}),
                    ...(workflowLink.parentSpanId
                      ? { workflowParentSpanId: workflowLink.parentSpanId }
                      : {}),
                  }
                : {}),
              ...(isOrphanFallback && options?.orphanParentConversationId
                ? {
                    subagentConversationId: turn.sessionId,
                    parentConversationId: options.orphanParentConversationId,
                    orphanFallback: true,
                  }
                : {}),
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
        ),
      );

      emitChildObservations(
        turn.children,
        rootObs.otelSpan.spanContext(),
        {
          parentConversationId: turn.sessionId,
          parentSessionId: effectiveSessionId,
          collectedLinks,
        },
        turn.traceSeed,
      );

      rootObs.end(turn.endTime);
    },
  );

  return collectedLinks;
}

export async function emitLinkedSubagentTurn(
  turn: ParsedTurnTrace,
  contextAnchor: ContextAnchor,
  link: SubagentLinkRecord,
): Promise<SubagentLinkRecord[]> {
  const collectedLinks: SubagentLinkRecord[] = [];
  const linkedParentContext: ParentSpanContextLike = {
    traceId: link.parentTraceId,
    spanId: link.parentSpanId,
    traceFlags: 1,
  };
  const seedPrefix = `${link.parentTraceId}:sub:${turn.sessionId}:turn-${turn.turnIndex}`;

  await propagateAttributes(
    {
      sessionId: link.parentSessionId,
      version: contextAnchor.version,
      attachSkills: true,
    },
    async () => {
      await startActiveObservation(
        LINK_ANCHOR_SPAN_NAME,
        async () => {
          emitChildObservations(
            turn.children,
            linkedParentContext,
            {
              parentConversationId: turn.sessionId,
              parentSessionId: link.parentSessionId,
              collectedLinks,
            },
            seedPrefix,
          );
        },
        {
          asType: "span",
          parentSpanContext: linkedParentContext,
        },
      );
    },
  );

  return collectedLinks;
}

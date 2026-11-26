import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { atomicWriteJsonFile } from "./fs-atomic.ts";

import type {
  ParsedTurnTrace,
  RawTranscriptStep,
  WorkflowLinkRecord,
  WorkflowWatchRecord,
} from "../types.ts";

const WORKFLOWS_DIR_NAME = "workflows";
const WORKFLOW_LINKS_DIR_NAME = "workflow-links";
const COMPLETED_WATCH_RETENTION_MS = 15 * 60 * 1000;
const RUNNING_WATCH_RETENTION_MS = 2 * 60 * 60 * 1000;

const TASK_ID_REGEX = /task id[:\s"]+([0-9a-f-]{36}\/task-\d+|task-\d+)/i;
const TASK_LOG_URI_REGEX = /(?:Task logs are available at|Log):\s*(file:\/\/\/[^\s\r\n"'<>]+)/i;
const SYSTEM_SENDER_TASK_REGEX =
  /sender=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/task-\d+)/i;
const WORKER_LOG_UUID_REGEX =
  /^-\s+\[agent:[^\]]+\][^\r\n]*?\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gim;
const FINISH_TOOL_STEP_REGEX = /"name"\s*:\s*"finish"/;
const FINISH_PROMPT_MARKER_REGEX =
  /When you are done,\s*call the finish tool with your result\.|Task is complete\.\s*Summarize what you did/i;

function sanitizeKey(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "_") || "unknown"
  );
}

function getWorkflowWatchPath(spoolDir: string, taskKey: string): string {
  return path.join(spoolDir, WORKFLOWS_DIR_NAME, `${sanitizeKey(taskKey)}.json`);
}

function getWorkflowLinkPath(spoolDir: string, workerConversationId: string): string {
  return path.join(spoolDir, WORKFLOW_LINKS_DIR_NAME, `${sanitizeKey(workerConversationId)}.json`);
}

function resolveFileUriToPath(rawUri: string): string | undefined {
  const trimmed = rawUri.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.toLowerCase().startsWith("file://")) {
    try {
      return fileURLToPath(new URL(trimmed));
    } catch {
      return undefined;
    }
  }

  return trimmed;
}

function extractWorkerIdsFromText(text: string): string[] {
  const found = new Set<string>();

  for (const match of text.matchAll(WORKER_LOG_UUID_REGEX)) {
    if (match[1]) {
      found.add(match[1].toLowerCase());
    }
  }

  return Array.from(found);
}

function scanWorkflowLogForWorkerIds(taskLogPath: string | undefined): string[] {
  if (!taskLogPath || !fs.existsSync(taskLogPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(taskLogPath, "utf8");

    return extractWorkerIdsFromText(content);
  } catch {
    return [];
  }
}

function readWorkflowWatch(spoolDir: string, taskKey: string): WorkflowWatchRecord | null {
  const watchPath = getWorkflowWatchPath(spoolDir, taskKey);

  if (!fs.existsSync(watchPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(watchPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkflowWatchRecord>;

    if (
      typeof parsed.taskKey === "string" &&
      typeof parsed.taskId === "string" &&
      typeof parsed.parentConversationId === "string" &&
      typeof parsed.parentSessionId === "string" &&
      typeof parsed.parentTraceId === "string" &&
      typeof parsed.parentSpanId === "string" &&
      (parsed.status === "running" || parsed.status === "completed")
    ) {
      return {
        taskKey: parsed.taskKey,
        taskId: parsed.taskId,
        parentConversationId: parsed.parentConversationId,
        parentSessionId: parsed.parentSessionId,
        parentTraceId: parsed.parentTraceId,
        parentSpanId: parsed.parentSpanId,
        ...(typeof parsed.taskLogPath === "string" ? { taskLogPath: parsed.taskLogPath } : {}),
        ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
        status: parsed.status,
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
        ...(typeof parsed.completedAt === "string" ? { completedAt: parsed.completedAt } : {}),
      };
    }
  } catch {
    // Ignore unreadable workflow watch files
  }

  return null;
}

function writeWorkflowWatch(spoolDir: string, watch: WorkflowWatchRecord): void {
  const watchPath = getWorkflowWatchPath(spoolDir, watch.taskKey);

  atomicWriteJsonFile(watchPath, watch);
}

function listWorkflowWatches(spoolDir: string, nowMs = Date.now()): WorkflowWatchRecord[] {
  const dir = path.join(spoolDir, WORKFLOWS_DIR_NAME);

  if (!fs.existsSync(dir)) {
    return [];
  }

  const watches: WorkflowWatchRecord[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      try {
        const raw = fs.readFileSync(fullPath, "utf8");
        const parsed = JSON.parse(raw) as Partial<WorkflowWatchRecord>;

        if (
          typeof parsed.taskKey !== "string" ||
          typeof parsed.taskId !== "string" ||
          typeof parsed.parentConversationId !== "string" ||
          typeof parsed.parentSessionId !== "string" ||
          typeof parsed.parentTraceId !== "string" ||
          typeof parsed.parentSpanId !== "string" ||
          (parsed.status !== "running" && parsed.status !== "completed")
        ) {
          continue;
        }

        const refIso =
          parsed.status === "completed"
            ? (parsed.completedAt ?? parsed.updatedAt ?? parsed.createdAt)
            : (parsed.updatedAt ?? parsed.createdAt);
        const refMs = refIso ? Date.parse(refIso) : Number.NaN;
        const retentionMs =
          parsed.status === "completed" ? COMPLETED_WATCH_RETENTION_MS : RUNNING_WATCH_RETENTION_MS;

        if (Number.isFinite(refMs) && nowMs - refMs > retentionMs) {
          fs.rmSync(fullPath, { force: true });
          continue;
        }

        watches.push({
          taskKey: parsed.taskKey,
          taskId: parsed.taskId,
          parentConversationId: parsed.parentConversationId,
          parentSessionId: parsed.parentSessionId,
          parentTraceId: parsed.parentTraceId,
          parentSpanId: parsed.parentSpanId,
          ...(typeof parsed.taskLogPath === "string" ? { taskLogPath: parsed.taskLogPath } : {}),
          ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
          status: parsed.status,
          createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
          ...(typeof parsed.completedAt === "string" ? { completedAt: parsed.completedAt } : {}),
        });
      } catch {
        // Ignore unreadable watch entries
      }
    }
  } catch {
    return [];
  }

  return watches;
}

export function listActiveWorkflowWatches(
  spoolDir: string,
  nowMs = Date.now(),
): WorkflowWatchRecord[] {
  return listWorkflowWatches(spoolDir, nowMs).filter((w) => w.status === "running");
}

function readWorkflowLink(
  spoolDir: string,
  workerConversationId: string,
): WorkflowLinkRecord | null {
  const linkPath = getWorkflowLinkPath(spoolDir, workerConversationId);

  if (!fs.existsSync(linkPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(linkPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkflowLinkRecord>;

    if (
      typeof parsed.workerConversationId === "string" &&
      typeof parsed.parentConversationId === "string" &&
      typeof parsed.parentSessionId === "string" &&
      typeof parsed.taskId === "string"
    ) {
      return {
        workerConversationId: parsed.workerConversationId,
        parentConversationId: parsed.parentConversationId,
        parentSessionId: parsed.parentSessionId,
        ...(typeof parsed.parentTraceId === "string"
          ? { parentTraceId: parsed.parentTraceId }
          : {}),
        ...(typeof parsed.parentSpanId === "string" ? { parentSpanId: parsed.parentSpanId } : {}),
        taskId: parsed.taskId,
        ...(typeof parsed.taskLogPath === "string" ? { taskLogPath: parsed.taskLogPath } : {}),
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      };
    }
  } catch {
    // Ignore unreadable workflow link files
  }

  return null;
}

function writeWorkflowLink(spoolDir: string, link: WorkflowLinkRecord): void {
  const linkPath = getWorkflowLinkPath(spoolDir, link.workerConversationId);

  atomicWriteJsonFile(linkPath, link);
}

export function resolveWorkflowLink(
  spoolDir: string,
  workerConversationId: string,
): WorkflowLinkRecord | null {
  const existing = readWorkflowLink(spoolDir, workerConversationId);

  if (existing) {
    return existing;
  }

  const normalizedWorkerId = workerConversationId.trim().toLowerCase();
  const watches = listWorkflowWatches(spoolDir);

  for (const watch of watches) {
    const foundIds = scanWorkflowLogForWorkerIds(watch.taskLogPath);

    if (foundIds.includes(normalizedWorkerId)) {
      const created: WorkflowLinkRecord = {
        workerConversationId: normalizedWorkerId,
        parentConversationId: watch.parentConversationId,
        parentSessionId: watch.parentSessionId,
        parentTraceId: watch.parentTraceId,
        parentSpanId: watch.parentSpanId,
        taskId: watch.taskId,
        ...(watch.taskLogPath ? { taskLogPath: watch.taskLogPath } : {}),
        updatedAt: new Date().toISOString(),
      };

      writeWorkflowLink(spoolDir, created);

      return created;
    }
  }

  return null;
}

export function isLikelyWorkflowWorkerTranscript(
  rawTranscript: string,
  turns: ParsedTurnTrace[],
  activeWatches: WorkflowWatchRecord[],
): boolean {
  if (turns.length !== 1) {
    return false;
  }

  const turn = turns[0];

  if (turn.turnIndex !== 1 || Boolean(turn.metadata.userSettingsChange)) {
    return false;
  }

  if (
    FINISH_TOOL_STEP_REGEX.test(rawTranscript) ||
    FINISH_PROMPT_MARKER_REGEX.test(rawTranscript)
  ) {
    return true;
  }

  if (activeWatches.length === 0) {
    return false;
  }

  const turnStartMs = turn.startTime.getTime();

  return activeWatches.some((watch) => {
    const watchCreatedMs = Date.parse(watch.createdAt);

    return !Number.isFinite(watchCreatedMs) || turnStartMs >= watchCreatedMs - 5000;
  });
}

export interface WorkflowStepSyncContext {
  spoolDir: string;
  parentConversationId: string;
  parentSessionId: string;
  turns: ParsedTurnTrace[];
  turnTraceIds: Map<number, string>;
}

function findWorkflowSpanId(turn: ParsedTurnTrace, stepIndex: number): string {
  for (const child of turn.children) {
    if (
      child.type === "tool" &&
      child.rawToolName === "run_workflow" &&
      child.stepIndex === stepIndex
    ) {
      return child.toolCallId;
    }
  }

  return "";
}

export function syncWorkflowStateFromTranscriptSteps(
  steps: RawTranscriptStep[],
  context: WorkflowStepSyncContext,
): void {
  const nowIso = new Date().toISOString();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.type === "PLANNER_RESPONSE" && Array.isArray(step.tool_calls)) {
      const workflowCalls = step.tool_calls.filter((tc) => tc.name === "run_workflow");

      if (workflowCalls.length === 0) {
        continue;
      }

      let lookahead = i + 1;

      for (let callIdx = 0; callIdx < step.tool_calls.length; callIdx++) {
        const tc = step.tool_calls[callIdx];

        const genericStep =
          lookahead < steps.length && steps[lookahead].type === "GENERIC"
            ? steps[lookahead]
            : undefined;

        if (genericStep) {
          lookahead++;
        }

        if (tc.name !== "run_workflow" || !genericStep?.content) {
          continue;
        }

        const taskMatch = genericStep.content.match(TASK_ID_REGEX);
        const logMatch = genericStep.content.match(TASK_LOG_URI_REGEX);
        const taskId = taskMatch?.[1]?.toLowerCase() ?? `task-step-${genericStep.step_index}`;
        const taskKey = taskId.includes("/") ? taskId : `${context.parentConversationId}/${taskId}`;
        const taskLogPath = logMatch?.[1] ? resolveFileUriToPath(logMatch[1]) : undefined;
        const matchingTurn = context.turns.find(
          (t) => step.step_index >= t.startStepIndex && step.step_index <= t.endStepIndex,
        );
        const parentTraceId =
          (matchingTurn ? context.turnTraceIds.get(matchingTurn.turnIndex) : undefined) ?? "";
        const parentSpanId = matchingTurn
          ? findWorkflowSpanId(matchingTurn, genericStep.step_index)
          : "";
        const isRunning = genericStep.status === "RUNNING";
        const workerIds = new Set<string>([
          ...extractWorkerIdsFromText(genericStep.content),
          ...scanWorkflowLogForWorkerIds(taskLogPath),
        ]);

        for (const workerId of workerIds) {
          writeWorkflowLink(context.spoolDir, {
            workerConversationId: workerId,
            parentConversationId: context.parentConversationId,
            parentSessionId: context.parentSessionId,
            ...(parentTraceId ? { parentTraceId } : {}),
            ...(parentSpanId ? { parentSpanId } : {}),
            taskId: taskKey,
            ...(taskLogPath ? { taskLogPath } : {}),
            updatedAt: nowIso,
          });
        }

        const existingWatch = readWorkflowWatch(context.spoolDir, taskKey);

        writeWorkflowWatch(context.spoolDir, {
          taskKey,
          taskId: taskKey,
          parentConversationId: context.parentConversationId,
          parentSessionId: context.parentSessionId,
          parentTraceId: existingWatch?.parentTraceId || parentTraceId,
          parentSpanId: existingWatch?.parentSpanId || parentSpanId,
          ...(taskLogPath
            ? { taskLogPath }
            : existingWatch?.taskLogPath
              ? { taskLogPath: existingWatch.taskLogPath }
              : {}),
          status: isRunning ? "running" : "completed",
          createdAt: existingWatch?.createdAt || step.created_at || nowIso,
          updatedAt: nowIso,
          ...(!isRunning ? { completedAt: nowIso } : {}),
        });
      }
    }

    if (step.type === "SYSTEM_MESSAGE" && step.content) {
      const senderMatch = step.content.match(SYSTEM_SENDER_TASK_REGEX);

      if (!senderMatch?.[1]) {
        continue;
      }

      const taskKey = senderMatch[1].toLowerCase();
      const logMatch = step.content.match(TASK_LOG_URI_REGEX);
      const existingWatch = readWorkflowWatch(context.spoolDir, taskKey);
      const taskLogPath =
        (logMatch?.[1] ? resolveFileUriToPath(logMatch[1]) : undefined) ??
        existingWatch?.taskLogPath;
      const workerIds = new Set<string>([
        ...extractWorkerIdsFromText(step.content),
        ...scanWorkflowLogForWorkerIds(taskLogPath),
      ]);

      for (const workerId of workerIds) {
        writeWorkflowLink(context.spoolDir, {
          workerConversationId: workerId,
          parentConversationId: existingWatch?.parentConversationId ?? context.parentConversationId,
          parentSessionId: existingWatch?.parentSessionId ?? context.parentSessionId,
          ...(existingWatch?.parentTraceId ? { parentTraceId: existingWatch.parentTraceId } : {}),
          ...(existingWatch?.parentSpanId ? { parentSpanId: existingWatch.parentSpanId } : {}),
          taskId: taskKey,
          ...(taskLogPath ? { taskLogPath } : {}),
          updatedAt: nowIso,
        });
      }

      if (existingWatch) {
        writeWorkflowWatch(context.spoolDir, {
          ...existingWatch,
          ...(taskLogPath ? { taskLogPath } : {}),
          status: "completed",
          updatedAt: nowIso,
          completedAt: nowIso,
        });
      }
    }
  }
}

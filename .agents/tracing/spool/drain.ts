import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_TIMEOUT_MS,
  flushAndShutdown,
  resetTracingProvider,
  startTracingSession,
  type TracingSession,
} from "../instrumentation.ts";
import { createTurnTraceId, emitLinkedSubagentTurn, emitRootObservation } from "../observations.ts";
import { emitHookWarning, hasLangfuseCredentials, resolveDryRunFlag } from "../runtime.ts";
import { discoverAvailableSkills, resolveDefaultSkillDirs } from "../skills.ts";
import { computeContextAnchor } from "../versioning.ts";
import { advanceCursorForTurns } from "./cursor.ts";
import { readSubagentLink, writeSubagentLink } from "./links.ts";
import { acquireSpoolLock, releaseSpoolLock, type SpoolLockHandle } from "./locks.ts";
import { getSpoolFilePath, listSpoolFiles, readSpoolEntry, removeSpoolFile } from "./store.ts";
import { listActiveWorkflowWatches, resolveWorkflowLink } from "./workflows.ts";

import type {
  ContextAnchor,
  DrainSpoolOptions,
  DrainSpoolResult,
  PendingExportSpool,
  SubagentLinkRecord,
  WorkflowLinkRecord,
} from "../types.ts";

const MIN_DRAIN_BUDGET_MS = 500;
const DEFAULT_ORPHAN_PARENT_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_WORKFLOW_MATCH_GRACE_MS = 2 * 60 * 1000;

interface ResolvedDrainItem {
  filePath: string;
  entry: PendingExportSpool;
  anchor: ContextAnchor;
  lockKey: string;
}

type DrainReadiness =
  | "linked"
  | "workflow-linked"
  | "root"
  | "orphan-parent-session"
  | "wait-pending-parent"
  | "wait-active-parent"
  | "wait-workflow";

function isParentTranscriptRecentlyActive(
  spoolDir: string,
  parentConversationId: string,
  graceMs: number,
  nowMs: number,
): boolean {
  const brainDir = path.dirname(spoolDir);
  const logsDir = path.join(brainDir, parentConversationId, ".system_generated", "logs");

  for (const filename of ["transcript_full.jsonl", "transcript.jsonl"]) {
    const candidate = path.join(logsDir, filename);

    try {
      if (fs.existsSync(candidate)) {
        const stat = fs.statSync(candidate);

        if (nowMs - stat.mtimeMs < graceMs) {
          return true;
        }
      }
    } catch {
      // Ignore stat errors on parent transcript
    }
  }

  return false;
}

function resolveRootParentSessionId(
  spoolDir: string,
  parentConversationId: string,
  resolveLink: (conversationId: string) => SubagentLinkRecord | null,
): string {
  const subLink = resolveLink(parentConversationId);

  if (subLink?.parentSessionId) {
    return subLink.parentSessionId;
  }

  const wfLink = resolveWorkflowLink(spoolDir, parentConversationId);

  if (wfLink?.parentSessionId) {
    return wfLink.parentSessionId;
  }

  return parentConversationId;
}

function classifyDrainReadiness(
  item: ResolvedDrainItem,
  spoolDir: string,
  resolveLink: (conversationId: string) => SubagentLinkRecord | null,
  resolveWorkflow: (conversationId: string) => WorkflowLinkRecord | null,
  pendingConversationIds: Set<string>,
  hasActiveWorkflows: boolean,
  orphanGraceMs: number,
  workflowGraceMs: number,
  nowMs: number,
): DrainReadiness {
  const convId = item.entry.conversationId;

  if (convId && resolveLink(convId)) {
    return "linked";
  }

  if (convId && resolveWorkflow(convId)) {
    return "workflow-linked";
  }

  const updatedMs = Date.parse(item.entry.updatedAt);

  if (item.entry.awaitingWorkflowMatch) {
    const ageMs = Number.isFinite(updatedMs) ? nowMs - updatedMs : workflowGraceMs;

    if (hasActiveWorkflows || ageMs < workflowGraceMs) {
      return "wait-workflow";
    }

    return "root";
  }

  const parentId = item.entry.parentConversationId?.toLowerCase();

  if (!parentId) {
    return "root";
  }

  if (pendingConversationIds.has(parentId)) {
    return "wait-pending-parent";
  }

  const ageMs = Number.isFinite(updatedMs) ? nowMs - updatedMs : orphanGraceMs;

  if (
    ageMs < orphanGraceMs ||
    isParentTranscriptRecentlyActive(spoolDir, parentId, orphanGraceMs, nowMs)
  ) {
    return "wait-active-parent";
  }

  return "orphan-parent-session";
}

/**
 * Inspects the cross-session spool directory (`<appDataDir>/brain/.langfuse-spool/`)
 * and flushes any backlogged session files while preserving each session's
 * historical `startTime`/`endTime`, deterministic `traceId`, and `contextAnchor`.
 */
export async function drainSpoolDirectory(options: DrainSpoolOptions): Promise<DrainSpoolResult> {
  const dryRun = resolveDryRunFlag(options.dryRun);
  const shouldPersistState = !dryRun || options.persistCursorInDryRun === true;
  const candidateFiles = listSpoolFiles(options.spoolDir);

  if (candidateFiles.length === 0) {
    return {
      drainedFiles: 0,
      drainedTurns: 0,
      failedFiles: 0,
      dryRun,
      spoolDir: options.spoolDir,
    };
  }

  const excludedPaths = new Set(
    (options.excludeConversationIds ?? []).map((id) => getSpoolFilePath(options.spoolDir, id)),
  );
  const excludedIds = new Set(options.excludeConversationIds ?? []);

  const anchorCache = new Map<string, ContextAnchor>();

  const getAnchorForWorkspace = (rootDir: string): ContextAnchor => {
    const resolvedRoot = path.resolve(rootDir);
    const cached = anchorCache.get(resolvedRoot);

    if (cached) {
      return cached;
    }

    const computed = computeContextAnchor(resolvedRoot);

    anchorCache.set(resolvedRoot, computed);

    return computed;
  };

  const itemsToDrain: ResolvedDrainItem[] = [];
  const acquiredLocks = new Map<string, SpoolLockHandle>();
  let failedFiles = 0;

  try {
    for (const filePath of candidateFiles) {
      if (excludedPaths.has(path.resolve(filePath))) {
        continue;
      }

      const fileBaseKey = path.basename(filePath, ".json");

      if (excludedIds.has(fileBaseKey)) {
        continue;
      }

      const lockKey = `conv-${fileBaseKey}`;
      const lockHandle = acquireSpoolLock(options.spoolDir, lockKey);

      if (!lockHandle) {
        // Another process is actively exporting or mutating this conversation's spool file
        continue;
      }

      const entry = readSpoolEntry(filePath);

      if (!entry) {
        releaseSpoolLock(lockHandle);

        if (fs.existsSync(filePath)) {
          failedFiles += 1;
          emitHookWarning(options.onWarning, `Skipping unreadable spool file: ${filePath}`);
        }

        continue;
      }

      if (entry.conversationId && excludedIds.has(entry.conversationId)) {
        releaseSpoolLock(lockHandle);
        continue;
      }

      if (entry.pendingTurns.length === 0) {
        if (shouldPersistState) {
          removeSpoolFile(filePath);
        }

        releaseSpoolLock(lockHandle);
        continue;
      }

      acquiredLocks.set(filePath, lockHandle);

      const anchor =
        entry.contextAnchor ?? getAnchorForWorkspace(entry.workspaceRoot ?? options.workspaceRoot);

      itemsToDrain.push({ filePath, entry, anchor, lockKey });
    }

    if (itemsToDrain.length === 0) {
      return {
        drainedFiles: 0,
        drainedTurns: 0,
        failedFiles,
        dryRun,
        spoolDir: options.spoolDir,
      };
    }

    if (
      !dryRun &&
      !options.spanExporter &&
      !hasLangfuseCredentials() &&
      !options.simulateFlushFailure
    ) {
      emitHookWarning(
        options.onWarning,
        `Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY; leaving ${itemsToDrain.length} spooled file(s) in ${options.spoolDir}`,
      );

      return {
        drainedFiles: 0,
        drainedTurns: 0,
        failedFiles: failedFiles + itemsToDrain.length,
        dryRun,
        spoolDir: options.spoolDir,
      };
    }

    const skillDirs = options.skillDirs ?? resolveDefaultSkillDirs(options.workspaceRoot);
    const availableSkills = await discoverAvailableSkills(skillDirs);
    const totalBudgetMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const orphanGraceMs = options.orphanGraceMs ?? DEFAULT_ORPHAN_PARENT_GRACE_MS;
    const workflowGraceMs = options.workflowGraceMs ?? DEFAULT_WORKFLOW_MATCH_GRACE_MS;
    const startedAt = Date.now();

    let drainedFiles = 0;
    let drainedTurns = 0;

    let pendingItems = [...itemsToDrain];
    const pendingConversationIds = new Set(
      pendingItems
        .map((item) => item.entry.conversationId?.toLowerCase())
        .filter((id): id is string => Boolean(id)),
    );
    const ephemeralLinks = new Map<string, SubagentLinkRecord>();
    const workflowLinkCache = new Map<string, WorkflowLinkRecord>();

    const resolveLink = (conversationId: string): SubagentLinkRecord | null => {
      const key = conversationId.toLowerCase();

      return ephemeralLinks.get(key) ?? readSubagentLink(options.spoolDir, key);
    };

    const resolveWorkflow = (conversationId: string): WorkflowLinkRecord | null => {
      const key = conversationId.toLowerCase();
      const cached = workflowLinkCache.get(key);

      if (cached) {
        return cached;
      }

      const resolved = resolveWorkflowLink(options.spoolDir, key);

      if (resolved) {
        workflowLinkCache.set(key, resolved);
      }

      return resolved;
    };

    while (pendingItems.length > 0) {
      const nowMs = Date.now();
      const hasActiveWorkflows = listActiveWorkflowWatches(options.spoolDir, nowMs).length > 0;
      const readyItems: Array<{ item: ResolvedDrainItem; readiness: DrainReadiness }> = [];
      const deferredItems: ResolvedDrainItem[] = [];

      for (const item of pendingItems) {
        const readiness = classifyDrainReadiness(
          item,
          options.spoolDir,
          resolveLink,
          resolveWorkflow,
          pendingConversationIds,
          hasActiveWorkflows,
          orphanGraceMs,
          workflowGraceMs,
          nowMs,
        );

        if (
          readiness === "linked" ||
          readiness === "workflow-linked" ||
          readiness === "root" ||
          readiness === "orphan-parent-session"
        ) {
          readyItems.push({ item, readiness });
        } else {
          deferredItems.push(item);
        }
      }

      if (readyItems.length === 0) {
        break;
      }

      const groupsByRelease = new Map<
        string,
        Array<{ item: ResolvedDrainItem; readiness: DrainReadiness }>
      >();

      for (const ready of readyItems) {
        const existing = groupsByRelease.get(ready.item.anchor.release);

        if (existing) {
          existing.push(ready);
        } else {
          groupsByRelease.set(ready.item.anchor.release, [ready]);
        }
      }

      let waveProgressed = false;
      let waveAbortedOnFailure = false;

      for (const [release, group] of groupsByRelease.entries()) {
        const elapsedMs = Date.now() - startedAt;
        const remainingMs = totalBudgetMs - elapsedMs;

        if (remainingMs < MIN_DRAIN_BUDGET_MS && drainedFiles > 0) {
          failedFiles += group.length;
          waveAbortedOnFailure = true;
          continue;
        }

        const effectiveTimeoutMs = Math.max(MIN_DRAIN_BUDGET_MS, remainingMs);
        let session: TracingSession | undefined;
        const groupCreatedLinks: SubagentLinkRecord[] = [];
        const groupEphemeralKeys: string[] = [];

        try {
          session = startTracingSession({
            release,
            dryRun,
            spanExporter: options.spanExporter,
            availableSkills,
          });

          for (const { item, readiness } of group) {
            const convId = item.entry.conversationId;
            const itemLink = convId ? resolveLink(convId) : null;
            const workflowLink =
              !itemLink && readiness === "workflow-linked" && convId
                ? resolveWorkflow(convId)
                : null;
            const orphanParentId =
              !itemLink && !workflowLink && readiness === "orphan-parent-session"
                ? item.entry.parentConversationId
                : undefined;
            const orphanSessionId = orphanParentId
              ? resolveRootParentSessionId(options.spoolDir, orphanParentId, resolveLink)
              : undefined;

            for (const turn of item.entry.pendingTurns) {
              const links = itemLink
                ? await emitLinkedSubagentTurn(turn, item.anchor, itemLink)
                : await emitRootObservation(turn, item.anchor, await createTurnTraceId(turn), {
                    ...(workflowLink ? { workflowLink } : {}),
                    ...(orphanSessionId ? { sessionIdOverride: orphanSessionId } : {}),
                    ...(orphanParentId ? { orphanParentConversationId: orphanParentId } : {}),
                  });

              for (const link of links) {
                const linkKey = link.subagentConversationId.toLowerCase();

                groupCreatedLinks.push(link);
                ephemeralLinks.set(linkKey, link);
                groupEphemeralKeys.push(linkKey);
              }
            }
          }

          if (options.simulateFlushFailure) {
            throw options.simulateFlushFailure;
          }

          await flushAndShutdown(session, effectiveTimeoutMs);

          if (shouldPersistState) {
            for (const link of groupCreatedLinks) {
              writeSubagentLink(options.spoolDir, link);
            }

            for (const { item } of group) {
              if (item.entry.cursorPath) {
                advanceCursorForTurns(item.entry.cursorPath, item.entry.pendingTurns);
              }

              removeSpoolFile(item.filePath);
            }
          }

          const drainedFileSet = new Set(group.map(({ item }) => item.filePath));

          for (const { item } of group) {
            if (item.entry.conversationId) {
              pendingConversationIds.delete(item.entry.conversationId.toLowerCase());
            }

            const lock = acquiredLocks.get(item.filePath);

            if (lock) {
              releaseSpoolLock(lock);
              acquiredLocks.delete(item.filePath);
            }
          }

          pendingItems = pendingItems.filter((item) => !drainedFileSet.has(item.filePath));
          drainedFiles += group.length;
          waveProgressed = true;

          for (const { item } of group) {
            drainedTurns += item.entry.pendingTurns.length;
          }
        } catch (err: unknown) {
          for (const key of groupEphemeralKeys) {
            ephemeralLinks.delete(key);
          }

          const message = err instanceof Error ? err.message : String(err);

          emitHookWarning(
            options.onWarning,
            `Failed to drain ${group.length} spooled file(s) from ${options.spoolDir}: ${message}`,
          );

          failedFiles += group.length;
          waveAbortedOnFailure = true;

          try {
            await session?.sdk.shutdown();
          } catch {
            // Ignore shutdown error during fail-open
          }

          break;
        } finally {
          resetTracingProvider();
        }
      }

      if (waveAbortedOnFailure || !waveProgressed || deferredItems.length === 0) {
        break;
      }
    }

    return {
      drainedFiles,
      drainedTurns,
      failedFiles,
      dryRun,
      spoolDir: options.spoolDir,
    };
  } finally {
    for (const lock of acquiredLocks.values()) {
      releaseSpoolLock(lock);
    }

    acquiredLocks.clear();
  }
}

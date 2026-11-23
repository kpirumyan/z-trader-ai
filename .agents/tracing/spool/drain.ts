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
import { getSpoolFilePath, listSpoolFiles, readSpoolEntry, removeSpoolFile } from "./store.ts";

import type {
  ContextAnchor,
  DrainSpoolOptions,
  DrainSpoolResult,
  PendingExportSpool,
  SubagentLinkRecord,
} from "../types.ts";

const MIN_DRAIN_BUDGET_MS = 500;
const DEFAULT_ORPHAN_PARENT_GRACE_MS = 5 * 60 * 1000;

interface ResolvedDrainItem {
  filePath: string;
  entry: PendingExportSpool;
  anchor: ContextAnchor;
}

type DrainReadiness = "linked" | "root" | "wait-pending-parent" | "wait-active-parent";

function classifyDrainReadiness(
  item: ResolvedDrainItem,
  resolveLink: (conversationId: string) => SubagentLinkRecord | null,
  pendingConversationIds: Set<string>,
  orphanGraceMs: number,
  nowMs: number,
): DrainReadiness {
  const convId = item.entry.conversationId;

  if (convId && resolveLink(convId)) {
    return "linked";
  }

  const parentId = item.entry.parentConversationId?.toLowerCase();

  if (!parentId) {
    return "root";
  }

  if (pendingConversationIds.has(parentId)) {
    return "wait-pending-parent";
  }

  const updatedMs = Date.parse(item.entry.updatedAt);
  const ageMs = Number.isFinite(updatedMs) ? nowMs - updatedMs : orphanGraceMs;

  if (ageMs < orphanGraceMs) {
    return "wait-active-parent";
  }

  return "root";
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
  let failedFiles = 0;

  for (const filePath of candidateFiles) {
    if (excludedPaths.has(path.resolve(filePath))) {
      continue;
    }

    const entry = readSpoolEntry(filePath);

    if (!entry) {
      failedFiles += 1;
      emitHookWarning(options.onWarning, `Skipping unreadable spool file: ${filePath}`);
      continue;
    }

    if (entry.conversationId && excludedIds.has(entry.conversationId)) {
      continue;
    }

    if (entry.pendingTurns.length === 0) {
      if (shouldPersistState) {
        removeSpoolFile(filePath);
      }

      continue;
    }

    const anchor =
      entry.contextAnchor ?? getAnchorForWorkspace(entry.workspaceRoot ?? options.workspaceRoot);

    itemsToDrain.push({ filePath, entry, anchor });
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

  const resolveLink = (conversationId: string): SubagentLinkRecord | null => {
    const key = conversationId.toLowerCase();

    return ephemeralLinks.get(key) ?? readSubagentLink(options.spoolDir, key);
  };

  while (pendingItems.length > 0) {
    const nowMs = Date.now();
    const readyItems: ResolvedDrainItem[] = [];
    const deferredItems: ResolvedDrainItem[] = [];

    for (const item of pendingItems) {
      const readiness = classifyDrainReadiness(
        item,
        resolveLink,
        pendingConversationIds,
        orphanGraceMs,
        nowMs,
      );

      if (readiness === "linked" || readiness === "root") {
        readyItems.push(item);
      } else {
        deferredItems.push(item);
      }
    }

    if (readyItems.length === 0) {
      break;
    }

    const groupsByRelease = new Map<string, ResolvedDrainItem[]>();

    for (const item of readyItems) {
      const existing = groupsByRelease.get(item.anchor.release);

      if (existing) {
        existing.push(item);
      } else {
        groupsByRelease.set(item.anchor.release, [item]);
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

        for (const item of group) {
          const itemLink = item.entry.conversationId
            ? resolveLink(item.entry.conversationId)
            : null;

          for (const turn of item.entry.pendingTurns) {
            const links = itemLink
              ? await emitLinkedSubagentTurn(turn, item.anchor, itemLink)
              : await emitRootObservation(turn, item.anchor, await createTurnTraceId(turn));

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

          for (const item of group) {
            if (item.entry.cursorPath) {
              advanceCursorForTurns(item.entry.cursorPath, item.entry.pendingTurns);
            }

            removeSpoolFile(item.filePath);
          }
        }

        const drainedFileSet = new Set(group.map((item) => item.filePath));

        for (const item of group) {
          if (item.entry.conversationId) {
            pendingConversationIds.delete(item.entry.conversationId.toLowerCase());
          }
        }

        pendingItems = pendingItems.filter((item) => !drainedFileSet.has(item.filePath));
        drainedFiles += group.length;
        waveProgressed = true;

        for (const item of group) {
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
}

import path from "node:path";

import {
  DEFAULT_TIMEOUT_MS,
  flushAndShutdown,
  resetTracingProvider,
  startTracingSession,
  type TracingSession,
} from "../instrumentation.ts";
import { createTurnTraceId, emitRootObservation } from "../observations.ts";
import { emitHookWarning, hasLangfuseCredentials, resolveDryRunFlag } from "../runtime.ts";
import { discoverAvailableSkills, resolveDefaultSkillDirs } from "../skills.ts";
import { computeContextAnchor } from "../versioning.ts";
import { advanceCursorForTurns } from "./cursor.ts";
import { getSpoolFilePath, listSpoolFiles, readSpoolEntry, removeSpoolFile } from "./store.ts";

import type {
  ContextAnchor,
  DrainSpoolOptions,
  DrainSpoolResult,
  PendingExportSpool,
} from "../types.ts";

const MIN_DRAIN_BUDGET_MS = 500;

interface ResolvedDrainItem {
  filePath: string;
  entry: PendingExportSpool;
  anchor: ContextAnchor;
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

  const groupsByRelease = new Map<string, ResolvedDrainItem[]>();

  for (const item of itemsToDrain) {
    const existing = groupsByRelease.get(item.anchor.release);

    if (existing) {
      existing.push(item);
    } else {
      groupsByRelease.set(item.anchor.release, [item]);
    }
  }

  const skillDirs = options.skillDirs ?? resolveDefaultSkillDirs(options.workspaceRoot);
  const availableSkills = await discoverAvailableSkills(skillDirs);
  const totalBudgetMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  let drainedFiles = 0;
  let drainedTurns = 0;

  for (const [release, group] of groupsByRelease.entries()) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = totalBudgetMs - elapsedMs;

    if (remainingMs < MIN_DRAIN_BUDGET_MS && drainedFiles > 0) {
      failedFiles += group.length;
      continue;
    }

    const effectiveTimeoutMs = Math.max(MIN_DRAIN_BUDGET_MS, remainingMs);
    let session: TracingSession | undefined;

    try {
      session = startTracingSession({
        release,
        dryRun,
        spanExporter: options.spanExporter,
        availableSkills,
      });

      for (const item of group) {
        for (const turn of item.entry.pendingTurns) {
          const traceId = await createTurnTraceId(turn);

          await emitRootObservation(turn, item.anchor, traceId);
        }
      }

      if (options.simulateFlushFailure) {
        throw options.simulateFlushFailure;
      }

      await flushAndShutdown(session, effectiveTimeoutMs);

      if (shouldPersistState) {
        for (const item of group) {
          if (item.entry.cursorPath) {
            advanceCursorForTurns(item.entry.cursorPath, item.entry.pendingTurns);
          }

          removeSpoolFile(item.filePath);
        }
      }

      drainedFiles += group.length;

      for (const item of group) {
        drainedTurns += item.entry.pendingTurns.length;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      emitHookWarning(
        options.onWarning,
        `Failed to drain ${group.length} spooled file(s) from ${options.spoolDir}: ${message}`,
      );

      failedFiles += group.length;

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

  return {
    drainedFiles,
    drainedTurns,
    failedFiles,
    dryRun,
    spoolDir: options.spoolDir,
  };
}

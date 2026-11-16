import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_TIMEOUT_MS,
  flushAndShutdown,
  resetTracingProvider,
  startTracingSession,
  type TracingSession,
} from "./instrumentation.ts";
import { createTurnTraceId, emitRootObservation } from "./observations.ts";
import {
  createFilesystemSubagentResolver,
  parseTranscriptTurns,
  resolveFullTranscriptPath,
} from "./parser/index.ts";
import {
  emitHookWarning,
  hasLangfuseCredentials,
  maybeLoadEnvLocal,
  resolveDryRunFlag,
} from "./runtime.ts";
import { discoverAvailableSkills, resolveDefaultSkillDirs } from "./skills.ts";
import {
  advanceCursorForTurns,
  drainSpoolDirectory,
  getSpoolFilePath,
  mergeTurnsForExport,
  readCursorState,
  readPendingSpool,
  removeSpoolFile,
  resolveSpoolDir,
  writePendingSpool,
} from "./spool/index.ts";
import { computeContextAnchor } from "./versioning.ts";

import type { RunStopHookOptions, RunStopHookResult, StopHookInput } from "./types.ts";

const MIN_REMAINING_BUDGET_MS = 500;

/**
 * Executes the Antigravity Stop hook workflow:
 * 1. Resolves `transcript_full.jsonl` and loads cursor + per-conversation spool state.
 * 2. Parses unexported turns into the Langfuse v6 observation hierarchy.
 * 3. Persists unexported turns write-ahead into `<appDataDir>/brain/.langfuse-spool/<conversationId>.json`.
 * 4. Emits OpenTelemetry spans via `NodeSDK` + `LangfuseSpanProcessor`.
 * 5. On success, advances cursor, unlinks the spooled file, and drains any other backlogged session files.
 * 6. On failure or timeout, soft fails open keeping the spool file intact for automatic retry.
 */
export async function runStopHook(
  input: StopHookInput,
  options: RunStopHookOptions = {},
): Promise<RunStopHookResult> {
  const startedAt = Date.now();
  const workspaceRoot = input.cwd ?? input.workspacePaths?.[0] ?? process.cwd();

  maybeLoadEnvLocal(workspaceRoot);

  const contextAnchor = computeContextAnchor(workspaceRoot);
  const dryRun = resolveDryRunFlag(options.dryRun);
  const shouldPersistState = !dryRun || options.persistCursorInDryRun === true;
  const totalBudgetMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spoolDir = resolveSpoolDir({
    spoolDir: options.spoolDir,
    transcriptPath: input.transcriptPath,
    artifactDirectoryPath: input.artifactDirectoryPath,
  });

  const drainBacklogIfEnabled = async (
    excludeIds: string[],
  ): Promise<{ drainedFiles: number; drainedTurns: number }> => {
    if (options.drainBacklog === false) {
      return { drainedFiles: 0, drainedTurns: 0 };
    }

    const remainingMs = totalBudgetMs - (Date.now() - startedAt);

    if (remainingMs < MIN_REMAINING_BUDGET_MS) {
      return { drainedFiles: 0, drainedTurns: 0 };
    }

    const drainResult = await drainSpoolDirectory({
      spoolDir,
      workspaceRoot,
      excludeConversationIds: excludeIds,
      dryRun,
      persistCursorInDryRun: options.persistCursorInDryRun,
      timeoutMs: remainingMs,
      spanExporter: options.spanExporter,
      skillDirs: options.skillDirs,
      onWarning: options.onWarning,
    });

    return {
      drainedFiles: drainResult.drainedFiles,
      drainedTurns: drainResult.drainedTurns,
    };
  };

  const resolvedTranscriptPath = input.transcriptPath
    ? resolveFullTranscriptPath(input.transcriptPath)
    : undefined;

  if (!resolvedTranscriptPath || !fs.existsSync(resolvedTranscriptPath)) {
    const drained = await drainBacklogIfEnabled(input.conversationId ? [input.conversationId] : []);

    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: 0,
      drainedFiles: drained.drainedFiles,
      drainedTurns: drained.drainedTurns,
      spoolDir,
      release: contextAnchor.release,
      version: contextAnchor.version,
      dryRun,
      summary: [],
    };
  }

  const transcriptDir = path.dirname(resolvedTranscriptPath);
  const cursorPath = path.join(transcriptDir, ".langfuse-cursor.json");
  const legacySpoolPath = path.join(transcriptDir, ".pending-export.json");
  const conversationId =
    input.conversationId ?? path.basename(path.resolve(transcriptDir, "..", ".."));
  const spoolFilePath = getSpoolFilePath(spoolDir, conversationId);

  const cursor = readCursorState(cursorPath);
  const legacySpooledTurns = readPendingSpool(legacySpoolPath);
  const spooledTurns = readPendingSpool(spoolFilePath);

  const rawTranscript = fs.readFileSync(resolvedTranscriptPath, "utf8");

  const newlyParsedTurns = parseTranscriptTurns(rawTranscript, {
    conversationId,
    modelName: input.modelName,
    ...(typeof cursor?.lastExportedLineIndex === "number"
      ? { afterLineIndex: cursor.lastExportedLineIndex }
      : { afterStepIndex: cursor?.lastExportedStepIndex }),
    resolveSubagentTranscript: createFilesystemSubagentResolver(resolvedTranscriptPath),
  });

  const turnsToExport = mergeTurnsForExport(
    mergeTurnsForExport(legacySpooledTurns, spooledTurns),
    newlyParsedTurns,
  );

  if (turnsToExport.length === 0) {
    if (shouldPersistState) {
      removeSpoolFile(spoolFilePath);

      if (fs.existsSync(legacySpoolPath)) {
        fs.rmSync(legacySpoolPath, { force: true });
      }
    }

    const drained = await drainBacklogIfEnabled([conversationId]);

    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: 0,
      drainedFiles: drained.drainedFiles,
      drainedTurns: drained.drainedTurns,
      spoolDir,
      release: contextAnchor.release,
      version: contextAnchor.version,
      dryRun,
      summary: [],
    };
  }

  if (shouldPersistState) {
    try {
      writePendingSpool(spoolFilePath, turnsToExport, {
        conversationId,
        workspaceRoot,
        cursorPath,
        contextAnchor,
      });

      if (fs.existsSync(legacySpoolPath)) {
        fs.rmSync(legacySpoolPath, { force: true });
      }
    } catch {
      // Ignore write-ahead failure here; catch block will retry spool write if export fails
    }
  }

  const skillDirs = options.skillDirs ?? resolveDefaultSkillDirs(workspaceRoot);
  const availableSkills = await discoverAvailableSkills(skillDirs);

  const summary: RunStopHookResult["summary"] = [];
  let session: TracingSession | undefined;

  try {
    if (options.simulateFlushFailure) {
      throw options.simulateFlushFailure;
    }

    if (!dryRun && !options.spanExporter && !hasLangfuseCredentials()) {
      throw new Error(
        "Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY; turns spooled for later retry",
      );
    }

    session = startTracingSession({
      release: contextAnchor.release,
      dryRun,
      spanExporter: options.spanExporter,
      availableSkills,
    });

    for (const turn of turnsToExport) {
      const traceId = await createTurnTraceId(turn);

      summary.push({
        turnIndex: turn.turnIndex,
        traceId,
        childCount: turn.children.length,
        tags: turn.tags,
        totalTokens: turn.usageSummary.total,
      });

      await emitRootObservation(turn, contextAnchor, traceId);
    }

    const effectiveTimeoutMs = Math.max(
      MIN_REMAINING_BUDGET_MS,
      totalBudgetMs - (Date.now() - startedAt),
    );

    await flushAndShutdown(session, effectiveTimeoutMs);

    if (shouldPersistState) {
      advanceCursorForTurns(cursorPath, turnsToExport);
      removeSpoolFile(spoolFilePath);

      if (fs.existsSync(legacySpoolPath)) {
        fs.rmSync(legacySpoolPath, { force: true });
      }
    }

    resetTracingProvider();

    const drained = await drainBacklogIfEnabled([conversationId]);

    return {
      decision: "allow",
      exportedTurns: turnsToExport.length,
      spooledTurns: 0,
      drainedFiles: drained.drainedFiles,
      drainedTurns: drained.drainedTurns,
      spoolDir,
      release: contextAnchor.release,
      version: contextAnchor.version,
      dryRun,
      summary,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    emitHookWarning(
      options.onWarning,
      `Failed to export ${turnsToExport.length} turn(s) to Langfuse: ${message}`,
    );

    if (shouldPersistState) {
      try {
        writePendingSpool(spoolFilePath, turnsToExport, {
          conversationId,
          workspaceRoot,
          cursorPath,
          contextAnchor,
        });
      } catch {
        // Ignore secondary spool write failure
      }
    }

    try {
      await session?.sdk.shutdown();
    } catch {
      // Ignore shutdown error during fail-open
    }

    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: shouldPersistState ? turnsToExport.length : 0,
      drainedFiles: 0,
      drainedTurns: 0,
      spoolDir,
      release: contextAnchor.release,
      version: contextAnchor.version,
      dryRun,
      summary,
    };
  } finally {
    resetTracingProvider();
  }
}

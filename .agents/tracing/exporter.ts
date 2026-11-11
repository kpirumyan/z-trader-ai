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
  mergeTurnsForExport,
  readCursorState,
  readPendingSpool,
  writeCursorState,
  writePendingSpool,
} from "./spool.ts";
import { computeContextAnchor } from "./versioning.ts";

import type { RunStopHookOptions, RunStopHookResult, StopHookInput } from "./types.ts";

function maybeLoadEnvLocal(workspaceRoot: string): void {
  if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    return;
  }

  const envLocalPath = path.join(workspaceRoot, ".env.local");

  if (!fs.existsSync(envLocalPath)) {
    return;
  }

  try {
    if (typeof process.loadEnvFile === "function") {
      process.loadEnvFile(envLocalPath);
    }
  } catch {
    // Ignore env loading errors
  }
}

/**
 * Executes the Antigravity Stop hook workflow:
 * 1. Resolves `transcript_full.jsonl` and loads cursor + pending spool state.
 * 2. Parses unexported turns into the Langfuse v6 observation hierarchy.
 * 3. Emits OpenTelemetry spans via `NodeSDK` + `LangfuseSpanProcessor`.
 * 4. Soft fails open with a 5s budget, saving unexported turns to `.pending-export.json` on failure.
 */
export async function runStopHook(
  input: StopHookInput,
  options: RunStopHookOptions = {},
): Promise<RunStopHookResult> {
  const workspaceRoot = input.cwd ?? input.workspacePaths?.[0] ?? process.cwd();

  maybeLoadEnvLocal(workspaceRoot);

  const contextAnchor = computeContextAnchor(workspaceRoot);
  const hasCredentials = Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
  );
  const dryRun =
    options.dryRun ??
    (process.env.LANGFUSE_DRY_RUN === "1" || (!options.spanExporter && !hasCredentials));

  if (!input.transcriptPath) {
    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: 0,
      version: contextAnchor.version,
      dryRun,
      summary: [],
    };
  }

  const resolvedTranscriptPath = resolveFullTranscriptPath(input.transcriptPath);

  if (!fs.existsSync(resolvedTranscriptPath)) {
    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: 0,
      version: contextAnchor.version,
      dryRun,
      summary: [],
    };
  }

  const transcriptDir = path.dirname(resolvedTranscriptPath);
  const cursorPath = path.join(transcriptDir, ".langfuse-cursor.json");
  const spoolPath = path.join(transcriptDir, ".pending-export.json");

  const cursor = readCursorState(cursorPath);
  const spooledTurns = readPendingSpool(spoolPath);

  const rawTranscript = fs.readFileSync(resolvedTranscriptPath, "utf8");
  const conversationId =
    input.conversationId ?? path.basename(path.resolve(transcriptDir, "..", ".."));

  const newlyParsedTurns = parseTranscriptTurns(rawTranscript, {
    conversationId,
    modelName: input.modelName,
    afterStepIndex: cursor?.lastExportedStepIndex,
    resolveSubagentTranscript: createFilesystemSubagentResolver(resolvedTranscriptPath),
  });

  const turnsToExport = mergeTurnsForExport(spooledTurns, newlyParsedTurns);

  if (turnsToExport.length === 0) {
    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: 0,
      version: contextAnchor.version,
      dryRun,
      summary: [],
    };
  }

  const summary: RunStopHookResult["summary"] = [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let session: TracingSession | undefined;

  try {
    session = startTracingSession({
      release: contextAnchor.version,
      dryRun,
      spanExporter: options.spanExporter,
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

    if (options.simulateFlushFailure) {
      throw options.simulateFlushFailure;
    }

    await flushAndShutdown(session, timeoutMs);

    const shouldPersistState = !dryRun || options.persistCursorInDryRun === true;

    if (shouldPersistState) {
      const lastTurn = turnsToExport[turnsToExport.length - 1]!;

      writeCursorState(cursorPath, {
        lastExportedStepIndex: Math.max(cursor?.lastExportedStepIndex ?? -1, lastTurn.endStepIndex),
        lastExportedTurnIndex: Math.max(cursor?.lastExportedTurnIndex ?? -1, lastTurn.turnIndex),
        updatedAt: new Date().toISOString(),
      });

      if (fs.existsSync(spoolPath)) {
        fs.rmSync(spoolPath, { force: true });
      }
    }

    return {
      decision: "allow",
      exportedTurns: turnsToExport.length,
      spooledTurns: 0,
      version: contextAnchor.version,
      dryRun,
      summary,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const warnFn =
      options.onWarning ??
      ((msg: string) => {
        process.stderr.write(`[langfuse-stop-hook] Warn: ${msg}\n`);
      });

    warnFn(`Failed to export ${turnsToExport.length} turn(s) to Langfuse: ${message}`);

    try {
      writePendingSpool(spoolPath, turnsToExport);
    } catch {
      // Ignore secondary spool write failure
    }

    try {
      await session?.sdk.shutdown();
    } catch {
      // Ignore shutdown error during fail-open
    }

    return {
      decision: "allow",
      exportedTurns: 0,
      spooledTurns: turnsToExport.length,
      version: contextAnchor.version,
      dryRun,
      summary,
    };
  } finally {
    resetTracingProvider();
  }
}

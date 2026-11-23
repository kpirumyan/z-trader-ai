import { maybeLoadEnvLocal } from "./runtime.ts";
import { drainSpoolDirectory, resolveSpoolDir } from "./spool/index.ts";

import type {
  RunSessionStartHookOptions,
  RunSessionStartHookResult,
  SessionStartHookInput,
} from "./types.ts";

/**
 * Executes the Antigravity SessionStart hook workflow:
 * Performs an O(1) scan of `<appDataDir>/brain/.langfuse-spool/` and drains
 * any backlogged session spool files automatically on session bootstrap.
 */
export async function runSessionStartHook(
  input: SessionStartHookInput,
  options: RunSessionStartHookOptions = {},
): Promise<RunSessionStartHookResult> {
  const workspaceRoot = input.cwd ?? input.workspacePaths?.[0] ?? process.cwd();

  maybeLoadEnvLocal(workspaceRoot);

  const spoolDir = resolveSpoolDir({
    spoolDir: options.spoolDir,
    transcriptPath: input.transcriptPath,
    artifactDirectoryPath: input.artifactDirectoryPath,
  });

  const drainResult = await drainSpoolDirectory({
    spoolDir,
    workspaceRoot,
    dryRun: options.dryRun,
    persistCursorInDryRun: options.persistCursorInDryRun,
    timeoutMs: options.timeoutMs,
    spanExporter: options.spanExporter,
    skillDirs: options.skillDirs,
    orphanGraceMs: options.orphanGraceMs,
    simulateFlushFailure: options.simulateFlushFailure,
    onWarning: options.onWarning,
  });

  return {
    continue: true,
    ...drainResult,
  };
}

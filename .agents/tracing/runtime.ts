import fs from "node:fs";
import path from "node:path";

export function maybeLoadEnvLocal(workspaceRoot: string): void {
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

export function hasLangfuseCredentials(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

export function resolveDryRunFlag(explicitDryRun?: boolean): boolean {
  return explicitDryRun ?? process.env.LANGFUSE_DRY_RUN === "1";
}

export function emitHookWarning(
  onWarning: ((message: string) => void) | undefined,
  message: string,
): void {
  if (onWarning) {
    onWarning(message);

    return;
  }

  process.stderr.write(`[langfuse-hook] Warn: ${message}\n`);
}

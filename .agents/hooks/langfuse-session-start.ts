import fs from "node:fs";
import { parseArgs } from "node:util";

import { runSessionStartHook, type SessionStartHookInput } from "../tracing/index.ts";

const HOOK_WALL_BUDGET_MS = 4000;

async function main(): Promise<void> {
  const startedAt = Date.now();

  try {
    const { values } = parseArgs({
      options: {
        "dry-run": { type: "boolean", default: false },
        transcript: { type: "string" },
        "conversation-id": { type: "string" },
        "spool-dir": { type: "string" },
      },
      strict: false,
    });

    const raw = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
    const data = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};

    const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

    const input: SessionStartHookInput = {
      conversationId: str(values["conversation-id"]) ?? str(data.conversationId ?? data.session_id),
      transcriptPath: str(values.transcript) ?? str(data.transcriptPath ?? data.transcript_path),
      artifactDirectoryPath: str(data.artifactDirectoryPath),
      modelName: str(data.modelName),
      cwd: str(data.cwd),
      workspacePaths: Array.isArray(data.workspacePaths)
        ? data.workspacePaths.filter((p): p is string => typeof p === "string")
        : undefined,
    };

    const remainingMs = Math.max(1000, HOOK_WALL_BUDGET_MS - (Date.now() - startedAt));

    const result = await runSessionStartHook(input, {
      dryRun: values["dry-run"] ? true : undefined,
      spoolDir: str(values["spool-dir"]),
      timeoutMs: remainingMs,
    });

    if (values["dry-run"]) {
      process.stderr.write(`[langfuse-session-start] ${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`[langfuse-session-start] ${message}\n`);
  }

  process.stdout.write(`${JSON.stringify({})}\n`);
}

void main();

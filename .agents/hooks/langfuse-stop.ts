import fs from "node:fs";
import { parseArgs } from "node:util";

import { runStopHook, type StopHookInput } from "../tracing/index.ts";

async function main(): Promise<void> {
  try {
    const { values } = parseArgs({
      options: {
        "dry-run": { type: "boolean", default: false },
        transcript: { type: "string" },
        "conversation-id": { type: "string" },
      },
      strict: false,
    });

    const raw = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
    const data = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};

    const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

    const input: StopHookInput = {
      conversationId: str(values["conversation-id"]) ?? str(data.conversationId ?? data.session_id),
      transcriptPath: str(values.transcript) ?? str(data.transcriptPath ?? data.transcript_path),
      modelName: str(data.modelName),
      cwd: str(data.cwd),
      workspacePaths: Array.isArray(data.workspacePaths)
        ? data.workspacePaths.filter((p): p is string => typeof p === "string")
        : undefined,
    };

    const result = await runStopHook(input, {
      dryRun: values["dry-run"] ? true : undefined,
    });

    if (values["dry-run"]) {
      process.stderr.write(`[langfuse-stop] ${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`[langfuse-stop] ${message}\n`);
  }

  process.stdout.write(`${JSON.stringify({ decision: "allow" })}\n`);
}

void main();

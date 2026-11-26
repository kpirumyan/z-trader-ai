import fs from "node:fs";
import path from "node:path";

import { flushAutoFixDiagnostics, runAutoFixHook, type PostToolUseInput } from "./core.ts";

function main(): void {
  try {
    const raw = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
    const parsed = raw.trim() ? (JSON.parse(raw) as PostToolUseInput) : {};
    const fallbackRoot = path.resolve(import.meta.dirname, "../../..");
    const isFlush = process.argv.includes("--flush") || parsed.hookEventName === "PostInvocation";

    if (isFlush) {
      const output = flushAutoFixDiagnostics(parsed, fallbackRoot);

      process.stdout.write(`${JSON.stringify(output)}\n`);

      return;
    }

    const result = runAutoFixHook(parsed, fallbackRoot);

    if (result.diagnostics.length > 0) {
      for (const diag of result.diagnostics) {
        process.stderr.write(`[auto-fix:${diag.tool}] ${diag.message}\n`);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`[auto-fix] ${message}\n`);
  }

  process.stdout.write(`${JSON.stringify({})}\n`);
}

main();

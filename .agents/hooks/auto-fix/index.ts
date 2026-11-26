import fs from "node:fs";
import path from "node:path";

import { runAutoFixHook, runPostInvocationHook, type PostToolUseInput } from "./core.ts";

function main(): void {
  const isPostInvocationFlag = process.argv.includes("--post-invocation");

  try {
    const raw = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
    const parsed = raw.trim() ? (JSON.parse(raw) as PostToolUseInput) : {};

    if (isPostInvocationFlag || parsed.hookEventName === "PostInvocation") {
      const output = runPostInvocationHook(parsed);

      process.stdout.write(`${JSON.stringify(output)}\n`);

      return;
    }

    const fallbackRoot = path.resolve(import.meta.dirname, "../../..");
    const result = runAutoFixHook(parsed, fallbackRoot);

    if (result.status === "error") {
      process.stderr.write(
        `[auto-fix] Prettier failed on ${result.filePath ?? "unknown file"}: ${result.error ?? "unknown error"}\n`,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`[auto-fix] ${message}\n`);
  }

  process.stdout.write(`${JSON.stringify({})}\n`);
}

main();

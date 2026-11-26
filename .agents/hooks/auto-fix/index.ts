import fs from "node:fs";
import path from "node:path";

import { runAutoFixHook, type PostToolUseInput } from "./core.ts";

function main(): void {
  try {
    const raw = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
    const parsed = raw.trim() ? (JSON.parse(raw) as PostToolUseInput) : {};
    const fallbackRoot = path.resolve(import.meta.dirname, "../../..");

    runAutoFixHook(parsed, fallbackRoot);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`[auto-fix] ${message}\n`);
  }

  process.stdout.write(`${JSON.stringify({})}\n`);
}

main();

import fs from "node:fs";

import { evaluateSafetyGate, type PreToolUseInput } from "./core.ts";

function main(): void {
  try {
    const raw = process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8");
    const parsed = raw.trim() ? (JSON.parse(raw) as PreToolUseInput) : {};
    const decision = evaluateSafetyGate(parsed);

    process.stdout.write(`${JSON.stringify(decision)}\n`);

    return;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    process.stderr.write(`[safety-gate] ${message}\n`);
  }

  process.stdout.write(`${JSON.stringify({ decision: "allow" })}\n`);
}

main();

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type CheckProfile = "docs" | "code" | "fast";

export interface CheckTask {
  name: string;
  args: string[];
}

export interface CheckWave {
  name: string;
  concurrency: number;
  tasks: CheckTask[];
}

export interface ProfilePlan {
  waves: CheckWave[];
}

export interface TaskResult {
  name: string;
  exitCode: number;
  durationMs: number;
  output: string;
}

export interface RunProfileResult {
  profile: CheckProfile;
  passed: boolean;
  totalDurationMs: number;
  results: TaskResult[];
}

export type TaskRunner = (task: CheckTask) => Promise<TaskResult>;

const STATIC_CONCURRENCY = 3;

const DOCS_TASKS: CheckTask[] = [
  { name: "format:check", args: ["run", "format:check"] },
  { name: "lint:md", args: ["run", "lint:md"] },
  { name: "adr:check", args: ["run", "adr:check"] },
];

const PREP_TASK: CheckTask = { name: "next:typegen", args: ["exec", "next", "typegen"] };

const CODE_TASKS: CheckTask[] = [
  { name: "lint", args: ["run", "lint"] },
  { name: "knip", args: ["run", "knip"] },
  { name: "typecheck", args: ["exec", "tsc", "--noEmit"] },
  { name: "depcruise", args: ["run", "depcruise"] },
  { name: "lint:css", args: ["run", "lint:css"] },
];

const FAST_STATIC_TASKS: CheckTask[] = [
  { name: "lint", args: ["run", "lint"] },
  { name: "knip", args: ["run", "knip"] },
  { name: "format:check", args: ["run", "format:check"] },
  { name: "typecheck", args: ["exec", "tsc", "--noEmit"] },
  { name: "depcruise", args: ["run", "depcruise"] },
  { name: "adr:check", args: ["run", "adr:check"] },
  { name: "lint:md", args: ["run", "lint:md"] },
  { name: "lint:css", args: ["run", "lint:css"] },
];

const UNIT_TEST_TASK: CheckTask = { name: "test:unit", args: ["run", "test:unit"] };

export function isCheckProfile(value: string | undefined): value is CheckProfile {
  return value === "docs" || value === "code" || value === "fast";
}

export function getProfilePlan(profile: CheckProfile): ProfilePlan {
  switch (profile) {
    case "docs":
      return {
        waves: [{ name: "docs", concurrency: STATIC_CONCURRENCY, tasks: [...DOCS_TASKS] }],
      };

    case "code":
      return {
        waves: [
          { name: "prep", concurrency: 1, tasks: [PREP_TASK] },
          { name: "code", concurrency: STATIC_CONCURRENCY, tasks: [...CODE_TASKS] },
        ],
      };

    case "fast":
      return {
        waves: [
          { name: "prep", concurrency: 1, tasks: [PREP_TASK] },
          { name: "static", concurrency: STATIC_CONCURRENCY, tasks: [...FAST_STATIC_TASKS] },
          { name: "tests", concurrency: 1, tasks: [UNIT_TEST_TASK] },
        ],
      };
  }
}

export function spawnPnpmTask(task: CheckTask): Promise<TaskResult> {
  const startedAt = performance.now();
  const isWindows = process.platform === "win32";
  const command = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const args = isWindows ? ["/d", "/c", "pnpm", ...task.args] : task.args;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.on("error", (err) => {
      const durationMs = performance.now() - startedAt;

      resolve({
        name: task.name,
        exitCode: 1,
        durationMs,
        output: `${Buffer.concat(chunks).toString("utf8")}\n${err.message}`.trim(),
      });
    });

    child.on("close", (code) => {
      const durationMs = performance.now() - startedAt;

      resolve({
        name: task.name,
        exitCode: code ?? 1,
        durationMs,
        output: Buffer.concat(chunks).toString("utf8").trim(),
      });
    });
  });
}

export async function runWithConcurrency(
  tasks: CheckTask[],
  concurrency: number,
  runner: TaskRunner,
): Promise<TaskResult[]> {
  if (tasks.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(concurrency, tasks.length));
  const results = new Array<TaskResult>(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;

      nextIndex += 1;
      results[currentIndex] = await runner(tasks[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));

  return results;
}

export async function runProfile(
  profile: CheckProfile,
  runner: TaskRunner = spawnPnpmTask,
): Promise<RunProfileResult> {
  const startedAt = performance.now();
  const plan = getProfilePlan(profile);
  const results: TaskResult[] = [];

  for (const wave of plan.waves) {
    const waveResults = await runWithConcurrency(wave.tasks, wave.concurrency, runner);

    results.push(...waveResults);

    if (waveResults.some((result) => result.exitCode !== 0)) {
      return {
        profile,
        passed: false,
        totalDurationMs: performance.now() - startedAt,
        results,
      };
    }
  }

  return {
    profile,
    passed: true,
    totalDurationMs: performance.now() - startedAt,
    results,
  };
}

export function formatSummary(summary: RunProfileResult): string {
  const lines: string[] = [];
  const passedCount = summary.results.filter((result) => result.exitCode === 0).length;
  const totalCount = summary.results.length;
  const totalSec = (summary.totalDurationMs / 1000).toFixed(2);

  lines.push(`[check:${summary.profile}]`);

  for (const result of summary.results) {
    const status = result.exitCode === 0 ? "PASS" : "FAIL";
    const sec = (result.durationMs / 1000).toFixed(2);

    lines.push(`  ${status}  ${result.name.padEnd(14)} ${sec.padStart(6)}s`);
  }

  const overall = summary.passed ? "ALL PASSED" : "FAILED";

  lines.push(`${overall} (${passedCount}/${totalCount}) in ${totalSec}s`);

  const failedResults = summary.results.filter((result) => result.exitCode !== 0);

  for (const failed of failedResults) {
    lines.push("");
    lines.push(`=== ${failed.name} (exit ${failed.exitCode}) ===`);
    lines.push(failed.output || "(no output)");
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const profileArg = process.argv[2];

  if (!isCheckProfile(profileArg)) {
    process.stderr.write("Usage: node scripts/check.ts <docs|code|fast>\n");
    process.exitCode = 1;

    return;
  }

  const summary = await runProfile(profileArg);

  process.stdout.write(`${formatSummary(summary)}\n`);

  if (!summary.passed) {
    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  void main();
}

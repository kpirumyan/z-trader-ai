import { describe, expect, it, vi } from "vitest";

import {
  formatSummary,
  getProfilePlan,
  isCheckProfile,
  runProfile,
  runWithConcurrency,
} from "../check.ts";

describe("scripts/check", () => {
  it("validates supported check profiles", () => {
    expect(isCheckProfile("docs")).toBe(true);
    expect(isCheckProfile("code")).toBe(true);
    expect(isCheckProfile("fast")).toBe(true);
    expect(isCheckProfile("unknown")).toBe(false);
    expect(isCheckProfile(undefined)).toBe(false);
  });

  it("builds staged wave plans with bounded concurrency for docs, code, and fast", () => {
    const docs = getProfilePlan("docs");
    const code = getProfilePlan("code");
    const fast = getProfilePlan("fast");

    expect(docs.waves).toHaveLength(1);
    expect(docs.waves[0]).toMatchObject({ name: "docs", concurrency: 3 });
    expect(docs.waves[0]?.tasks.map((t) => t.name)).toEqual([
      "format:check",
      "lint:md",
      "adr:check",
    ]);

    expect(code.waves.map((w) => ({ name: w.name, concurrency: w.concurrency }))).toEqual([
      { name: "prep", concurrency: 1 },
      { name: "code", concurrency: 3 },
    ]);
    expect(code.waves[1]?.tasks.map((t) => t.name)).toEqual([
      "lint",
      "knip",
      "typecheck",
      "depcruise",
      "lint:css",
    ]);

    expect(fast.waves.map((w) => ({ name: w.name, concurrency: w.concurrency }))).toEqual([
      { name: "prep", concurrency: 1 },
      { name: "static", concurrency: 3 },
      { name: "tests", concurrency: 1 },
    ]);
    expect(fast.waves[1]?.tasks.map((t) => t.name)).toEqual([
      "lint",
      "knip",
      "format:check",
      "typecheck",
      "depcruise",
      "adr:check",
      "lint:md",
      "lint:css",
    ]);
    expect(fast.waves[2]?.tasks.map((t) => t.name)).toEqual(["test:unit"]);
  });

  it("enforces bounded concurrency and preserves task order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const tasks = ["a", "b", "c", "d", "e"].map((name) => ({ name, args: [] }));
    const results = await runWithConcurrency(tasks, 2, async (task) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;

      return { name: task.name, exitCode: 0, durationMs: 10, output: "ok" };
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(results.map((r) => r.name)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("stops before subsequent waves when an earlier wave fails", async () => {
    const runner = vi.fn(async (task: { name: string }) => ({
      name: task.name,
      exitCode: task.name === "lint:md" ? 1 : 0,
      durationMs: 25,
      output: task.name === "lint:md" ? "bad markdown" : "ok",
    }));

    const summary = await runProfile("fast", runner);
    const formatted = formatSummary(summary);

    expect(summary.passed).toBe(false);
    // Wave 1 (1 prep) + Wave 2 (8 static) = 9; Wave 3 (test:unit) must be skipped
    expect(runner).toHaveBeenCalledTimes(9);
    expect(summary.results.some((r) => r.name === "test:unit")).toBe(false);
    expect(formatted).toContain("FAILED (8/9)");
    expect(formatted).toContain("=== lint:md (exit 1) ===");
    expect(formatted).toContain("bad markdown");
    expect(formatted).not.toContain("=== format:check");
  });
});

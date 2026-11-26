import { describe, expect, it } from "vitest";

import { evaluateSafetyGate, extractCommandLine } from "../core.ts";

describe("safety-gate PreToolUse hook", () => {
  it("extracts command lines from supported run_command arg shapes", () => {
    expect(extractCommandLine({ toolCall: { args: { CommandLine: "pnpm test" } } })).toBe(
      "pnpm test",
    );

    expect(extractCommandLine({ toolCall: { args: { command: "git status" } } })).toBe(
      "git status",
    );

    expect(extractCommandLine({ toolCall: { args: {} } })).toBeUndefined();
  });

  it("denies git commit/push hook bypasses via --no-verify, -n, HUSKY=0, or core.hooksPath", () => {
    expect(
      evaluateSafetyGate({
        toolCall: { name: "run_command", args: { CommandLine: 'git commit --no-verify -m "wip"' } },
      }),
    ).toMatchObject({ decision: "deny" });

    expect(
      evaluateSafetyGate({
        toolCall: {
          name: "run_command",
          args: { CommandLine: "git push --no-verify origin main" },
        },
      }),
    ).toMatchObject({ decision: "deny" });

    expect(
      evaluateSafetyGate({
        toolCall: { name: "run_command", args: { CommandLine: 'git commit -nm "wip"' } },
      }),
    ).toMatchObject({ decision: "deny" });

    expect(
      evaluateSafetyGate({
        toolCall: {
          name: "run_command",
          args: { CommandLine: 'pnpm test && git commit -n -m "x"' },
        },
      }),
    ).toMatchObject({ decision: "deny" });

    expect(
      evaluateSafetyGate({
        toolCall: { name: "run_command", args: { CommandLine: 'HUSKY=0 git commit -m "bypass"' } },
      }),
    ).toMatchObject({ decision: "deny" });

    expect(
      evaluateSafetyGate({
        toolCall: {
          name: "run_command",
          args: { CommandLine: 'git -c core.hooksPath=/dev/null commit -m "bypass"' },
        },
      }),
    ).toMatchObject({ decision: "deny" });

    expect(
      evaluateSafetyGate({
        toolCall: {
          name: "run_command",
          args: { CommandLine: 'cmd /c "git commit --no-verify -m nested"' },
        },
      }),
    ).toMatchObject({ decision: "deny" });
  });

  it("allows normal git commands, git push -n dry runs, and commit messages mentioning --no-verify", () => {
    expect(
      evaluateSafetyGate({
        toolCall: {
          name: "run_command",
          args: { CommandLine: 'git commit -m "Block --no-verify"' },
        },
      }),
    ).toEqual({ decision: "allow" });

    expect(
      evaluateSafetyGate({
        toolCall: { name: "run_command", args: { CommandLine: "git push -n origin main" } },
      }),
    ).toEqual({ decision: "allow" });

    expect(
      evaluateSafetyGate({
        toolCall: { name: "run_command", args: { CommandLine: 'rg -n "--no-verify" .agents/' } },
      }),
    ).toEqual({ decision: "allow" });

    expect(
      evaluateSafetyGate({
        toolCall: { name: "run_command", args: { CommandLine: "pnpm check:fast" } },
      }),
    ).toEqual({ decision: "allow" });
  });
});

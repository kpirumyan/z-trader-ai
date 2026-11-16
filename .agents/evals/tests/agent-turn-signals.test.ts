import { describe, expect, it } from "vitest";

import { evaluate } from "../agent-turn-signals.ts";

function createContext(metadata: unknown) {
  return {
    observation: {
      input: "test prompt",
      output: "test response",
      metadata,
      toolCalls: [],
    },
    experiment: undefined,
  };
}

describe("agent-turn-signals code evaluator", () => {
  it("emits baseline scores and omits gate_outcome when no gates ran", () => {
    const result = evaluate(
      createContext({
        errorCount: "0",
        failedTools: [],
        "gateSummary.totalRuns": "0",
        "gateSummary.firstTryPassed": "",
        "gateSummary.finalPassed": "",
        "gateSummary.retryCount": "0",
        "gateSummary.failedGates": [],
      }),
    );

    expect(result.scores).toEqual([
      {
        name: "tool_error_occurred",
        value: false,
        dataType: "BOOLEAN",
        comment: "No tool errors",
      },
      {
        name: "tool_error_count",
        value: 0,
        dataType: "NUMERIC",
        comment: "No tool errors",
      },
      {
        name: "turn_interrupted",
        value: false,
        dataType: "BOOLEAN",
        comment: "Completed normally",
      },
    ]);
  });

  it("emits gate_outcome = passed_first_try for nested and OTel-flattened metadata", () => {
    const nestedResult = evaluate(
      createContext({
        errorCount: 0,
        failedTools: [],
        gateSummary: {
          totalRuns: 1,
          firstTryPassed: true,
          finalPassed: true,
          retryCount: 0,
          failedGates: [],
        },
      }),
    );

    const flatResult = evaluate(
      createContext({
        errorCount: "0",
        failedTools: [],
        "gateSummary.totalRuns": "1",
        "gateSummary.firstTryPassed": "true",
        "gateSummary.finalPassed": "true",
        "gateSummary.retryCount": "0",
        "gateSummary.failedGates": [],
      }),
    );

    expect(nestedResult.scores.find((s) => s.name === "gate_outcome")).toEqual({
      name: "gate_outcome",
      value: "passed_first_try",
      dataType: "CATEGORICAL",
      comment: "Runs: 1, retries: 0",
    });

    expect(flatResult.scores.find((s) => s.name === "gate_outcome")).toEqual({
      name: "gate_outcome",
      value: "passed_first_try",
      dataType: "CATEGORICAL",
      comment: "Runs: 1, retries: 0",
    });
  });

  it("emits tool errors and passed_after_retry when gates recover on retry", () => {
    const result = evaluate(
      createContext({
        errorCount: "1",
        failedTools: ["run_command:lint (step 4)"],
        "gateSummary.totalRuns": "2",
        "gateSummary.firstTryPassed": false,
        "gateSummary.finalPassed": true,
        "gateSummary.retryCount": "1",
        "gateSummary.failedGates": ["run_command:lint"],
      }),
    );

    expect(result.scores).toEqual([
      {
        name: "tool_error_occurred",
        value: true,
        dataType: "BOOLEAN",
        comment: "Failed tools (1): run_command:lint (step 4)",
      },
      {
        name: "tool_error_count",
        value: 1,
        dataType: "NUMERIC",
        comment: "Failed tools (1): run_command:lint (step 4)",
      },
      {
        name: "gate_outcome",
        value: "passed_after_retry",
        dataType: "CATEGORICAL",
        comment: "Runs: 2, retries: 1; failed gates: run_command:lint",
      },
      {
        name: "turn_interrupted",
        value: false,
        dataType: "BOOLEAN",
        comment: "Completed normally",
      },
    ]);
  });

  it("emits failed gate_outcome and turn_interrupted = true on USER_CANCELED", () => {
    const result = evaluate(
      createContext({
        errorCount: 2,
        failedTools: '["edit_file (step 8)", "run_command:vitest (step 9)"]',
        gateSummary: {
          totalRuns: 2,
          firstTryPassed: false,
          finalPassed: false,
          retryCount: 1,
          failedGates: ["run_command:vitest"],
        },
        terminationReason: "USER_CANCELED",
      }),
    );

    expect(result.scores).toEqual([
      {
        name: "tool_error_occurred",
        value: true,
        dataType: "BOOLEAN",
        comment: "Failed tools (2): edit_file (step 8), run_command:vitest (step 9)",
      },
      {
        name: "tool_error_count",
        value: 2,
        dataType: "NUMERIC",
        comment: "Failed tools (2): edit_file (step 8), run_command:vitest (step 9)",
      },
      {
        name: "gate_outcome",
        value: "failed",
        dataType: "CATEGORICAL",
        comment: "Runs: 2, retries: 1; failed gates: run_command:vitest",
      },
      {
        name: "turn_interrupted",
        value: true,
        dataType: "BOOLEAN",
        comment: "Termination reason: USER_CANCELED",
      },
    ]);
  });
});

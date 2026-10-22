---
name: tdd-workflow
description: "Executes a strict blind Test-Driven Development (TDD) pipeline using isolated subagents (Tester, Coder, Reviewer, and optionally Architect). Triggered via /tdd-workflow; pass an optional architecture hint (e.g. '/tdd-workflow arch') to run the Architect stage first."
---

# Blind TDD Workflow

Execute the requested task through a strict black-box TDD pipeline where test authoring, implementation, and review are isolated across dedicated subagents.

## 1. Mode Selection & Task Framing

1. **Select mode from the user's request:**
   - **Standard Mode (Default):** Runs `Tester → Coder → Reviewer`.
   - **Architecture Mode:** If the user requests architectural design (e.g., `/tdd-workflow arch`, `architecture`, `with architect`), read and execute [`references/architecture.md`](references/architecture.md) before Stage 1.

2. **Prepare the alignment input for `Tester` and `Coder`:**
   - **Existing contract/plan file** (from `.agents/plans/` or the `Architect` subagent artifact): pass its file path as the single source of truth.
   - **Small/localized task without a contract file:** include a concise task brief directly in the subagent prompt with:
     1. The user's goal and expected observable behavior.
     2. The exact public seam (target file path, exported symbol/component name, and call/prop signature) if any new or modified export is required.

3. **Baseline check:**
   - Check `git status` to separate pre-existing workspace changes or failures from new work.

## 2. Pipeline Isolation & Retry Budgets

Spawn subagents sequentially via `invoke_subagent` using project profiles (`TypeName="tester"`, `TypeName="coder"`, `TypeName="reviewer"`, and `TypeName="architect"` when in Architecture Mode). Do not read their `.agents/agents/*.md` definition files into your own context—the platform injects them automatically into each subagent.

### Context Curation (Blind Barrier)
- Never pass runtime implementation code or implementation diffs to `tester`.
- Never pass test files (`tests/**`), snapshots, fixtures, or raw test runner output containing test source lines to `coder`.
- **Architectural Escalation in Standard Mode:** If an unresolved architectural boundary (state ownership, Server vs. Client split, module boundaries) arises before or during `tester`, `coder`, or `reviewer` stages, pause and use `ask_question` to ask the user whether to load [`references/architecture.md`](references/architecture.md) in the current run.

### Retry Budgets (Tracked in Chat Context)
Initial execution of each stage does not consume retry budget. Track two counters in chat across the entire run:
- `check_fixes_used` (max **2**): incremented whenever a subagent is re-invoked to fix an invalid `RED` test or a failing `GREEN` check.
- `review_fixes_used` (max **2**): incremented whenever a subagent is re-invoked to address `CHANGES_REQUESTED` from `reviewer`.

If either counter exceeds **2**, stop immediately, preserve the workspace state, and report the stage, root cause, and remaining failure.

## 3. Stage 1: Tester → Verify RED

1. Invoke `tester` with the user's goal, the alignment input (contract path or task brief), and allowed test scope.
2. Handle `tester` verdict:
   - **`NEEDS_INPUT`**: Clarify missing public seam details or behavioral gaps (via the contract, `architect`, or `ask_question` if a product decision is required) and re-invoke `tester` before proceeding.
   - **`READY`**: Verify `tester` output yourself (never run `pnpm test:e2e` inside the sandbox):
     - **If unit/component tests (`tests/unit/`) were added or modified:** run `pnpm vitest run <path>` and confirm the tests fail (`RED`) specifically because the target behavior is missing.
     - **If Playwright E2E tests (`tests/e2e/`) were added or modified** (either alone or alongside unit tests): verify their static validity via `pnpm typecheck` and `pnpm lint` instead of executing Playwright.
     - Syntax errors, broken imports, or runner misconfigurations do **not** count as valid `RED`; send them back to `tester` (consumes `check_fixes_used`).
     - If unit tests already pass (`GREEN`), check whether the requirement is already satisfied before requesting any code changes.

## 4. Stage 2: Coder → Verify GREEN

1. Invoke `coder` with the user's goal, the same alignment input, target implementation paths, and confirmation that `RED` is verified.
   - Instruct `coder` to validate its edits locally using `pnpm format`, `pnpm lint:fix`, `pnpm typecheck`, and `pnpm lint` only, without running test suites.
2. After `coder` finishes, run `pnpm check:fast` (`format:check`, `typecheck`, `lint`, and `test:unit`) yourself.
   - Never run `pnpm test:e2e`, `pnpm test:all`, or `pnpm check` in the sandbox.
3. **Handle failures (consumes `check_fixes_used`):**
   - If `check:fast` fails due to implementation issues, strip all test source snippets/assertions from the logs and send only the behavioral discrepancy to `coder`.
   - If a test itself is proven defective against the specification, send the fix to `tester` without exposing implementation code.
   - Repeat `pnpm check:fast` until `GREEN` before proceeding to review.

## 5. Stage 3: Reviewer → Final Acceptance

1. Invoke `reviewer` with the user's original goal, the alignment input/contract, the final `git diff`, and verification results.
2. Handle `reviewer` verdict:
   - **`APPROVED`**: Complete final diff/boundary inspection and report results to the user.
   - **`CHANGES_REQUESTED`** (consumes `review_fixes_used`): Route the defect to the responsible subagent (`coder` with sanitized feedback, `tester` for test defects, or `architect` / escalation prompt for architectural flaws). Re-run `pnpm check:fast` and re-invoke `reviewer` after fixes.

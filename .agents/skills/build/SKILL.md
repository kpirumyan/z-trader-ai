---
name: build
description: Orchestrates multi-agent assembly, testing, review gates, and verification for an approved task specification.
---

# Universal Assembly Workflow (`build`)

This skill executes **Session 2 (Multi-Agent Assembly)** of the Z-Trader development pipeline. It drives the implementation and verification of an approved task specification (`.agents/plans/specs/<name>.md`) via specialized subagents and automated gates.

The Orchestrator coordinates the pipeline and never implements production code or tests directly.

---

## Execution Steps

### Step 0: Specification Verification & Context Loading
1. Extract `<name>` from prompt or ask developer via `ask_question`.
2. Read `.agents/plans/specs/<name>.md`. Verify that frontmatter contains `status: approved`. If missing or in `draft` status, halt and instruct the developer to complete `/spec <name>` first.
3. Extract metadata from frontmatter:
   - `type`: `module` | `shared` | `composition` | `app` | `fix`
   - `target_path`: directory path (e.g. `src/modules/<name>`, `src/shared/<path>`, etc.)
   - `composition_point`: registry target or `none`
   - `e2e_required`: `true` | `false`

### Step 1: RED Phase (Tester)
1. Invoke the `tester` subagent:
   - Provide task name, path to `.agents/plans/specs/<name>.md`, target test path (`<target_path>/tests/` or `tests/unit/`), and whether E2E is required.
   - Tester writes black-box unit tests in `<target_path>/tests/` (and Playwright E2E in `tests/e2e/<name>.spec.ts` if required) strictly based on the Behavioral Test Scenarios in `.agents/plans/specs/<name>.md`.
   - Tester runs vitest to confirm tests are syntactically valid and failing against unwritten code (RED).
2. Handle tester response:
   - If `STATUS: NEEDS_INPUT`: Halt and ask the developer for guidance via `ask_question`. Forward resolution back to tester.
   - When tester completes: save failing error traces for Step 2.

### Step 2: GREEN Phase (Coder)
1. Invoke the `coder` subagent:
   - Provide task name, path to `.agents/plans/specs/<name>.md`, target directory (`<target_path>/`), composition registry target (if any), and failing test logs from Step 1.
   - Coder writes implementation files and optional composition wiring, executing its self-healing loop (up to 3 vitest attempts) until all tests pass (GREEN).
2. Handle coder response:
   - If `STATUS: NEEDS_INPUT`: Halt and consult developer via `ask_question`. Forward resolution back to coder.
   - When coder completes with passing tests: proceed to review gate.

### Step 3: Parallel Review Gate (4 Reviewers)
1. Inspect changed files using `git status --short` and `git diff`.
2. Concurrently invoke all 4 auditor subagents:
   - `arch-reviewer`: audits against [codebase-layout.md](../../rules/codebase-layout.md) (enforces module isolation, unidirectional shared rules, shell layer isolation).
   - `code-reviewer`: audits React/Next.js best practices, memory safety, and TypeScript robustness.
   - `test-reviewer`: audits test coverage of Behavioral Test Scenarios in `.agents/plans/specs/<name>.md` and black-box integrity.
   - `ui-reviewer`: audits UI against [DESIGN.md](../../../DESIGN.md) (or issues `[N/A: Non-visual target]` if non-visual).
3. Evaluate reviewer responses according to [reviewer-charter.md](../../agents/references/reviewer-charter.md):
   - If any reviewer returns `STATUS: NEEDS_INPUT`: Halt and present the question to the developer via `ask_question`. Forward clarification back to reviewers.
   - If any reviewer returns `STATUS: CHANGES_REQUESTED`:
     - Maintain a rework round counter (starts at 1, maximum 2 rounds allowed).
     - **Circuit Breaker**: If round count exceeds 2, halt automated looping and present unresolved blockers to the developer via `ask_question`.
     - Otherwise: dispatch blockers to `coder` (or `tester` for test issues) to fix strictly the identified items. Re-invoke reviewers on the updated diff.
   - Once all 4 reviewers return `STATUS: APPROVED`: proceed to final verification.

### Step 4: Final Verification Gate
1. Run `pnpm check:fast` in the sandbox (executes `format:check`, `typecheck`, `lint`, `depcruise`, `knip`, `test:unit`).
2. If `e2e_required: true`: run `pnpm playwright test tests/e2e/<name>.spec.ts`.
3. If any gate check fails, dispatch error output to coder/tester for resolution (subject to the rework limit).

### Step 5: Passport, Status Tracking & Spec Cleanup
1. If the task target is a module (`type: module`), generate/update `src/modules/<name>/README.md` following [passport-template.md](./resources/passport-template.md).
2. Update task completion status:
   - In `.agents/plans/tasks.md`: locate the task entry matching `<name>` and mark its checkbox as completed (`- [x]`).
   - If the task target is a module (`type: module`), update its status in `docs/project-overview.md` from `Planned` to `Completed`.
3. Delete the completed ephemeral task specification file: remove `.agents/plans/specs/<name>.md`.

### Step 6: Delivery Summary
Present structured completion summary to the developer:
- Created/modified files and line counts.
- Test execution results (unit and E2E).
- Reviewer verdicts and non-blocking suggestions (`[NIT]`).
- **Skills Usage Summary**: Table aggregating reported skills (`SKILLS_USED`) from Orchestrator, `tester`, `coder`, and reviewers.
- Confirmation of task status update in `.agents/plans/tasks.md` and ephemeral specification cleanup (`.agents/plans/specs/<name>.md` deleted).
- **Next Step Recommendation**: Read `.agents/plans/tasks.md`, find the immediate next pending (`- [ ]`) task, and provide an explicit directive:
  `Open a fresh chat session and run: /spec <next-task-name>`

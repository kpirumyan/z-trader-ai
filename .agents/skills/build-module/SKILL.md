---
name: build-module
description: Orchestrates Session 2 multi-agent assembly of a Z-Trader module: directs black-box test authoring (tester), isolated implementation (coder), parallel senior reviews (arch, code, test, ui), final gate validation, module passport generation, and interactive completion.
---

# Module Assembly Workflow (`build-module`)

This skill executes **Session 2 (Multi-Agent Assembly)** of the Z-Trader modular development pipeline. It drives the implementation and verification of an approved module specification (`docs/specs/<name>.md`) via specialized subagents and automated gates.

The Orchestrator coordinates the pipeline and never implements production code or tests directly.

---

## Execution Steps

### Step 0: Specification Verification & Context Loading
1. Extract `<module-name>` from prompt or ask developer via `ask_question`.
2. Read `docs/specs/<module-name>.md`. Verify that frontmatter contains `status: approved`. If missing or in `draft` status, halt and instruct the developer to complete `/spec-module <module-name>` first.
3. Extract metadata from frontmatter:
   - `composition_point` (e.g. `src/composition/widgets.ts`)
   - `e2e_required` (`true` | `false`)

### Step 1: RED Phase (Tester)
1. Invoke the `tester` subagent:
   - Provide module name, path to `docs/specs/<module-name>.md`, and whether E2E is required.
   - Tester writes black-box unit tests in `src/modules/<module-name>/tests/` (and Playwright E2E in `tests/e2e/<module-name>.spec.ts` if required) strictly based on the Behavioral Test Scenarios in `docs/specs/<module-name>.md`.
   - Tester runs vitest to confirm tests are syntactically valid and failing against unwritten code (RED).
2. Handle tester response:
   - If `STATUS: NEEDS_INPUT`: Halt and ask the developer for guidance via `ask_question`. Forward resolution back to tester.
   - When tester completes: save failing error traces for Step 2.

### Step 2: GREEN Phase (Coder)
1. Invoke the `coder` subagent:
   - Provide module name, path to `docs/specs/<module-name>.md`, composition registry target, and failing test logs from Step 1.
   - Coder writes module implementation files and registers in composition root, executing its self-healing loop (up to 3 vitest attempts) until all tests pass (GREEN).
2. Handle coder response:
   - If `STATUS: NEEDS_INPUT`: Halt and consult developer via `ask_question`. Forward resolution back to coder.
   - When coder completes with passing tests: proceed to review gate.

### Step 3: Parallel Review Gate (4 Reviewers)
1. Inspect changed files using `git status --short` and `git diff`.
2. Concurrently invoke all 4 auditor subagents:
   - `arch-reviewer`: audits against [codebase-layout.md](../../rules/codebase-layout.md) and Composition Registration in `docs/specs/<module-name>.md`.
   - `code-reviewer`: audits React/Next.js best practices, memory safety, and TypeScript robustness.
   - `test-reviewer`: audits test coverage of Behavioral Test Scenarios in `docs/specs/<module-name>.md` and black-box integrity.
   - `ui-reviewer`: audits UI against [DESIGN.md](../../../DESIGN.md).
3. Evaluate reviewer responses according to [reviewer-charter.md](../../agents/references/reviewer-charter.md):
   - If any reviewer returns `STATUS: NEEDS_INPUT`: Halt and present the question to the developer via `ask_question`. Forward clarification back to reviewers.
   - If any reviewer returns `STATUS: CHANGES_REQUESTED`:
     - Maintain a rework round counter (starts at 1, maximum 2 rounds allowed).
     - **Circuit Breaker**: If round count exceeds 2, halt automated looping and present unresolved blockers to the developer via `ask_question`.
     - Otherwise: dispatch blockers to `coder` (or `tester` for test issues) to fix strictly the identified items. Re-invoke reviewers on the updated diff.
   - Once all 4 reviewers return `STATUS: APPROVED`: proceed to final verification.

### Step 4: Final Verification Gate
1. Run `pnpm check:fast` in the sandbox (executes `format:check`, `typecheck`, `lint`, `depcruise`, `knip`, `test:unit`).
2. If `e2e_required: true`: run `pnpm playwright test tests/e2e/<module-name>.spec.ts`.
3. If any gate check fails, dispatch error output to coder/tester for resolution (subject to the rework limit).

### Step 5: Module Passport & Overview Registration
1. Generate `src/modules/<module-name>/README.md` following [passport-template.md](./resources/passport-template.md).
2. Update the module entry in `docs/project-overview.md` from `Planned` to `Active`.
3. In `docs/specs/<module-name>.md`, update frontmatter to `status: implemented`.

### Step 6: Interactive Delivery & Git Action
1. Present structured completion summary to the developer:
   - Created files and line counts.
   - Test execution results (unit and E2E).
   - Reviewer verdicts and non-blocking suggestions (`[NIT]`).
2. Query developer via `ask_question`:
   - `(Recommended) Create atomic git commit (feat(modules/<name>): implement module per rfc)`
   - `Keep uncommitted changes in workspace for manual inspection`
3. If commit is selected, execute `git add .` and `git commit -m "feat(modules/<module-name>): implement module per rfc"`.

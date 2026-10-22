# Architecture Stage (`architect`)

## 1. Delegation Context

Invoke `architect` (`TypeName="architect"`) with:
- The user's original goal and constraints.
- Relevant existing documentation or `.agents/plans/` paths (if any).
- Target domain/module areas in the repository.

Do **not** pass test files or pre-bias `architect` with an unverified implementation hypothesis.

## 2. Verdict Handling

- **`NEEDS_INPUT`**:
  - Answer questions directly from the repository or existing user instructions when possible.
  - Use `ask_question` only for genuine product or UX decisions that cannot be inferred, then forward the user's answer to `architect`.
  - Do not proceed to Stage 1 (`tester`) until `architect` returns `READY`.
- **`READY`**:
  - Use the returned Black-Box Boundary Contract artifact path as the single alignment input for **Stage 1 (`tester`)** and **Stage 2 (`coder`)**.

## 3. Architectural Revisions (`CHANGES_REQUESTED`)

If `reviewer` (or `tester` / `coder`) identifies an architectural flaw in the contract:
1. Increment `review_fixes_used` (max **2**).
2. Re-invoke `architect` with the specific flaw and its impact.
3. Once `architect` updates the contract artifact and returns `READY`, re-run the affected `tester` (`RED`) and `coder` (`GREEN`) stages against the updated contract before re-invoking `reviewer`.

# Reviewer Charter & Audit Standard

Unified review invariants for all Z-Trader subagent auditors.

## 1. Senior Engineer Principle (Beyond Checklists)

Checklists define the **mandatory minimum baseline**, not the boundary of analysis.
Reviewers act as Staff Engineers: if an auditor detects an unhandled runtime crash, memory leak, infinite loop, race condition, data corruption, or architectural liability outside their checklist, they must issue a `BLOCKER` with reproducible proof.

## 2. Binary Blocker Threshold

- `STATUS: CHANGES_REQUESTED`: Set strictly for objective blockers — failing tests/lint/build, direct violations of mandatory project rules or RFC specifications, verifiable runtime errors, or checklist violations.
- `STATUS: APPROVED`: Set when all mandatory requirements pass. Any stylistic preference or non-blocking improvement must be tagged `[NIT]` under `SUGGESTIONS` and never block approval.

## 3. Subagent Voice (`STATUS: NEEDS_INPUT`)

- Set `STATUS: NEEDS_INPUT` when an auditor discovers an irreconcilable contradiction in the RFC specification, an impossible constraint, or a domain conflict requiring human architectural decision rather than code rework.

## 4. No Moving Goalposts

- In rework cycles, evaluate strictly changed lines in the diff.
- Introducing new objections to code present and unchanged from earlier rounds is strictly forbidden.

## 5. Standard Verdict Format

Every reviewer must respond using this exact format:

```markdown
STATUS: APPROVED | CHANGES_REQUESTED | NEEDS_INPUT
BLOCKERS:
  - [file:line]: Precise failure mechanic, reproduction scenario, or rule violation
SUGGESTIONS:
  - [NIT]: Non-blocking recommendation or improvement
```

---
id: "ADR-XXXX"
title: "Decision Title in Title Case"
status: "proposed"
date: "YYYY-MM-DD"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "Architecture & Layout"
applies_to:
  - "src/modules/example"
enforced_by:
  - "src/modules/example/tests/example.test.ts"
supersedes: null
superseded_by: null
---

# ADR-XXXX: Decision Title in Title Case

## Context and Problem Statement

Describe the context and problem being solved. What architectural challenge or trade-off necessitated this decision?

## Decision Drivers

- First driver (e.g. performance constraint, architectural consistency)
- Second driver (e.g. test isolation, black-box perimeter)

## Decision Outcome

Chosen option: **Selected Architecture / Pattern**, because rationale and trade-offs.

### Implementation Guidelines

Concrete architectural invariants and patterns that must be respected by humans and AI agents.

## Confirmation and Enforcement

- Automated check or test verifying compliance (e.g. ESLint rules, boundary guards, Vitest suites).
- CLI verification via `pnpm adr:check`.

## Consequences

### Positive

- Benefits and capabilities enabled by this decision.

### Negative

- Trade-offs, complexities, or operational requirements introduced.

## Rejected Alternatives

- **Alternative A**: Why this was rejected (e.g. too complex, breaks isolation, high runtime overhead).
- **Alternative B**: Why this was rejected.

---
id: "ADR-XXXX"
title: "<Short Noun Phrase Title>"
status: "accepted"
date: "YYYY-MM-DD"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "<Architectural Area>"
applies_to:
  - "src/modules/<module-name>"
enforced_by:
  - "src/modules/<module-name>/tests/<test-file>.test.ts"
supersedes: null
superseded_by: null
---

# ADR-XXXX: <Short Noun Phrase Title>

## Context and Problem Statement

<Describe the architectural context and problem statement in 2–4 paragraphs or bullet points. State clearly what forces are in tension and end with the core question this decision answers.>

## Decision Drivers

- **<Driver 1>**: <Concrete requirement, quality attribute, or constraint.>
- **<Driver 2>**: <Concrete requirement, quality attribute, or constraint.>
- **<Driver 3>**: <Concrete requirement, quality attribute, or constraint.>

## Decision Outcome

Chosen option: **<Chosen Option Summary>**, because <concise justification linking back to the decision drivers>.

### 1. <Core Mechanism or Boundary>

- <Architectural rule or design detail.>

### 2. <Integration or Contract Rules>

- <How modules or layers interact under this decision.>

## Confirmation and Enforcement

- **<Verification Gate 1> (`<path/in/enforced_by>`)**: <How this test, schema, or linter rule mechanically enforces the decision.>

## Consequences

### Positive

- <Direct architectural benefit.>
- <Direct operational or maintainability benefit.>

### Negative

- <Explicit trade-off, constraint, or maintenance cost.>

## Rejected Alternatives

- **<Alternative 1>**: <Concrete technical reason why this option was rejected.>
- **<Alternative 2>**: <Concrete technical reason why this option was rejected.>

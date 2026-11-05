---
id: "{{ID}}"
title: "{{TITLE}}"
status: "{{STATUS}}"
date: "{{DATE}}"
decision-makers:
  - "Product Owner"
  - "Architect Agent" # Or Main Agent, Tester Agent, etc. (specify Product Owner and participating agents with 'Agent' suffix)
area: "{{AREA}}"
applies_to:
{{APPLIES_TO}}
enforced_by:
{{ENFORCED_BY}}
supersedes: {{SUPERSEDES}}
superseded_by: {{SUPERSEDED_BY}}
---

# {{ID}}: {{TITLE}}

## Context and Problem Statement

Describe the context, technical forces, and problem statement motivating this decision. What challenge or architectural choice is being addressed? End with the explicit architectural question being resolved.

## Decision Drivers

List the primary drivers, requirements, and constraints for this decision. Adapt these to the specific problem domain (e.g., performance, modularity, simplicity, developer ergonomics, security, data integrity, third-party constraints, or testability):

- **Driver 1 (Primary Goal/Requirement)**: State the primary functional or architectural goal.
- **Driver 2 (Quality Attribute / Constraint)**: State operational boundaries, latency/memory limits, typing, or isolation requirements.
- **Driver 3 (Verification / Maintainability)**: State automated verification criteria, developer experience, or maintenance constraints.

## Decision Outcome

Chosen option: **{{TITLE}}**, because it best satisfies the decision drivers with acceptable trade-offs and minimal architectural complexity.

### 1. Core Architectural Invariant

Define the primary structural, behavioral, data-flow, or contract rules established by this decision. Specify what is guaranteed and what constraints must be respected.

## Confirmation and Enforcement

Explain how compliance with this decision is verified and prevented from regressing over time:

- **Automated Verification**: Specify the automated gates (e.g. ESLint rules, TypeScript types, Dependency Cruiser rules, Knip constraints, Vitest unit/integration tests, or Playwright E2E suites).
- **Manual / Review Gates**: (Optional) Specify code review checks or architectural review protocols if automated enforcement is not applicable.

## Consequences

### Positive

- [Direct benefit, resolved pain point, or architectural advantage].
- [Secondary benefit, e.g. improved maintainability, faster development, or clearer ownership].

### Negative

- [Accepted trade-off, added maintenance effort, or operational constraint].
- [Any specific limitations or edge cases that require care].

## Rejected Alternatives

- **[Alternative Option A]**: [Reason for dismissal, e.g. excessive complexity, violates a decision driver, or lacks required capabilities].
- **[Alternative Option B]**: [Reason for dismissal].

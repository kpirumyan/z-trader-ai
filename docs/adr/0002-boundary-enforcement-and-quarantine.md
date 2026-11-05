---
id: "ADR-0002"
title: "Automated Architectural Boundary Enforcement"
status: "accepted"
date: "2026-11-05"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "Tooling & Governance"
applies_to:
  - "src/app"
  - "src/composition"
  - "src/modules/chart"
  - "src/modules/indicators"
  - "src/modules/instruments"
  - "src/modules/market-data"
  - "src/modules/order-book"
  - "src/modules/time-and-sales"
  - "src/modules/workspace"
  - "src/shared"
enforced_by:
  - "eslint.config.mjs"
  - ".dependency-cruiser.cjs"
  - "knip.json"
  - ".agents/skills/adr/tests/adr-cli.test.ts"
supersedes: null
superseded_by: null
---

# ADR-0002: Automated Architectural Boundary Enforcement

## Context and Problem Statement

A primary hazard when developing modular systems with autonomous AI coding agents is architectural drift: agents can inadvertently introduce deep internal imports (`@/src/modules/chart/model/chart-store`), circular dependencies, dead exports, or cross-widget coupling if architectural rules exist only in prose documentation.

Given the four-layer modular topology established in [ADR-0001](./0001-modular-architecture.md), how do we mechanically guarantee that every commit and agent task adheres to layer boundaries, widget isolation, and contract hygiene?

## Decision Drivers

- **Deterministic Compile- & Lint-Time Feedback**: Violations must fail fast during local editing and pre-commit verification (`pnpm check:fast`) with actionable error messages.
- **Zero-Tolerance Dead Code Hygiene**: Refactors must not leave behind orphaned files, unused exports, or unreferenced dependencies.
- **Defense in Depth**: Combine AST-level lint rules with full dependency-graph traversal and meta-tests that lock down gate configurations.

## Decision Outcome

Chosen option: **Three-Pillar Mechanical Gate Pipeline (`eslint-plugin-boundaries` + `dependency-cruiser` + `knip`)**, integrated into `pnpm check:fast` and `pnpm check` alongside ADR lifecycle verification in `.agents/skills/adr/tests/adr-cli.test.ts`.

### 1. AST & Import Perimeter Enforcement (`eslint.config.mjs`)

- **`eslint-plugin-boundaries`**: Classifies elements into `app`, `composition`, `module`, and `shared`, disallowing upward imports (`shared` -> `modules`/`composition`/`app`, `modules` -> `composition`/`app`) and direct `app` -> `modules` imports.
- **`no-restricted-imports`**: Blocks deep imports into module internals (`@/src/modules/*/*`) from both production code and black-box tests (`tests/` must import exclusively from public module entry points).
- **`no-restricted-syntax`**: Enforces pure re-export barrels in `src/modules/*/index.ts` and forbids runtime values inside `types.ts`.

### 2. Dependency Graph & Widget Isolation (`.dependency-cruiser.cjs`)

- **Cycle Prevention (`no-circular`)**: Fails on any circular dependency across `src/`.
- **Widget Isolation (`widget-isolation`)**: Guarantees that `chart`, `order-book`, and `time-and-sales` never depend on one another or on `workspace`.
- **Workspace Independence (`workspace-widget-independence`)**: Prevents `workspace` from importing concrete widgets directly (consuming them strictly via injected `WidgetDefinition` contracts).
- **Service Isolation (`market-data-service-isolation`)**: Prevents `market-data` from importing UI widgets or `workspace`.
- **Test Perimeter (`production-not-to-test`)**: Prevents production code from importing test utilities or spec files.

### 3. Dead Code & Contract Hygiene (`knip.json`)

- Runs `knip --max-issues 0` with `"error"` severity across `files`, `dependencies`, `unlisted`, `unresolved`, `exports`, and `types`, rooted at `src/composition/widgets.ts`, `src/modules/*/index.ts`, and `src/shared/*/index.ts`.

## Confirmation and Enforcement

- **Verification Pipeline (`package.json`)**: `pnpm check:fast` executes `pnpm format:check && pnpm typecheck && pnpm lint && pnpm depcruise && pnpm knip && pnpm adr:check && pnpm test:unit`.
- **ADR Lifecycle Governance Tests (`.agents/skills/adr/tests/adr-cli.test.ts`)**: Hermetic unit tests verify ADR scaffolding, superseding, path retargeting, module removal auto-deprecation, and README synchronization.

## Consequences

### Positive

- Architectural violations are caught immediately during code editing and pre-commit checks before code review.
- AI agents receive exact file-and-rule diagnostics when an import violates a module seam or layer boundary.
- `knip --max-issues 0` keeps public module contracts free of unused exports.

### Negative

- Static analysis tools (`eslint`, `depcruise`, `knip`) add a few seconds to full verification runs.
- Adding a new architectural layer or module category requires updating `.dependency-cruiser.cjs` and `eslint.config.mjs`.

## Rejected Alternatives

- **Prompt-Only Architectural Guidelines**: Human and AI developers inevitably introduce accidental deep imports or unused exports without automated enforcement.
- **Single-Tool Enforcement (ESLint Only)**: ESLint operates file-by-file and cannot efficiently detect multi-hop circular dependencies or workspace-wide unused exports like `dependency-cruiser` and `knip`.

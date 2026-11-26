---
id: "ADR-0010"
title: "Single-Owner Architectural Boundary Enforcement"
status: "accepted"
date: "2026-11-25"
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
  - ".husky/pre-commit"
  - "package.json"
  - ".agents/skills/adr/tests/adr-cli.test.ts"
supersedes: "ADR-0002"
superseded_by: null
---

# ADR-0010: Single-Owner Architectural Boundary Enforcement

## Context and Problem Statement

Supersedes [ADR-0002](./0002-boundary-enforcement-and-quarantine.md).

A primary hazard when developing modular systems with autonomous AI coding agents is architectural drift: if rules exist only in prose documentation, agents can inadvertently introduce deep internal imports (e.g., `@/src/modules/chart/model/chart-store`), circular dependencies, dead exports, or cross-widget coupling across the four-layer modular topology established in [ADR-0001](./0001-modular-architecture.md).

[ADR-0002](./0002-boundary-enforcement-and-quarantine.md) previously duplicated layer, quarantine, and module-boundary checks across both `eslint.config.mjs` (`eslint-plugin-boundaries` and `no-restricted-imports`) and `.dependency-cruiser.cjs`. In an AI-agent codebase where verification runs deterministically via `pnpm check:fast`, `pnpm check`, and pre-commit hooks rather than relying on interactive IDE red-squiggles, duplicating boundary rules across two tools causes configuration drift:

1. New isolation rules (such as `indicators-isolation` and `instruments-isolation`) were added to `.dependency-cruiser.cjs` without being mirrored in `eslint.config.mjs` or ADR-0002.
2. Depth-limited `no-restricted-imports` globs in ESLint (`../model`, `../../model`) silently miss deeper relative imports inside test trees, whereas path-based graph resolution in `dependency-cruiser` catches every import path regardless of nesting depth or path alias.
3. Running `eslint-plugin-boundaries` alongside `dependency-cruiser` forces agents to update two overlapping configs for every architectural boundary change.

How should Z-Trader partition static enforcement responsibilities across its mechanical gates so every rule has a single authoritative owner with zero coverage gaps?

## Decision Drivers

- **Single Source of Truth per Concern**: Every architectural constraint must live in exactly one tool configuration to eliminate rule drift between ESLint, `dependency-cruiser`, and ADRs.
- **Deterministic Fast Feedback**: Violations must fail fast during `pnpm check:fast`, `pnpm check`, and `.husky/pre-commit` with actionable error messages (surfacing boundary errors via `pnpm depcruise` rather than live ESLint squiggles).
- **Complete Graph & Depth-Agnostic Resolution**: Boundary rules must resolve TypeScript path aliases, relative paths at any nesting depth, and `import type` edges (`tsPreCompilationDeps: true`).
- **Pre-Commit Parity with `pnpm check:fast`**: Boundary violations must be caught at commit time (`.husky/pre-commit`) as well as during `pnpm check:fast` and `pnpm check`.
- **Zero-Tolerance Dead Code Hygiene**: Refactors must not leave behind orphaned files, unused exports, or unreferenced dependencies, and public contracts (`index.ts`) must remain free of dead exports and types.
- **Defense in Depth Without Config Duplication**: Combine complementary non-overlapping tools (`eslint` intra-file AST rules, `dependency-cruiser` graph traversal, and `knip` dead-code analysis). [ADR-0002](./0002-boundary-enforcement-and-quarantine.md)'s aspirational "meta-tests that lock down gate configurations" is intentionally replaced by strict single-owner tool settings (`treatConfigHintsAsErrors: true` in `knip.json`, `--max-warnings 0` in ESLint, explicit rule specs in `.dependency-cruiser.cjs`) plus hermetic ADR lifecycle tests in `.agents/skills/adr/tests/adr-cli.test.ts` rather than redundant config meta-tests.

## Decision Outcome

Chosen option: **Single-Owner Responsibility Split (`dependency-cruiser` for inter-file graph & boundaries + `eslint` for intra-file AST & syntax + `knip` for dead code)**, wired into `.husky/pre-commit`, `pnpm check:fast`, and `pnpm check`.

### 1. Inter-File Dependency Graph & Boundaries (`.dependency-cruiser.cjs`)

`dependency-cruiser` is the sole owner of all import-graph, layer, isolation, perimeter, and test-boundary rules across `src/` and `tests/` (with `tsPreCompilationDeps: true` so type-only imports are checked identically to runtime imports):

- **Cycle Prevention (`no-circular`)**: Fails on any circular dependency across `src/` and `tests/`.
- **Layer Topology (`src-no-app`, `shared-no-modules-composition-or-app`, `modules-no-composition-or-app`, `composition-no-app`, `app-no-modules`)**: Enforces the four-layer architecture from [ADR-0001](./0001-modular-architecture.md).
- **Module & Widget Isolation**:
  - `widget-isolation`: `chart`, `order-book`, and `time-and-sales` never depend on one another or on `workspace`.
  - `workspace-widget-independence`: `workspace` never imports concrete widgets (consuming them strictly via `WidgetDefinition`).
  - `market-data-service-isolation`: `market-data` never imports any other domain module (including UI widgets and `workspace`).
  - `indicators-isolation`: `indicators` is a pure calculation module and never imports any other domain module.
  - `instruments-isolation`: `instruments` never imports any other domain module.
- **Black-Box Public Entry Perimeters**:
  - `no-deep-imports-composition`: External files and `src/composition/tests/` may import `src/composition` solely via `src/composition/index.ts`.
  - `no-deep-imports-modules-external`, `no-deep-imports-modules-cross`, `no-deep-imports-modules-tests`: External code, other modules, and `src/modules/<name>/tests/` may import a module solely via `src/modules/<name>/index.ts`.
  - `no-deep-imports-shared-external`, `no-deep-imports-shared-cross`, `no-deep-imports-shared-tests`: External code, other shared segments, and `src/shared/<segment>/tests/` may import a shared segment solely via `src/shared/<segment>/index.ts`.
- **Test Perimeter (`production-not-to-test`)**: Prevents production code in `src/` from importing test utilities or spec files.

### 2. Intra-File AST & Syntax Hygiene (`eslint.config.mjs`)

ESLint focuses strictly on single-file syntax, TypeScript type-checked rules, React Hooks rules, import ordering, English-only code (`english-code/only-english`), styling policy (`style-policy/only-module-css` and CSS-in-JS import bans per [ADR-0003](./0003-css-architecture.md)), safe client storage (`localStorage` restrictions per [ADR-0004](./0004-resilient-storage-and-terminal-status-bar.md)), and structural AST constraints (`no-restricted-syntax` enforcing pure re-export barrels in `src/modules/*/index.ts` and forbidding runtime values/declarations in `types.ts`). `eslint-plugin-boundaries` and overlapping layer/deep-import `no-restricted-imports` blocks were intentionally removed because `dependency-cruiser` now owns all inter-file boundaries. Dedicated CSS (`stylelint.config.mjs`) and Markdown (`.markdownlint-cli2.yaml`) linters own stylesheet and documentation linting.

### 3. Dead Code & Contract Hygiene (`knip.json`)

Runs `pnpm knip` (`knip && knip --production --dependencies --files`) with zero-tolerance error severity (`--max-issues 0` is Knip's default behavior across `files`, `dependencies`, `unlisted`, `unresolved`, `exports`, and `types`), `includeEntryExports: true`, and `treatConfigHintsAsErrors: true`. Compared to [ADR-0002](./0002-boundary-enforcement-and-quarantine.md), manual `entry` roots (`src/composition/widgets.ts`, `src/modules/*/index.ts`, `src/shared/*/index.ts`) were intentionally replaced by built-in Next.js, Vitest, Playwright, ESLint, `dependency-cruiser`, Husky, and `lint-staged` plugins so dead exports and types inside public `index.ts` barrels are detected rather than exempted as entry points. `knip.json` declares only standalone `.agents/hooks/` CLI entry points and separates production `src/` (`!`) from `.agents/` and `tests/` in `project`.

## Confirmation and Enforcement

- **Verification Pipelines (`package.json`)**:
  - `pnpm check:fast` executes `pnpm typecheck && pnpm lint && pnpm lint:css && pnpm lint:md && pnpm depcruise && pnpm knip && pnpm adr:check && pnpm test:unit`, where `depcruise` scans `src` and `tests`.
  - `pnpm check` executes the same static gates followed by `pnpm test:all` (`pnpm test:unit && pnpm test:e2e`).
  - **Intentional Pipeline Change from ADR-0002**: `pnpm format:check` (`prettier --check .`) was intentionally moved out of `pnpm check:fast` and `pnpm check` because Prettier formatting is enforced automatically on staged files via `.lintstagedrc.json` inside `.husky/pre-commit` (while `pnpm format:check` remains available as a standalone script), and `pnpm lint:css` + `pnpm lint:md` were added.
- **Pre-Commit Hook (`.husky/pre-commit`)**: Executes `pnpm exec lint-staged && pnpm typecheck && pnpm depcruise && pnpm knip && pnpm adr:check` so staged linting/formatting (`eslint`, `stylelint`, `markdownlint-cli2`, `prettier`), boundary, dead-code, and ADR checks block violations before commit creation.
- **ADR Lifecycle Governance Tests (`.agents/skills/adr/tests/adr-cli.test.ts`)**: Hermetic Vitest suite verifies ADR scaffolding, superseding, path retargeting, module removal auto-deprecation, cryptographic locking, and README synchronization.

## Consequences

### Positive

- Every architectural boundary rule has a single owner, eliminating ESLint vs. `dependency-cruiser` duplication and rule drift.
- AI agents receive exact file-and-rule diagnostics when an import violates a module seam or layer boundary.
- `indicators-isolation` and `instruments-isolation` are now formally codified under active ADR governance.
- Black-box test and deep-import restrictions work at any directory nesting depth and cover `import type` edges via `tsPreCompilationDeps: true`.
- `pnpm knip` keeps public module contracts free of unused exports, orphaned files, and unreferenced dependencies.
- Running `pnpm depcruise` in `.husky/pre-commit` closes the pre-commit blind spot for cycles and cross-widget imports.

### Negative

- Static analysis tools (`eslint`, `stylelint`, `markdownlint-cli2`, `depcruise`, `knip`) add a few seconds to verification runs and `.husky/pre-commit`.
- Boundary and deep-import violations are surfaced by `pnpm depcruise`, pre-commit hooks, and `pnpm check:fast` rather than live ESLint squiggles inside an editor.
- Adding a new architectural layer or module category requires updating `.dependency-cruiser.cjs` (whereas `eslint.config.mjs` no longer requires layer or boundary updates).

## Rejected Alternatives

- **Prompt-Only Architectural Guidelines**: Human and AI developers inevitably introduce accidental deep imports, circular dependencies, or unused exports without automated mechanical enforcement.
- **Maintaining Duplicate Rules in Both ESLint and `dependency-cruiser`**: Causes ongoing drift whenever modules or rules change, as seen with `indicators` and `instruments` isolation.
- **Single-Tool Enforcement (ESLint Alone Without `dependency-cruiser` and `knip`)**: ESLint operates file-by-file and cannot efficiently detect multi-hop circular dependencies, graph-wide architectural isolation, or workspace-wide unused exports and dead code.

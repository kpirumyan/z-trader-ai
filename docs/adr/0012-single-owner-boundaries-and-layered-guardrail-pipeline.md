---
id: "ADR-0012"
title: "Single-Owner Boundaries and Layered Guardrail Pipeline"
status: "accepted"
date: "2026-11-27"
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
  - "stylelint.config.mjs"
  - ".markdownlint-cli2.yaml"
  - ".husky/pre-commit"
  - ".lintstagedrc.json"
  - "scripts/check.ts"
  - "scripts/tests/check.test.ts"
  - "scripts/tests/prettierignore-sync.test.ts"
  - "package.json"
  - ".github/workflows/ci.yml"
  - ".agents/skills/adr/tests/adr-cli.test.ts"
supersedes: "ADR-0010"
superseded_by: null
---

# ADR-0012: Single-Owner Boundaries and Layered Guardrail Pipeline

## Context and Problem Statement

Supersedes [ADR-0010](./0010-single-owner-architectural-boundary-enforcement.md).

A primary hazard when developing modular systems with autonomous AI coding agents is architectural drift: if rules exist only in prose documentation, agents can inadvertently introduce deep internal imports (e.g., `@/src/modules/chart/model/chart-store`), circular dependencies, dead exports, or cross-widget coupling across the four-layer modular topology established in [ADR-0001](./0001-modular-architecture.md).

[ADR-0010](./0010-single-owner-architectural-boundary-enforcement.md) established the single-owner tool split (`dependency-cruiser` for inter-file graph & boundaries + `eslint` for intra-file AST & syntax + `knip` for dead code) before GitHub Actions CI existed. With GitHub Actions CI (`.github/workflows/ci.yml`) now acting as the clean-environment integration gate, running repo-wide checks (`typecheck`, `depcruise`, `knip`, `adr:check`) and `vitest related` inside `.husky/pre-commit` alongside `pnpm check:fast` caused redundant local execution, broke partial (`git add -p`) commits, and drifted from `.lintstagedrc.json` (where `stylelint` and `markdownlint-cli2` had been dropped, while `format:check` was missing from `check:fast`).

How should Z-Trader partition static enforcement responsibilities across its mechanical gates and across its four execution stages (single-file, staged, repository, GitHub CI) so every rule has a single authoritative owner with zero coverage gaps and minimal redundant latency?

## Decision Drivers

- **Single Source of Truth per Concern**: Every architectural constraint must live in exactly one tool configuration to eliminate rule drift between ESLint, `dependency-cruiser`, and ADRs.
- **Layered Stage Responsibilities Without Redundancy**: Each stage (staged commit, repository-wide local gate, GitHub CI) must own a distinct scope—staged-only formatting/linting in `.husky/pre-commit`, parallel repo-wide verification in `scripts/check.ts`, and clean-environment enforcement of those exact SSOT scripts in `.github/workflows/ci.yml`. (**Intentional Change from ADR-0010**: replaces ADR-0010's "Pre-Commit Parity with `pnpm check:fast`" driver because Stage 4 GitHub CI now provides the unbypassable repo-wide gate, eliminating redundant pre-commit runs and partial-commit breakage.)
- **Deterministic Fast Feedback**: Violations must fail fast during `pnpm check:fast`, `pnpm check:code`, `pnpm check:docs`, `pnpm check`, and `.husky/pre-commit` with actionable error messages (surfacing boundary errors via `pnpm depcruise` rather than live ESLint squiggles).
- **Complete Graph & Depth-Agnostic Resolution**: Boundary rules must resolve TypeScript path aliases, relative paths at any nesting depth, and `import type` edges (`tsPreCompilationDeps: true`).
- **Zero-Tolerance Dead Code Hygiene**: Refactors must not leave behind orphaned files, unused exports, or unreferenced dependencies, and public contracts (`index.ts`) must remain free of dead exports and types.
- **Defense in Depth Without Config Duplication**: Combine complementary non-overlapping tools (`eslint` intra-file AST rules, `dependency-cruiser` graph traversal, and `knip` dead-code analysis). [ADR-0002](./0002-boundary-enforcement-and-quarantine.md)'s aspirational "meta-tests that lock down gate configurations" remains replaced by strict single-owner tool settings (`treatConfigHintsAsErrors: true` in `knip.json`, `--max-warnings 0` in ESLint, explicit rule specs in `.dependency-cruiser.cjs`) plus hermetic ADR lifecycle tests in `.agents/skills/adr/tests/adr-cli.test.ts`.

## Decision Outcome

Chosen option: **Single-Owner Responsibility Split (`dependency-cruiser` for inter-file graph & boundaries + `eslint` for intra-file AST & syntax + `knip` for dead code) Orchestrated Across Three Active Stages (Staged Pre-Commit, Parallel Repo Runner, GitHub CI)**.

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

ESLint focuses strictly on single-file syntax, TypeScript type-checked rules, React Hooks rules, import ordering, English-only code (`english-code/only-english`), styling policy (`style-policy/only-module-css` and CSS-in-JS import bans per [ADR-0003](./0003-css-architecture.md)), safe client storage (`localStorage` restrictions per [ADR-0004](./0004-resilient-storage-and-terminal-status-bar.md)), and structural AST constraints (`no-restricted-syntax` enforcing pure re-export barrels in `src/modules/*/index.ts` and forbidding runtime values/declarations in `types.ts`). `eslint-plugin-boundaries` and overlapping layer/deep-import `no-restricted-imports` blocks remain removed because `dependency-cruiser` owns all inter-file boundaries. Dedicated CSS (`stylelint.config.mjs`) and Markdown (`.markdownlint-cli2.yaml`) linters own stylesheet and documentation linting.

### 3. Dead Code & Contract Hygiene (`knip.json`)

Runs `pnpm knip` (`knip && knip --production --dependencies --files`) with zero-tolerance error severity (`--max-issues 0` is Knip's default behavior across `files`, `dependencies`, `unlisted`, `unresolved`, `exports`, and `types`), `includeEntryExports: true`, and `treatConfigHintsAsErrors: true`. Built-in Next.js, Vitest, Playwright, ESLint, `dependency-cruiser`, Husky, and `lint-staged` plugins detect dead exports and types inside public `index.ts` barrels rather than exempting them as entry points. `knip.json` declares only standalone `.agents/hooks/` CLI entry points and separates production `src/` (`!`) from `.agents/`, `scripts/`, and `tests/` in `project`.

### 4. Layered Guardrail Stages

- **Stage 1 (Per-Edit Hook Removed)**: **Intentional Change from ADR-0010**: The `PostToolUse` / `PostInvocation` `auto-fix` Prettier hook in `.agents/hooks.json` is removed so per-edit formatting does not duplicate Stage 2/3/4 or shift line numbers mid-turn.
- **Stage 2 (Staged Commit — `.husky/pre-commit` & `.lintstagedrc.json`)**: **Intentional Change from ADR-0010**: `.husky/pre-commit` executes strictly `pnpm exec lint-staged` (removing repo-wide `typecheck`, `depcruise`, `knip`, and `adr:check` from pre-commit, and removing `vitest related` from `.lintstagedrc.json`). `.lintstagedrc.json` runs `eslint --fix --max-warnings 0` + `prettier --write` on staged JS/TS, `stylelint` + `prettier --write` on staged CSS, `markdownlint-cli2` + `prettier --write` on staged Markdown, and `prettier --write --ignore-unknown` on remaining staged files.
- **Stage 3 (Repository-Wide — `scripts/check.ts` & `package.json`)**: **Intentional Change from ADR-0010**: `scripts/check.ts` provides a zero-dependency staged-wave runner with three SSOT profiles:
  - `pnpm check:docs`: runs `format:check`, `lint:md`, and `adr:check` with bounded concurrency (`3`) (**restoring `format:check`** into repo-wide verification).
  - `pnpm check:code`: runs `next typegen` as a prep wave, then `lint`, `knip`, `tsc --noEmit`, `depcruise`, and `lint:css` with bounded concurrency (`3`).
  - `pnpm check:fast`: runs `next typegen` as a prep wave, then all `docs` + `code` static checks with bounded concurrency (`3`), followed by `test:unit` in its own dedicated wave so Vitest's worker pool does not contend with ESLint/TypeScript for CPU cores.
  - `pnpm check`: runs `pnpm check:fast && pnpm test:e2e`.
- **Stage 4 (GitHub CI — `.github/workflows/ci.yml`)**: Consumes the exact SSOT scripts (`pnpm check:docs` for docs-only changes; `pnpm check:fast` for code changes, plus parallel `pnpm test:e2e`) instead of duplicating individual linter commands.

## Confirmation and Enforcement

- **Parallel Repo Pipelines (`scripts/check.ts`, `package.json`)**: Verified via `pnpm check:docs`, `pnpm check:code`, `pnpm check:fast`, `pnpm check`, and hermetic unit tests in `scripts/tests/check.test.ts` and `scripts/tests/prettierignore-sync.test.ts`.
- **Staged Pre-Commit Hook (`.husky/pre-commit`, `.lintstagedrc.json`)**: Enforces staged formatting and per-file linting (`eslint`, `stylelint`, `markdownlint-cli2`, `prettier`) before commit creation.
- **GitHub Actions CI (`.github/workflows/ci.yml`)**: Enforces `pnpm check:docs` (docs-only) or `pnpm check:fast` + `pnpm test:e2e` (code changes) on every PR and push to `main`.
- **ADR Lifecycle Governance Tests (`.agents/skills/adr/tests/adr-cli.test.ts`)**: Hermetic Vitest suite verifies ADR scaffolding, superseding, path retargeting, module removal auto-deprecation, cryptographic locking, and README synchronization.

## Consequences

### Positive

- Every architectural boundary rule has a single owner, eliminating ESLint vs. `dependency-cruiser` duplication and rule drift.
- AI agents receive exact file-and-rule diagnostics when an import violates a module seam or layer boundary.
- `indicators-isolation` and `instruments-isolation` remain formally codified under active ADR governance.
- Black-box test and deep-import restrictions work at any directory nesting depth and cover `import type` edges via `tsPreCompilationDeps: true`.
- `pnpm knip` keeps public module contracts free of unused exports, orphaned files, and unreferenced dependencies.
- Parallel execution in `scripts/check.ts` cuts `pnpm check:fast` wall time more than in half while restoring `format:check` and keeping a single source of truth shared with GitHub Actions CI.
- Scoped `.husky/pre-commit` (`lint-staged` only) keeps commits fast and supports partial (`git add -p`) commits without repo-wide false positives.

### Negative

- Static analysis tools (`eslint`, `stylelint`, `markdownlint-cli2`, `depcruise`, `knip`) still determine the critical-path duration of `pnpm check:fast` (~35–40s).
- Boundary, cycle, dead-code, and typecheck violations are caught by `pnpm check:code` / `pnpm check:fast` / GitHub CI rather than live ESLint squiggles or `git commit` pre-commit hooks.
- Adding a new architectural layer or module category requires updating `.dependency-cruiser.cjs` (whereas `eslint.config.mjs` no longer requires layer or boundary updates).

## Rejected Alternatives

- **Prompt-Only Architectural Guidelines**: Human and AI developers inevitably introduce accidental deep imports, circular dependencies, or unused exports without automated mechanical enforcement.
- **Maintaining Duplicate Rules in Both ESLint and `dependency-cruiser`**: Causes ongoing drift whenever modules or rules change, as seen with `indicators` and `instruments` isolation.
- **Single-Tool Enforcement (ESLint Alone Without `dependency-cruiser` and `knip`)**: ESLint operates file-by-file and cannot efficiently detect multi-hop circular dependencies, graph-wide architectural isolation, or workspace-wide unused exports and dead code.
- **Keeping Repo-Wide Gates (`typecheck`, `depcruise`, `knip`, `adr:check`) in `.husky/pre-commit`**: Redundantly re-runs checks already executed by `pnpm check:fast` and GitHub CI, slows every commit, and breaks partial (`git add -p`) commits.
- **Using `eslint --concurrency auto` or `--cache` with Type-Checked Rules**: Benchmarking showed `--concurrency auto` is slower (42.2s vs. 35.2s) due to TS `projectService` worker startup, and `--cache` is unsound across cross-file type changes.
- **Unconstrained Parallel Execution of `eslint` + `vitest` + All Static Gates**: Running all 9 tasks concurrently saturated CPU cores on Windows, slowing `eslint` and `vitest` and causing timeouts in `spool.test.ts`; bounded concurrency (`3`) for static checks followed by a dedicated `test:unit` wave avoids contention.

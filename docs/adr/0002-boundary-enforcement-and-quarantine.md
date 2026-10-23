# ADR-0002: Automated Boundary Enforcement & Strangler Quarantine

- **Status:** Accepted
- **Date:** 2026-10-24
- **Deciders:** System Architect, Core Team

## Context

A core hazard when developing modular systems with autonomous AI agents is architectural drift: agents can easily introduce deep imports (`@/src/modules/foo/model/bar`), circular dependencies, or cross-widget coupling if boundaries are only described in prompts rather than mechanically enforced.

Furthermore, migrating from legacy horizontal folders (`app/types`, `app/components`, etc.) to `src/modules/` without downtime or breaking existing features requires a phased Strangler Fig pattern. During migration, new modular code must never import legacy code, while legacy shell code may temporarily consume new modules until fully replaced.

## Decision

We establish automated compile-time and lint-time boundary enforcement using three tools integrated into `pnpm check:fast` and `pnpm check`:

1. **`eslint-plugin-boundaries`:**
   - Enforces element classification: `app`, `composition`, `module`, and `shared`.
   - Prevents `shared` from importing `modules`, `composition`, or `app`.
   - Prevents `modules` from importing `composition` or `app`.
   - Replaced deep internal imports with public module entry point enforcement.

2. **`dependency-cruiser`:**
   - Detects circular dependencies (`no-circular`).
   - Enforces widget isolation: `chart`, `order-book`, and `time-and-sales` cannot depend on one another or on `workspace`.
   - Enforces workspace independence: `workspace` cannot depend directly on concrete widgets (receives widget registries via contracts).
   - Validates unidirectional layer flow (`app` -> `composition` -> `modules` -> `shared`).

3. **`knip`:**
   - Detects dead code, unused exports, and unreferenced packages to maintain a clean codebase during and after AI refactoring passes.

4. **Unilateral Quarantine Rule:**
   - Files in `src/**` are strictly forbidden from importing anything from `app/**` via ESLint (`no-restricted-imports`) and `dependency-cruiser`.
   - Legacy files in `app/**` may import from `src/**` until all legacy folders are drained and deleted in Step 1.6.

## Consequences

### Positive

- Violations are intercepted immediately during code editing (`ESLint`) and pre-commit checks (`pnpm check:fast`).
- Clean, one-way migration gradient ensures new modules remain completely free of legacy technical debt.
- No accidental widget coupling or cross-domain leaks.

### Negative

- Linter and dependency graph checks add a small overhead to verification runs.
- Strict entry points require explicit re-exports in `src/modules/<name>/index.ts`.

## Rejected Alternatives

- **Relying solely on agent prompts:** Human and AI developers eventually make accidental deep imports without automated tooling.
- **Big-bang migration:** Moving all files at once risks regressions and breaks continuous test verification.

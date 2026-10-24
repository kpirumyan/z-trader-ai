# ADR-0002: Automated Architectural Boundary Enforcement

- **Status:** Accepted
- **Date:** 2026-10-24
- **Deciders:** System Architect, Core Team

## Context

A core hazard when developing modular systems with autonomous AI agents is architectural drift: agents can easily introduce deep imports (`@/src/modules/foo/model/bar`), circular dependencies, or cross-widget coupling if boundaries are only described in prompts rather than mechanically enforced.

The target architecture defines strict separation between Next.js application shell/routing (`app/`), composition root (`src/composition/`), domain modules (`src/modules/`), and shared foundation (`src/shared/`). Mechanical tooling is necessary to prevent layer violations and maintain codebase integrity.

## Decision

We establish automated compile-time and lint-time boundary enforcement using three tools integrated into `pnpm check:fast` and `pnpm check`:

1. **`eslint-plugin-boundaries`:**
   - Enforces element classification: `app`, `composition`, `module`, and `shared`.
   - Prevents `shared` from importing `modules`, `composition`, or `app`.
   - Prevents `modules` from importing `composition` or `app`.
   - Replaces deep internal imports with public module entry point enforcement.

2. **`dependency-cruiser`:**
   - Detects circular dependencies (`no-circular`).
   - Enforces widget isolation: `chart`, `order-book`, and `time-and-sales` cannot depend on one another or on `workspace`.
   - Enforces workspace independence: `workspace` cannot depend directly on concrete widgets (receives widget registries via contracts).
   - Validates unidirectional layer flow (`app` -> `composition` -> `modules` -> `shared`).

3. **`knip`:**
   - Detects dead code, unused exports, and unreferenced packages to maintain a clean codebase during and after AI refactoring passes.

4. **App Shell Layer Isolation:**
   - Code in `src/**` is strictly forbidden from importing anything from `app/**` via ESLint (`no-restricted-imports`) and `dependency-cruiser`.
   - `app/` is strictly for Next.js routing and global styling (`layout.tsx`, `page.tsx`, `globals.css`). Any legacy files temporarily remaining in `app/` are obsolete and to be deleted as new units are implemented under `src/`.

## Consequences

### Positive

- Violations are intercepted immediately during code editing (`ESLint`) and pre-commit checks (`pnpm check:fast`).
- Clean, unidirectional dependency graph ensures modules and shared code remain completely free of routing or legacy coupling.
- No accidental widget coupling or cross-domain leaks.

### Negative

- Linter and dependency graph checks add a small overhead to verification runs.
- Strict entry points require explicit re-exports in `src/modules/<name>/index.ts`.

## Rejected Alternatives

- **Relying solely on agent prompts:** Human and AI developers eventually make accidental deep imports without automated tooling.
- **Treating legacy code as a permanent layer with permanent quarantine rules:** Legacy implementation is strictly obsolete and slated for deletion, not a permanent architectural layer.

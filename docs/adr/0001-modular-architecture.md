# ADR-0001: Modular Architecture & Vertical Domain Slices

- **Status:** Accepted
- **Date:** 2026-10-24
- **Deciders:** System Architect, Core Team

## Context

Z-Trader is growing toward a comprehensive financial market trading terminal (featuring real-time charts, custom indicators, market depth, order routing, and autonomous bot connectivity). The codebase is developed largely by AI agents operating under strict Test-Driven Development (TDD).

The initial codebase used horizontal technical partitioning (`app/types`, `app/constants`, `app/hooks`, `app/components`). As terminal features expanded, this horizontal structure caused friction:

1. Coupling across unrelated components through flat shared folders.
2. Inability to replace or refactor an entire feature without touching several disjoint directories.
3. Lack of strict encapsulation around feature state and internal presentation components.

## Decision

We migrate Z-Trader to a vertical modular architecture structured under `src/modules/<name>/`, accompanied by a composition root (`src/composition/`), a shared foundation layer (`src/shared/`), and minimal Next.js routing in `app/`.

### 1. Module Structure & Black-Box Perimeter

Each domain module (`src/modules/<name>/`) is split into a **contract perimeter** and **replaceable implementation**:

```text
src/modules/<name>/
├── index.ts        # Contract perimeter: ONLY re-exports of public API symbols and types
├── README.md       # Module passport: responsibilities, contract, dependencies, invariants
├── tests/          # Black-box behavioral unit tests: imports ONLY from ../index.ts
│
├── types.ts        # Internal TS types (no runtime code)
├── constants.ts    # Internal constants and default configuration
├── schema.ts       # Runtime validation schemas (e.g., Zod)
├── model/          # Domain logic, state management (Zustand), services, and hooks
└── ui/             # Presentation React components
```

### 2. Composition Root & Shared Foundation

- `src/composition/`: The single orchestration root that imports public module seams (`widgets.ts`, `indicators.ts`, `providers.ts`).
- `src/shared/`: Domain-agnostic foundation code (`contracts/`, `theme/`, `storage/`, `ui/`, `lib/`). `shared/` is strictly unidirectional and must never depend on modules, composition, or routing.
- `app/`: Contains only Next.js routing (`layout.tsx`, `page.tsx`) and global styling (`globals.css`).

### 3. Replaceable Internals ("Replace Rather Than Fix")

If a module's internal implementation (`model/`, `ui/`) degrades or becomes obsolete, its contents can be safely wiped and regenerated from scratch against its unchanged contract perimeter (`index.ts`, `README.md`) and black-box tests (`tests/`).

## Consequences

### Positive

- High cohesion and complete encapsulation per domain slice.
- Independent evolvability and testability for widgets (`chart`, `order-book`, `time-and-sales`).
- Clear separation between the contract perimeter (Architect/Tester) and internal implementation (Coder).

### Negative

- Requires strict automated tooling to prevent deep imports and enforce unidirectional layers.
- Requires migration via the Strangler Fig pattern from legacy `app/` folders.

## Rejected Alternatives

- **Monorepo with pnpm workspaces / packages:** Adds excessive build tooling complexity and version management overhead for a single Next.js terminal application.
- **Retaining horizontal folders (`app/components`, etc.):** Led to diffuse responsibilities and made feature boundary preservation unenforceable by linting rules.

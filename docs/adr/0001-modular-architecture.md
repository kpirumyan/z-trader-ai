---
id: "ADR-0001"
title: "Modular Architecture & Vertical Domain Slices"
status: "accepted"
date: "2026-10-24"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "Architecture & Layout"
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
supersedes: null
superseded_by: null
---

# ADR-0001: Modular Architecture & Vertical Domain Slices

## Context and Problem Statement

Z-Trader is a high-performance multi-window financial trading and market analysis terminal (real-time charts, custom indicators, Level 2 market depth, Time & Sales tape, and instrument discovery) developed under strict Test-Driven Development (TDD) with AI coding agents.

Horizontal technical partitioning (`app/types`, `app/constants`, `app/hooks`, `app/components`) causes architectural friction as terminal capabilities scale:

1. Implicit coupling across unrelated widgets through flat shared folders.
2. Inability to replace or refactor an isolated domain feature without touching several disjoint directories.
3. Lack of a strict black-box perimeter separating a feature's public contract from its internal state and UI implementation.

How should we structure the codebase to guarantee strict domain encapsulation, unidirectional dependencies, and safe module-level replacement?

## Decision Drivers

- **Strict Black-Box Encapsulation**: Each domain capability must expose a single, minimal public entry point (`index.ts`) while hiding internal state, hooks, and UI components.
- **Unidirectional Dependency Flow**: Shared foundation utilities must never depend on domain modules, and domain widgets must never couple directly to one another or to the routing shell.
- **Replaceable Internals ("Replace Rather Than Fix")**: An AI agent or developer must be able to wipe and regenerate a module's internal implementation (`model/`, `ui/`) against its unchanged contract perimeter (`index.ts`, `README.md`, `tests/`).

## Decision Outcome

Chosen option: **Vertical Modular Architecture with Contract Perimeters**, organizing the codebase into `src/modules/<name>/`, a composition root (`src/composition/`), a shared foundation layer (`src/shared/`), and a minimal Next.js routing shell (`src/app/`).

### 1. Module Structure & Black-Box Perimeter

Each domain module (`src/modules/<name>/`) is split into a **contract perimeter** and **replaceable internal implementation**:

```text
src/modules/<name>/
├── index.ts        # Contract perimeter: ONLY re-exports of public API symbols and types
├── README.md       # Module passport: responsibilities, contract, dependencies, invariants, governing ADRs
├── tests/          # Black-box behavioral unit tests: imports ONLY from ../index.ts
│
├── types.ts        # Internal TS types (no runtime code)
├── constants.ts    # Internal constants and default configuration
├── schema.ts       # Runtime validation schemas (Zod)
├── model/          # Domain logic, state management (Zustand), services, and hooks
└── ui/             # Presentation React components and co-located *.module.css
```

### 2. Four-Layer Unidirectional Topology

- `src/app/`: Next.js routing shell (`layout.tsx`, `page.tsx`) and global root stylesheet (`globals.css`). Imports only from `src/composition/` and `src/shared/`.
- `src/composition/`: The single orchestration root (`terminal.tsx`, `widgets.ts`) that wires concrete domain widgets into the workspace window manager.
- `src/modules/`: Vertical domain slices (`workspace`, `instruments`, `market-data`, `indicators`, `chart`, `order-book`, `time-and-sales`).
- `src/shared/`: Domain-agnostic foundation segments (`contracts/`, `theme/`, `storage/`, `lib/`). Strictly unidirectional; never imports from `modules`, `composition`, or `app`.

### 3. Replaceable Internals ("Replace Rather Than Fix")

If a module's internal implementation (`model/`, `ui/`) degrades or requires redesign, its internals can be safely regenerated from scratch against its unchanged contract perimeter (`index.ts`, `README.md`) and black-box behavioral test suite (`tests/`).

## Confirmation and Enforcement

- **ESLint Boundary & Syntax Rules (`eslint.config.mjs`)**:
  - Enforces layer import policies via `eslint-plugin-boundaries`.
  - Forbids deep imports into module internals (`@/src/modules/*/*`) across production and test files.
  - Enforces re-export-only module entry points (`src/modules/*/index.ts`) and pure type declarations in `types.ts`.
- **Dependency Graph Validation (`.dependency-cruiser.cjs`)**:
  - Validates unidirectional layer flow (`app` -> `composition` -> `modules` -> `shared`) and widget isolation via `pnpm depcruise`.
- **Dead Export Detection (`knip.json`)**:
  - Verifies zero unused exports, types, or files across module entry points via `pnpm knip`.

## Consequences

### Positive

- High cohesion and strict encapsulation keep each domain slice independently understandable and testable.
- Widgets (`chart`, `order-book`, `time-and-sales`) evolve independently without cross-widget coupling.
- The separation between the contract perimeter (`index.ts`, `README.md`, `tests/`) and internal implementation (`model/`, `ui/`) prevents AI coding agents from leaking implementation details.

### Negative

- Every public symbol must be explicitly re-exported through `src/modules/<name>/index.ts`.
- Cross-widget communication must route through shared contracts (`src/shared/contracts/`) and composition wiring rather than direct imports.

## Rejected Alternatives

- **Monorepo with `pnpm` Workspaces / Separate Packages**: Multi-package build orchestration and version synchronization add unnecessary overhead for a single Next.js terminal application.
- **Horizontal Technical Folders (`app/components`, `app/hooks`, `app/types`)**: Flat technical directories caused diffuse ownership and prevented mechanical boundary enforcement.

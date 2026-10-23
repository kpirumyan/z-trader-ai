---
trigger: model_decision
description: Modular codebase layout standard enforcing separation between domain modules, shared foundation, composition root, and black-box contract perimeters
---

# Codebase Layout

<rule id="codebase-layout" severity="MANDATORY">
  <summary>Enforce strict separation between domain modules (src/modules/[name]/), shared foundation (src/shared/), composition root (src/composition/), app routing (app/), and black-box tests.</summary>
  <list type="checklist">
    <item>`src/modules/[name]/`: vertical domain slices with strict encapsulation:
      - `index.ts`: public contract perimeter re-exporting symbols and types. External consumers must import only from `@/src/modules/[name]` (deep imports `@/src/modules/[name]/*` are forbidden).
      - `README.md`: module passport (purpose, public contract, allowed dependencies, behavioral invariants).
      - `types.ts`: TypeScript types/interfaces only (no runtime code or functions).
      - `constants.ts`: immutable defaults and static configurations.
      - `schema.ts`: runtime data validation schemas.
      - `model/`: internal domain logic, state management (Zustand), services, and custom hooks.
      - `ui/`: presentation React components.
      - `tests/`: black-box behavioral unit tests importing strictly from the public seam (`../index` or `@/src/modules/[name]`), never internal files.
    </item>
    <item>`src/shared/`: domain-agnostic foundation (`contracts/`, `theme/`, `storage/`, `ui/`, `lib/`). Must never import from `modules/` or `composition/`.</item>
    <item>`src/composition/`: composition root (`widgets.ts`, `indicators.ts`, `providers.ts`) wiring modules together.</item>
    <item>`app/`: Next.js routing and global styling only (`layout.tsx`, `page.tsx`, `globals.css`). No business logic or domain types.</item>
    <item>`tests/e2e/`: browser-level integration and user journey tests. Production code must never import from `tests/`.</item>
    <item>Widget isolation: terminal widgets (`chart`, `order-book`, `time-and-sales`) must never depend on each other and never depend on `workspace`. `workspace` never imports concrete widgets directly.</item>
    <item>Quarantine: code in `src/**` is strictly forbidden from importing anything from `app/**`.</item>
  </list>
</rule>

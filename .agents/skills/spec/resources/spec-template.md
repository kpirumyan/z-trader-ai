---
name: <task-name>
type: module # module | shared | composition | app | fix
status: draft # draft | approved (ephemeral: deleted upon task completion in build)
target_path: src/modules/<name> # e.g. src/modules/<name>, src/shared/<path>, src/composition, app/
composition_point: src/composition/widgets.ts # src/composition/widgets.ts | src/composition/providers.ts | none
e2e_required: true # true | false
---

# Specification: <task-name>

## 1. Purpose & Scope

### 1.1 In-Scope Responsibilities
- Primary functional or architectural goal and business value.
- Core capabilities or fixes introduced by this task.

### 1.2 Non-Goals & Out-of-Scope
- Explicit boundaries: what this task will NOT touch or implement.
- Delegated responsibilities.

### 1.3 Architectural Invariants
- **Layer & Boundary Rules**:
  - `src/modules/*`: Vertical slice encapsulation. Consumers import strictly from `@/src/modules/<name>` (deep imports into internals are strictly forbidden). Widgets must not import each other or `workspace`.
  - `src/shared/*`: Unidirectional foundation rule (ZERO imports from `src/modules/*`, `src/composition/*`, or `app/*`). Consumers import from `@/src/shared/<path>`.
  - `app/*`: Shell layer rule (code in `src/**` never imports from `app/**`).
- Internal implementation files are strictly private; external consumers import only from public seams (`index.ts`).

---

## 2. Public Contract Perimeter

### 2.1 Types (`<target_path>/types.ts`)
```typescript
// Pure TypeScript types/interfaces only (no runtime code or functions)
export interface ExampleData {
  id: string;
  timestamp: number;
}
```

### 2.2 Validation Schema (`<target_path>/schema.ts`)
*(Optional. If unit does not define runtime schemas, mark as `N/A: Non-applicable`. Never invent artificial schemas just to fill this section)*
```typescript
import { z } from "zod";

export const exampleDataSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
});
```

### 2.3 Constants (`<target_path>/constants.ts`)
*(Optional. If unit has no static configurations or immutable defaults, mark as `N/A: Non-applicable`. Never create dummy config objects)*
```typescript
export const DEFAULT_CONFIG = {
  refreshIntervalMs: 1000,
} as const;
```

### 2.4 Re-exports (`<target_path>/index.ts`)
```typescript
// Public seam: ONLY re-exports, no inline implementations
export type { ExampleData } from "./types";
export { exampleDataSchema } from "./schema";
export { DEFAULT_CONFIG } from "./constants";
```

---

## 3. Core Logic & State Management

### 3.1 State Shape & Actions (or Core Adapters / Fix Details)
- State definition, mutators, actions, or algorithm adapters.

### 3.2 Side Effects & Lifecycles
- Subscriptions, event listeners, and unmount cleanups.

---

## 4. UI Presentation & Styling (or [N/A: Non-visual])

*(If the task does not touch visual elements, mark this section as `N/A: Non-visual target`)*

### 4.1 Component Decomposition
- Root components and subcomponents.

### 4.2 Visual Tokens & Themes (`DESIGN.md`)
- Canvas, surface, borders, text, and accent tokens.
- Dual-theme (Dark / Light) invariant verification.

### 4.3 Component States
- Empty, Loading, Error, and Active/Focused states.

---

## 5. Black-Box Behavioral Test Scenarios

> [!NOTE]
> Tests import strictly from the public seam (`@/<target_path>` or relative index). Specify scenarios in Given-When-Then format covering default states, actions, boundary cases, and regression reproduction for bugfixes.
>
> **Anti-Tautology Invariants**:
> - **No pure type assertions**: Never specify runtime test scenarios for pure TypeScript types or interfaces lacking runtime logic (verified statically by `tsc`).
> - **No 3rd-party library re-testing**: For thin wrapper proxies (e.g. `cn` wrapping `clsx`), restrict to a single integration smoke test; never replicate the library's feature test suite.
> - **Focus on real domain behavior**: Prioritize custom schema transformations (e.g. `.trim()`, `.refine()`), boundary failures, state mutations, and cross-constant exhaustive mapping.

### Scenario: [Brief Descriptive Title]
- **Given:** [Precondition, initial state, or mock setup]
- **When:** [Action, user event, or incoming stream update]
- **Then:** [Expected state mutation, rendered view update, or error assertion]

---

## 6. Wiring & Integration

### 6.1 Composition Point
- Target file: `src/composition/widgets.ts`, `src/composition/providers.ts`, or `none`.
- Registration snippet or exported provider definition (if applicable).

### 6.2 E2E Integration Test Requirement
- Playwright E2E required: `true` / `false`.
- If true, brief scenario description in `tests/e2e/<task-name>.spec.ts`.

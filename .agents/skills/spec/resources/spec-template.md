---
name: <task-name>
type: module # module | shared | composition | app | fix
status: draft # draft | approved
target_path: src/modules/<name> # e.g. src/modules/<name>, src/shared/<segment>, src/composition, app/
composition_point: src/composition/<registry>.ts # or none
e2e_required: true # true | false
---

# Specification: <task-name>

## 1. Purpose & Scope

- **Goal**: Primary functional or architectural objective and core capabilities introduced by this task.
- **Boundaries**: Explicit scope limits and delegated responsibilities (what this unit does not handle).
- **Applicable ADRs**: Links to active records in `docs/adr/` (or `None`).
- **Allowed Dependencies**: Explicit list of `@/src/shared/*`, `@/src/modules/*`, or external packages permitted for this unit.

---

## 2. Public Contract Perimeter

### 2.1 Types (`<target_path>/types.ts`)
```typescript
// Pure TypeScript types/interfaces only (no runtime code)
export interface ExampleData {
  id: string;
  timestamp: number;
}
```

### 2.2 Validation Schema (`<target_path>/schema.ts` or `N/A: Non-applicable`)
```typescript
import { z } from "zod";

export const exampleDataSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
});
```

### 2.3 Constants (`<target_path>/constants.ts` or `N/A: Non-applicable`)
```typescript
export const DEFAULT_CONFIG = {
  refreshIntervalMs: 1000,
} as const;
```

### 2.4 Public Seam & Exports (`<target_path>/index.ts`)
```typescript
// Public seam: re-exports + exact TypeScript signatures of exported functions, hooks, stores, or components (no implementation bodies)
export type { ExampleData } from "./types";
export { exampleDataSchema } from "./schema";
export { DEFAULT_CONFIG } from "./constants";
export declare function createExampleService(config?: typeof DEFAULT_CONFIG): ExampleData;
```

---

## 3. Core Logic & State Management

### 3.1 State Shape & Actions (or Core Adapters / Fix Details)
- State definition, mutators, actions, or algorithm adapters.

### 3.2 Side Effects & Lifecycles (or `N/A`)
- Subscriptions, event listeners, concurrency invariants, and unmount cleanups.

---

## 4. UI Presentation & Styling (or `N/A: Non-visual target`)

### 4.1 Component Decomposition
- Root components and subcomponents.

### 4.2 Visual Tokens & Themes (`DESIGN.md`)
- Canvas, surface, borders, text, and accent tokens.
- Dual-theme (Dark / Light) invariant verification.

### 4.3 Component States
- Empty, Loading, Error, and Active/Focused states.

---

## 5. Black-Box Behavioral Test Scenarios

### SC-01: <Observable Behavior Description>
- **Given:** <Precondition, initial state, or boundary mock setup>
- **When:** <Caller action, user event, or incoming stream update>
- **Then:** <Expected state mutation, rendered view update, or error assertion>

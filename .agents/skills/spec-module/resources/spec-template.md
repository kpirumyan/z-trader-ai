---
module: <module-name>
type: widget # widget | domain-slice | service
status: draft # draft | approved | implemented
composition_point: src/composition/widgets.ts # or indicators.ts, providers.ts
e2e_required: true # true | false
---

# Module Specification: <module-name>

## 1. Purpose and Boundaries

### 1.1 In-Scope Responsibilities
- Primary domain purpose and business value.
- Core functions performed by this module.

### 1.2 Non-Goals & Out-of-Scope
- Explicit boundaries: what this module will NOT do.
- Responsibilities delegated to other modules or shared foundation.

### 1.3 Architectural Invariants
- Vertical slice isolation: no direct imports from other `src/modules/*`.
- External consumers import strictly from `@/src/modules/<module-name>`.
- Internal implementation files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) are private.

---

## 2. Public Contract Perimeter

### 2.1 Types (`src/modules/<module-name>/types.ts`)
```typescript
// Pure TypeScript types/interfaces only (no runtime code or functions)
export interface ExampleData {
  id: string;
  timestamp: number;
}
```

### 2.2 Validation Schema (`src/modules/<module-name>/schema.ts`)
```typescript
import { z } from "zod";

export const exampleDataSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
});
```

### 2.3 Constants (`src/modules/<module-name>/constants.ts`)
```typescript
export const DEFAULT_CONFIG = {
  refreshIntervalMs: 1000,
} as const;
```

### 2.4 Re-exports (`src/modules/<module-name>/index.ts`)
```typescript
// Contract perimeter: ONLY re-exports, no inline implementations
export type { ExampleData } from "./types";
export { exampleDataSchema } from "./schema";
export { DEFAULT_CONFIG } from "./constants";
export { ExampleWidget } from "./ui/example-widget";
```

---

## 3. Domain Model (`model/`)

### 3.1 Zustand Store Shape & Actions
- State definition:
  - Properties, initial values.
- Actions:
  - State mutators, synchronous/asynchronous logic.
- Selectors:
  - Memoized selectors for view consumption.

### 3.2 Side Effects & Hooks
- Subscription lifecycles (e.g. streaming market data, cleanup).
- Custom React hooks: `use<Feature>Store`, `use<Feature>Data`.

---

## 4. UI Presentation & Styling (`ui/`)

### 4.1 Component Decomposition
- Root component (e.g. `<FeatureWidget />`).
- Subcomponents (e.g. `<FeatureHeader />`, `<FeatureList />`, `<FeatureToolbar />`).

### 4.2 Visual Tokens & Themes (`DESIGN.md`)
- Canvas / Surface tokens: `surface`, `surface-raised`, `border`, `brand-gold`.
- Typography: Geist for text, JetBrains Mono for prices, numerical feeds, and time.
- Dark & Light theme invariant verification.

### 4.3 Component States
- Empty state: zero-data presentation.
- Loading state: skeleton or indicator.
- Error state: inline retryable notice.
- Active/Focused state: golden accent line/border per `DESIGN.md`.

---

## 5. Black-Box Behavioral Test Scenarios (`tests/`)

> [!NOTE]
> Tests import strictly from `@/src/modules/<module-name>` or `../index`. Specify as many scenarios as needed to cover the module contract (default state, user actions, error handling, edge cases) in Given-When-Then format.

### Scenario: [Brief Descriptive Title]
- **Given:** [Precondition, initial state, or mock setup]
- **When:** [Action, user event, or incoming stream update]
- **Then:** [Expected state mutation, rendered view update, or error state]

---

## 6. Composition Registration (`src/composition/`)

### 6.1 Target Registry Point
- Target file: `src/composition/widgets.ts` (or `indicators.ts`, `providers.ts`).

### 6.2 Widget / Slice Metadata
```typescript
// Registration metadata for window manager
export const widgetDefinition = {
  id: "<module-name>",
  title: "<Widget Title>",
  defaultWidth: 400,
  defaultHeight: 300,
  minWidth: 250,
  minHeight: 180,
};
```

### 6.3 E2E Integration Test Requirement
- Playwright E2E required: `true` / `false`.
- If true, brief scenario description in `tests/e2e/<module-name>.spec.ts`.

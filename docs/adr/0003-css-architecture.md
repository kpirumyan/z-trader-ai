---
id: "ADR-0003"
title: "CSS Modules, Design Tokens & Styling Standard"
status: "accepted"
date: "2026-10-24"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "UI & Styling"
applies_to:
  - "src/app/globals.css"
  - "src/shared/theme"
  - "src/shared/lib"
  - "src/modules/chart"
  - "src/modules/instruments"
  - "src/modules/order-book"
  - "src/modules/time-and-sales"
  - "src/modules/workspace"
enforced_by:
  - "src/shared/theme/tests/theme.test.tsx"
  - "src/shared/lib/tests/cn.test.ts"
supersedes: null
superseded_by: null
---

# ADR-0003: CSS Modules, Design Tokens & Styling Standard

## Context and Problem Statement

Z-Trader is a high-density financial trading terminal built on Next.js 16 and React 19 that renders high-frequency market updates (up to 60 FPS tick bursts) across multiple concurrent windows.

Storing component styles in a monolithic global stylesheet (`src/app/globals.css`) or using runtime CSS-in-JS creates severe architectural friction:

1. **Broken Module Encapsulation**: Deleting or replacing a vertical module (`src/modules/<name>/`) leaves orphaned style rules behind in global stylesheets.
2. **Naming Collisions**: Global CSS requires verbose BEM prefixes (`.terminal-window-heading`, `.order-book-cell`) to avoid cross-widget selector collisions.
3. **Runtime Overhead**: Runtime CSS-in-JS libraries (Emotion, styled-components) trigger style recalculation and garbage collection pauses during high-frequency streaming updates.

Which styling architecture should we adopt to guarantee zero runtime JS overhead, strict vertical slice encapsulation, and consistent dark/light theme token usage?

## Decision Drivers

- **Zero Runtime Overhead**: Styling must compile to static CSS with 0ms JavaScript execution overhead during 60 FPS market tick bursts.
- **Vertical Slice Co-location**: Every UI component's styles must live inside its owning module so deleting or replacing a module folder cleanly removes 100% of its CSS footprint.
- **Strict Design Token Fidelity**: All colors, surfaces, borders, and typography must reference semantic CSS custom properties defined in [`DESIGN.md`](../../DESIGN.md) rather than hardcoded hex values.

## Decision Outcome

Chosen option: **CSS Modules (`*.module.css`) + CSS Custom Properties (`src/shared/theme/tokens.css`) + `cn()` Class Utility (`src/shared/lib/cn.ts`)**.

### 1. Design Tokens Placement (`src/shared/theme/tokens.css`)

All semantic design tokens specified in [`DESIGN.md`](../../DESIGN.md) (canvas, surface, surface-raised, borders, typography, brand gold, and market buy/sell colors for both dark and light themes) reside in `src/shared/theme/tokens.css`:

- `src/app/globals.css` imports `tokens.css` globally and contains only baseline HTML/body resets and root viewport shell rules.
- Presentation components never hardcode raw hex/RGB palette values; they consume CSS custom properties (`var(--canvas)`, `var(--surface)`, `var(--brand-gold)`, `var(--market-buy)`, `var(--market-sell)`).

### 2. Co-located Component Scoped Styles (`*.module.css`)

All presentation components inside `src/modules/<name>/ui/` and `src/shared/<segment>/` co-locate their styles in adjacent `*.module.css` files (e.g., `order-book-widget.tsx` and `order-book-widget.module.css`).

Because CSS Modules automatically generate locally scoped class hashes, class names inside `*.module.css` use **concise semantic identifiers** instead of redundant BEM prefixes:

```css
/* Good (concise semantic): */
.root { display: flex; }
.button { height: 26px; }
.active { border-color: var(--brand-gold); }

/* Bad (redundant BEM inside scoped module): */
.theme-toggle-root { ... }
.theme-toggle__button { ... }
```

### 3. Dynamic Class Names Facade (`cn` in `src/shared/lib/cn.ts`)

Conditional class names are constructed via the `cn(...classes: ClassValue[])` facade exported from `@/src/shared/lib` (wrapping `clsx`), preventing error-prone string concatenation or accidental `"false"` class tokens in the DOM:

```tsx
import { cn } from "@/src/shared/lib";
import styles from "./order-book-row.module.css";

<div className={cn(styles.row, { [styles.active]: isSelected })} />;
```

## Confirmation and Enforcement

- **Theme & Token Contract Tests (`src/shared/theme/tests/theme.test.tsx`)**: Verifies theme persistence, attribute synchronization (`data-theme`), and design token integration.
- **Class Utility Unit Tests (`src/shared/lib/tests/cn.test.ts`)**: Verifies deterministic conditional class composition via `cn()`.
- **Dead File Detection (`knip.json` & TypeScript)**: Ensures unused modules and broken imports fail `pnpm check:fast`.

## Consequences

### Positive

- Modules own their styles completely, preserving vertical slice encapsulation ([ADR-0001](./0001-modular-architecture.md)).
- Static CSS compilation incurs zero runtime JavaScript overhead during high-frequency market streaming.
- Native Next.js CSS Modules require zero third-party bundler plugins and work seamlessly with React 19 and React Compiler.

### Negative

- Each styled component requires an adjacent `*.module.css` file and explicit `styles` import in TSX.
- HTML5 Canvas libraries that do not read CSS variables directly must synchronize with theme tokens through explicit palette mappings (see [ADR-0006](./0006-canvas-charting-and-lightweight-charts.md)).

## Rejected Alternatives

- **Runtime CSS-in-JS (Emotion, styled-components)**: Incompatible with React Server Components in Next.js App Router and causes garbage-collection pauses during high-frequency market tick updates.
- **Tailwind CSS v4**: Long utility class strings reduce readability in dense financial table/canvas JSX and obscure semantic token names from `DESIGN.md`.
- **Monolithic `src/app/globals.css`**: Global stylesheets break module encapsulation and risk class name collisions across widgets.

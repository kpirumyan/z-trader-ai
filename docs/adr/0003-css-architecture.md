# ADR-0003: CSS Modules, Design Tokens, and Component Styling

- **Status:** Accepted
- **Date:** 2026-10-24
- **Deciders:** System Architect, Core Team

## Context

Z-Trader is a high-performance financial trading terminal (real-time charts, depth of market, order routing, streaming quotes) built on Next.js 16 and React 19.

The initial implementation stored all component styling in a single monolithic stylesheet (`app/globals.css`, 635+ lines). With the transition to a modular vertical slice architecture ([ADR-0001](./0001-modular-architecture.md)), keeping all styles in a global file creates severe architectural friction:

1. **Broken Encapsulation:** Deleting or rewriting a vertical module (`src/modules/<name>/`) leaves dead styles behind in `globals.css`.
2. **Naming Collisions & Global Leakage:** Global class names require artificial BEM prefixes (`.terminal-window-heading`, `.order-book-cell`) to avoid unintentional collisions across widgets.
3. **Performance Invariants:** Financial terminals receive high-frequency tick bursts (up to 60fps streaming updates). Runtime CSS-in-JS solutions (Emotion, styled-components) cause repeated style recalculations, bundle bloat, and garbage collection pauses.

## Decision

We establish **CSS Modules (`*.module.css`) + CSS Custom Properties (Design Tokens)** as the official styling architecture for Z-Trader.

### 1. Design Tokens Placement (`src/shared/theme/tokens.css`)

All design tokens specified in [`DESIGN.md`](../../DESIGN.md) (canvas, surface, borders, typography, brand gold, market buy/sell colors for both light and dark themes) reside in `src/shared/theme/tokens.css`.

- The theme segment owns all token definitions.
- `app/globals.css` (or `app/layout.tsx`) imports `tokens.css` globally.
- Components never hardcode hex colors or rogue palette values; they consume CSS variables (`var(--canvas)`, `var(--brand-gold)`).

### 2. Component Scoped Styles (`*.module.css`)

All presentation components inside `src/modules/<name>/ui/` and `src/shared/<segment>/ui/` must co-locate their styling in adjacent `*.module.css` files (e.g., `theme-toggle.tsx` and `theme-toggle.module.css`).

#### Class Naming Convention

Because CSS Modules automatically generate locally scoped, unique class hashes, class names inside `*.module.css` must use **concise semantic identifiers** instead of redundant BEM prefixes:

```css
/* Good (concise semantic): */
.root { display: flex; }
.button { height: 26px; }
.active { border-color: var(--brand-gold); }

/* Bad (redundant BEM inside scoped module): */
.theme-toggle-root { ... }
.theme-toggle__button { ... }
```

### 3. Dynamic Class Names Utility (`clsx` via `src/shared/lib/cn.ts`)

To avoid error-prone template string concatenations and accidental `"false"` class strings in the DOM, conditional classes are constructed via the `cn()` facade exported from `@/src/shared/lib`:

- `clsx` (~230 bytes) is installed as the core dependency.
- `src/shared/lib/cn.ts` exposes `cn(...classes: ClassValue[])` wrapping `clsx`.
- Usage pattern:
  ```tsx
  import { cn } from "@/src/shared/lib";
  import styles from "./order-book.module.css";

  <div className={cn(styles.row, { [styles.active]: isSelected })}>
  ```

### 4. Incremental Migration Strategy

Migration from `app/globals.css` occurs incrementally alongside the modular architecture rollout:

- When a component is migrated or created in `src/shared/` or `src/modules/`, its styles are extracted into `<component>.module.css` and its legacy class block is removed from `app/globals.css`.
- Upon completion of Phase 1, `app/globals.css` contains exclusively:
  1. Token import (`@import "@/src/shared/theme/tokens.css"`).
  2. Baseline HTML/body reset and font configuration.
  3. Root viewport application shell layout (`.terminal-shell`).

## Rejected Alternatives

- **Runtime CSS-in-JS (Emotion, styled-components):** Incompatible with React Server Components in Next.js App Router and incurs garbage collection pauses / frame drops during high-frequency market data streaming.
- **Tailwind CSS v4:** While popular for generic web apps, utility-first classes clutter JSX for dense terminal widgets, canvas overlays, and financial tables, and require unnecessary build configuration when native CSS Modules are zero-config in Next.js.
- **Monolithic `globals.css` with sections:** Fails vertical module encapsulation; violates the core principle that deleting a module folder cleanly removes 100% of its footprint.

## Consequences

### Positive

- Strict vertical slice encapsulation: modules own their styles entirely.
- Zero runtime overhead (0ms JS execution overhead for styling).
- Native support in Next.js and React Compiler out of the box.
- Type-safe, collision-free scoped class names.

### Negative

- Requires co-locating CSS files with components and importing `styles` objects in TSX.
- Developers must use `cn()` for dynamic conditionals rather than ad-hoc string concatenation.

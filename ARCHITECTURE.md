# Z-Trader Architecture

Multi-window CME Futures trading and market-analysis terminal built as **vertical domain slices with strict black-box perimeters** ("replace internals against unchanged contracts and tests").

> Authority: active ADRs in [docs/adr/README.md](docs/adr/README.md). Items marked `(planned)` or `(open)` are not yet codified in an ADR or implemented.

## 1. Repository & Layer Codemap

Allowed layer imports:

- `src/app/` -> `src/composition/`, `src/shared/` (never `src/modules/`)
- `src/composition/` -> `src/modules/`, `src/shared/` (never `src/app/`)
- `src/modules/` -> `src/modules/`, `src/shared/` (never `src/composition/`, `src/app/`)
- `src/shared/` -> `src/shared/` only

| Path                        | Role                                                                 | Details                                                                                                                                                        |
| :-------------------------- | :------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`                  | Next.js routing shell (`layout.tsx`, `page.tsx`, `globals.css`)      | Imports `@/src/composition` & `@/src/shared`                                                                                                                   |
| `src/composition/`          | Single orchestration root (`index.ts`, `terminal.tsx`, `widgets.ts`) | Wires widgets (and planned feed/catalog seams) into `TerminalShell`                                                                                            |
| `src/modules/<name>/`       | Isolated vertical domain slices (flat directory)                     | See Module Map below                                                                                                                                           |
| `src/shared/`               | Domain-agnostic foundation                                           | [`contracts`](src/shared/contracts/index.ts), [`theme`](src/shared/theme/index.ts), [`storage`](src/shared/storage/index.ts), [`lib`](src/shared/lib/index.ts) |
| `tests/e2e/`                | System Playwright E2E suite                                          | Real-browser verification (separate from module unit tests)                                                                                                    |
| `.agents/`                  | Dev-time agent flywheel, hooks, skills & tracing                     | Quarantined from `src/`                                                                                                                                        |
| `integrations/ninjatrader/` | `(planned)` C# NinjaScript AddOn for local CME WS bridge             | Outside `src/`                                                                                                                                                 |

### Module Map (`src/modules/`)

| Module           | Kind         | Role                                                                                                                     | Passport                                       |
| :--------------- | :----------- | :----------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------- |
| `workspace`      | `Shell`      | Multi-window MDI manager, `TopBar` (`Connections: Live \| Replay` & `Playback` planned), `StatusBar`                     | [README](src/modules/workspace/README.md)      |
| `instruments`    | `Supporting` | CME contract catalog (`ES 12-26`) & search modal dialog                                                                  | [README](src/modules/instruments/README.md)    |
| `market-data`    | `Engine`     | Out-of-React multiplexer (`MarketStreamService`) & `MarketDataFeed` adapters (`Demo`; `Live` WS & `Replay` disk planned) | [README](src/modules/market-data/README.md)    |
| `indicators`     | `Engine`     | Pure functional technical indicator calculations (wiring to `chart` open)                                                | [README](src/modules/indicators/README.md)     |
| `chart`          | `Widget`     | Imperative `lightweight-charts` canvas candlestick & volume widget                                                       | [README](src/modules/chart/README.md)          |
| `order-book`     | `Widget`     | Level 2 DOM depth ladder widget                                                                                          | [README](src/modules/order-book/README.md)     |
| `time-and-sales` | `Widget`     | Executed trades tape widget                                                                                              | [README](src/modules/time-and-sales/README.md) |

### Standard Module Anatomy

```text
src/modules/<name>/
├── index.ts        # Perimeter: re-exports ONLY minimal public contract (no declarations or internal stores/helpers)
├── README.md       # Perimeter: contract, deps, invariants (## Governing ADRs auto-synced by `pnpm adr:sync`)
├── tests/          # Perimeter: black-box behavioral tests (import ONLY from ../index.ts or @/src/modules/<name>)
│
├── types.ts        # Internal: TypeScript types ONLY (no runtime code)
├── constants.ts    # Internal: defaults & internal constants
├── schema.ts       # Internal (optional): Zod 4 schemas
├── model/          # Internal: domain logic, Zustand stores, services, hooks
└── ui/             # Internal (optional): React components & co-located *.module.css
```

## 2. Hard Invariants

- **Layer & perimeter boundaries**: Respect layer imports above. Import modules and `src/composition` strictly via their `index.ts` (`@/src/modules/*/*` and `@/src/composition/*` are forbidden in prod and `tests/`). Production code never imports `tests/`. Zero circular imports or dead code (`pnpm depcruise`, `pnpm knip`).
- **Module isolation**:
  - `Widget` modules (`chart`, `order-book`, `time-and-sales`) never import each other or `workspace`.
  - `workspace` consumes widgets strictly via `WidgetDefinition` (`@/src/shared/contracts`).
  - `market-data` never imports UI widgets or `workspace`.
  - `indicators` & `instruments` never import other modules.
- **Out-of-React streaming & canvas**: Widgets consume quotes only via `MarketStreamService` (ref-counted topics, `Unsubscribe`/`AbortSignal` cleanup, Zod ingress validation, `Object.freeze`). Canvas charts (`useChart`) run imperatively out of React with `chart.remove()` cleanup and non-destructive theme updates (`chart.applyOptions()`).
- **Multi-window isolation**: Widget stores partition state by `windowId` and dispose state on close/unmount.
- **Styling & tokens**: Use co-located `*.module.css`, `cn()` (`@/src/shared/lib`), and CSS tokens from `src/shared/theme/tokens.css`. Zero raw hex/RGB values in components, runtime CSS-in-JS, Tailwind, or widget styles in `src/app/globals.css`.
- **Silent storage & StatusBar**: All browser persistence goes through `safeStorage` (`@/src/shared/storage`) with Zod validation and silent in-memory fallback (zero UI banners/toasts/icons). `StatusBar` is telemetry-only.
- **Dev-time quarantine**: `.agents/` code, hooks, and Langfuse dev projects never mix with `src/`.

## 3. Cross-Module Data Flow

- **Market stream**: `MarketDataFeed` -> `market-data (MarketStreamService: ref-count + Zod + Object.freeze)` -> widget `windowId` stores / imperative canvas (`series.update()`).
- **Terminal wiring**: `src/composition/` wires concrete `WidgetDefinition`s into `workspace` (seam for `Live | Replay` feeds & playback controls is `(open)`).

## 4. Engineering Conventions

- **React Compiler**: Do not add manual `useMemo`, `useCallback`, or `memo` unless a measured performance issue or external imperative boundary requires it.

## 5. Specs & Enforcement (Load On Demand)

- **Governing ADRs**: [docs/adr/README.md](docs/adr/README.md) (Active Decisions Index) · `pnpm adr:list --path <path>` · `## Governing ADRs` in `src/modules/<name>/README.md`.
- **Mechanical gates**: [`eslint.config.mjs`](eslint.config.mjs) (AST, intra-file syntax, pure barrels/types) · [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs) (dependency graph, layers, deep imports, isolation, cycles) · [`knip.json`](knip.json) (dead code) · `pnpm adr:check` (MADR 4.0, lockfile, README sync).

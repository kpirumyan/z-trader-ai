# Module Passport: `instruments`

## Purpose & Responsibilities

Provides a standalone vertical domain module for financial instruments catalog and search modal dialog (`src/modules/instruments/`).

- Supplies default tradeable instruments (`DEFAULT_INSTRUMENTS`) and window kind labels (`DEFAULT_WINDOW_KIND_LABELS`).
- Provides asynchronous catalog service (`demoInstrumentCatalog`) with case-insensitive substring searching.
- Renders an accessible modal search dialog (`InstrumentSearchDialog`) based on modern web standards (native `<dialog>`, `<search>`, combobox UX with arrow navigation, and light-dismiss backdrop support).
- Non-goals: live market quote streaming (handled by `market-data`) and workspace window state management (handled by `workspace`).

## Public Contract

Exported via `@/src/modules/instruments`:

- **Types**: `Instrument`, `InstrumentCatalogProvider`, `InstrumentSearchDialogProps`, `WindowKind`
- **Schemas**: `instrumentSchema`, `instrumentCatalogSchema`
- **Constants**: `DEFAULT_INSTRUMENTS`, `DEFAULT_WINDOW_KIND_LABELS`
- **Components / Entry Points**: `InstrumentSearchDialog`, `demoInstrumentCatalog`

## Allowed Dependencies

- `@/src/shared/contracts`
- Local internal files (`model/`, `ui/`, `schema`, `constants`, `types`)

## Behavioral & Architectural Invariants

- Black-box perimeter: internal implementation files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) are strictly private.
- Public exports strictly through `index.ts`.
- **Key Guarantees**:
  - Race condition resilience: asynchronous catalog queries discard stale responses when queries complete out of order.
  - Combobox UX: focus remains in the search input while `ArrowDown`/`ArrowUp` navigates options and `Enter` selects active ticker.
  - Native light dismiss: backdrop clicks outside the dialog boundary trigger `onCancel()`.
- Theme & Design: styled strictly using semantic CSS tokens from [`DESIGN.md`](../../../DESIGN.md) via CSS Modules (`instrument-search-dialog.module.css`).

## Verification

- Behavior verified via black-box test suite in [`tests/`](./tests/).

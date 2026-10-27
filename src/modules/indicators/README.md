# Module Passport: `indicators`

## Purpose & Responsibilities

Provides the algorithmic technical indicators engine (`src/modules/indicators/`).

- Computes deterministic moving averages (SMA, EMA) over historical candlestick series (`Candle[]`).
- Generates typed time-series points `IndicatorPoint` (`{ readonly time: number; readonly value: number }`) ready for Lightweight Charts canvas rendering.
- Exposes declarative indicator registry catalog (`INDICATOR_DEFINITIONS`) and schema validators (`smaConfigSchema`, `emaConfigSchema`, `indicatorConfigSchema`).
- Handles boundary conditions deterministically (returns `[]` when `candles.length < period` or `period < 1`).
- Non-goals: UI widgets, canvas rendering, state storage, or real-time streaming subscriptions.

## Public Contract

Exported via `@/src/modules/indicators`:

- **Types**: `EmaConfig`, `IndicatorCalculateFn`, `IndicatorConfig`, `IndicatorDefinition`, `IndicatorOverlayType`, `IndicatorPoint`, `IndicatorSourceKey`, `IndicatorType`, `SmaConfig`
- **Schemas**: `emaConfigSchema`, `indicatorConfigSchema`, `indicatorOverlayTypeSchema`, `indicatorPointSchema`, `indicatorSourceKeySchema`, `indicatorTypeSchema`, `smaConfigSchema`
- **Constants**: `AVAILABLE_INDICATOR_TYPES`, `DEFAULT_EMA_CONFIG`, `DEFAULT_SMA_CONFIG`, `INDICATOR_DEFINITIONS`
- **Calculations & Utilities**: `calculateSma`, `calculateEma`

## Allowed Dependencies

- `@/src/shared/contracts`
- `zod`
- Local internal files (`model/`, `schema`, `constants`, `types`)

## Behavioral & Architectural Invariants

- Black-box perimeter: internal implementation files (`model/`, `schema.ts`, `constants.ts`, `types.ts`) are strictly private.
- Public exports strictly through `index.ts`.
- Pure functional paradigm: deterministic, side-effect free, immutable calculations operating in $O(N)$ linear time.

## Verification

- Verified via black-box test suite in [`tests/`](./tests/).

---
trigger: model_decision
description: Naming conventions for files, directories, code identifiers, and constants across modular domain paths and shared foundation
---

# Naming Conventions

<rule id="naming-conventions" severity="REGULAR">
  <summary>Enforce standardized casing conventions for directory paths, code files, identifiers, and shared constants across the modular architecture.</summary>
  <list type="checklist">
    <item>Directories: Domain module directories (`src/modules/[name]/`) and shared foundation segments (`src/shared/[segment]/`) must use lowercase `kebab-case` (e.g., `market-data`, `order-book`, `time-and-sales`).</item>
    <item>Files: All filenames must use lowercase `kebab-case` with standard extensions (`.ts`, `.tsx`, `.md`). Files inside `model/` and `ui/` must use singular form (e.g., `workspace-store.ts`, `chart-canvas.tsx`, `instrument-search-modal.tsx`). Plural names are permitted only for collection utilities or categorical folders.</item>
    <item>Types & Interfaces: Types, interfaces, and enums must use `PascalCase` without prefixes like `I` (e.g., `ChartConfig`, `Instrument`, `OrderBookState`, NOT `IChartConfig`).</item>
    <item>Components: React components must use `PascalCase` (matching their file purpose, e.g. `ChartCanvas` in `chart-canvas.tsx`).</item>
    <item>Functions & Hooks: General utility functions and methods must use `camelCase`. React hooks must use `camelCase` with the `use` prefix (e.g., `useWorkspaceStore`, `useWindowBounds`).</item>
    <item>Constants & Configuration: Static constants and configuration objects must use uppercase `SCREAMING_SNAKE_CASE` (e.g., `DEFAULT_CANDLE_COUNT`, `STORAGE_KEYS`).</item>
    <item>Imports of Shared Constants: Shared constants, tokens, and contracts must be imported and used directly from `@/src/shared/*` without redundant local alias declarations (`const FOO = SHARED_FOO;`).</item>
  </list>
</rule>

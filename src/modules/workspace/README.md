# Module Passport: `workspace`

## Purpose & Responsibilities

Provides the modular multi-window workspace manager and terminal shell (`src/modules/workspace/`) conforming to ADR-0001 and ADR-0004.

- Multi-window workspace state management powered by Zustand (`useWorkspaceStore`):
  - Cascading placement of newly opened windows (`addWindow`) with cyclic diagonal offsets (`WINDOW_CASCADE_OFFSET = 16`, `WINDOW_CASCADE_STEP = 32`, `WINDOW_CASCADE_MAX_SLOTS = 8`).
  - Focus elevation (`focusWindow`) raising the active window's `zIndex` above all other windows.
  - Window closure (`closeWindow`) with automatic focus fallback to the remaining window with the highest `zIndex`.
  - Interactive pointer drag-and-drop (`moveWindow`) with non-negative coordinate boundary clamping (`x >= 0`, `y >= 0`).
  - Interactive corner resizing (`resizeWindow`) via bottom-right pointer handle clamped to minimum dimensions (260 × 180px).
  - Classic MDI minimization (`minimizeWindow`, `restoreWindow`, `toggleMinimizeWindow`) collapsing windows to 180 × 28px headers aligned along the canvas bottom edge in dynamic wrapping slot rows without additional docks or taskbars.
  - Header double-click and button restoration re-expanding windows to original coordinates/dimensions and raising active focus.
  - Instrument switching (`changeInstrument`) propagating symbol updates across window headers.
  - Workspace reset (`resetWorkspace`) clearing in-memory windows and overwriting persistent storage.
- Resilient, silent layout persistence in `safeStorage` (`src/shared/storage`) with strict Zod runtime validation (`workspaceStorageSchema`) and zero user-interrupting recovery banners (ADR-0004).
- Modular presentation hierarchy:
  - `TopBar`: Brand identity (theme-adaptive logos), "New" popover trigger, and `ThemeToggle` integration.
  - `NewMenuPopover`: WAI-ARIA accessible menu (`role="menu"`, `role="menuitem"`) supporting roving tabindex, arrow navigation, escape dismissal, and trigger-click toggle handling.
  - `WorkspaceCanvas`: Main workspace landmark (`role="main"`) with empty state prompt and background watermark logo.
  - `TerminalWindow`: Accessible window region (`role="region"`) with draggable header, instrument selector dialog trigger, close button, and dynamic widget container.
  - `StatusBar`: 24px docked operational telemetry bar with connection status, latency, and UTC clock.
- Complete widget decoupling: depends strictly on abstract contracts (`WidgetDefinition`, `WidgetProps`) without importing concrete widgets.

## Public Contract

Exported via `@/src/modules/workspace`:

- **Types**: `NewMenuPopoverProps`, `StatusBarProps`, `TerminalShellProps`, `TerminalWindowProps`, `TopBarProps`, `WindowPosition`, `WindowSize`, `WorkspaceCanvasProps`, `WorkspaceRecord`, `WorkspaceStorageEnvelope`, `WorkspaceStore`, `WorkspaceStoreActions`, `WorkspaceStoreState`, `WorkspaceWindow`
- **Schemas**: `windowPositionSchema`, `windowSizeSchema`, `workspaceInstrumentSchema`, `workspaceRecordSchema`, `workspaceStorageSchema`, `workspaceWindowSchema`
- **Constants**: `CURRENT_WORKSPACE_VERSION`, `DEFAULT_WINDOW_HEIGHT`, `DEFAULT_WINDOW_KIND_LABELS`, `DEFAULT_WINDOW_WIDTH`, `DEFAULT_WORKSPACE_ID`, `EMPTY_WORKSPACE_INSTRUCTION`, `EMPTY_WORKSPACE_TITLE`, `MIN_WINDOW_HEIGHT`, `MIN_WINDOW_WIDTH`, `MINIMIZED_WINDOW_GAP`, `MINIMIZED_WINDOW_HEIGHT`, `MINIMIZED_WINDOW_MARGIN`, `MINIMIZED_WINDOW_WIDTH`, `WINDOW_CASCADE_MAX_SLOTS`, `WINDOW_CASCADE_OFFSET`, `WINDOW_CASCADE_STEP`, `WORKSPACE_STORAGE_KEY`
- **Model / State**: `useWorkspaceStore`
- **Components / Entry Points**: `NewMenuPopover`, `StatusBar`, `TerminalShell`, `TerminalWindow`, `TopBar`, `WorkspaceCanvas`

## Allowed Dependencies

- `@/src/shared/contracts`
- `@/src/shared/storage`
- `@/src/shared/theme`
- `@/src/modules/instruments`
- `zustand`
- `zod`
- Local internal files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`)

## Behavioral & Architectural Invariants

- Black-box perimeter: internal implementation files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) are private and never directly imported externally.
- Widget independence: forbidden to import concrete widgets (`chart`, `order-book`, `time-and-sales`). Widgets are passed via the external `widgets` prop.
- Resilient silent storage: corrupt or outdated storage payloads recover silently to an empty workspace without error banners or blocking dialogs (ADR-0004).
- Zero raw colors: styled strictly using tokens from [`DESIGN.md`](../../../DESIGN.md) (`--canvas`, `--surface`, `--surface-raised`, `--border`, `--brand-gold`, `--text-primary`, `--text-secondary`).
- High-density layout: compact top bar (32px), status bar (24px), window headers (28px), and tabular monospace numerals.

## Verification

- Behavior verified via black-box test suite in [`tests/`](./tests/).

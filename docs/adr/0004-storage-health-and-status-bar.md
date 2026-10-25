# ADR-0004: Storage Health Monitoring & Terminal Status Bar

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** System Architect, Core Team

## Context

Z-Trader persists window geometry, active layouts, and user preferences on the client using browser storage (`localStorage`). Storage operations can fail due to quota restrictions, private browsing / incognito mode restrictions (`DOMException: SecurityError`), or JSON payload corruption from schema migrations.

The initial design planned a prominent `StorageRecoveryBanner` rendered directly within the `WorkspaceCanvas`, showing error messages and recovery buttons (`Retry`, `Start empty`).

In a high-density multi-window financial trading terminal, placing intrusive recovery banners inside the charting canvas has critical drawbacks:

1. **Canvas Occlusion:** Banners displace or cover active candlestick charts, Level 2 order books, and real-time execution monitors, disrupting active trading operations.
2. **Cognitive Distraction:** High-contrast banners inside the workspace produce false urgency for background storage errors that can be handled gracefully via in-memory fallbacks.
3. **Density Conflict:** Violates terminal ergonomics defined in [`DESIGN.md`](../../DESIGN.md), which prioritize maximum unobstructed screen space for desktop financial data.

## Decision

We replace the canvas recovery banner with a dedicated **Status Bar** containing a non-intrusive **Storage Status Icon**:

### 1. Abolish Canvas Recovery Banner

We remove `StorageRecoveryBanner` from the workspace canvas and eliminate related full-width banner styles. If persistent storage fails or is corrupted, the workspace automatically falls back to safe in-memory defaults without disrupting active window displays.

### 2. Introduce `StorageStatusIcon` (`src/shared/storage/`)

We introduce a compact, accessible status indicator component (`storage-status-icon.tsx` and `storage-status-icon.module.css`) inside the shared storage segment:

- **Reactive Health States:**
  - `synced`: Storage healthy and up to date (subtle/neutral icon).
  - `syncing`: Storage write in progress.
  - `warning`: Storage unavailable (e.g., incognito mode or access denied; in-memory fallback active).
  - `error`: Storage corruption or write failure encountered.
- **Accessible Diagnostic Popover:**
  - The icon exposes semantic accessibility (`role="status"`, `aria-label`).
  - Clicking or triggering the icon opens a compact diagnostic popover detailing the storage state and offering recovery actions (`Retry`, `Reset to default`) without occluding charts.
- **Design Tokens Compliance:** Follows [`DESIGN.md`](../../DESIGN.md) tokens (`--surface-raised`, `--text-secondary`, `--brand-gold`, accessible error markers, no fluorescent glows).

### 3. Introduce `StatusBar` (`src/modules/workspace/`)

We introduce a standardized bottom bar component (`src/modules/workspace/ui/status-bar.tsx` with `status-bar.module.css`) to the terminal shell structure:

```text
TerminalShell
├── TopBar            # Top: branding, window creation ("New"), workspace actions, theme toggle
├── WorkspaceCanvas   # Main: multi-window draggable canvas (Chart, Order Book, Time & Sales)
└── StatusBar         # Bottom: system telemetry (StorageStatusIcon, feed health, UTC clock)
```

- **Height & Layout:** Compact height (24px), docked to the bottom edge with a subtle border (`var(--border)`) and neutral surface (`var(--surface)`).
- **Telemetry Host:** Hosts `StorageStatusIcon` alongside future operational telemetry (WebSocket connection health, tick latency, market feed status).

## Consequences

### Positive

- **Unobstructed Trading Canvas:** Charts and order books retain 100% visibility regardless of client storage errors.
- **Clean Separation of Concerns:** Storage diagnostic controls are decoupled from the canvas and consolidated into the terminal status bar.
- **Extensible Telemetry:** Provides an architectural home for future system health indicators (WebSocket feed status, exchange latency, server clock).

### Negative

- Introduces a small fixed vertical footprint (24px) at the bottom of the viewport for the `StatusBar`.
- Requires unit and integration tests to verify status transitions and popover interactions instead of a static banner.

## Rejected Alternatives

- **Canvas Recovery Banner (`StorageRecoveryBanner`):** Obstructs financial charts and creates intrusive visual clutter.
- **Toast Notifications:** Ephemeral toasts disappear before traders observe the error, while persistent toasts repeatedly block canvas corners.
- **Embedding Storage Status in `TopBar`:** The top bar is reserved for primary navigation, instrument search triggers, and window management; adding background storage diagnostics clutters the primary header.

---
id: "ADR-0004"
title: "Resilient Silent Storage & Terminal Status Bar"
status: "accepted"
date: "2026-10-25"
decision-makers:
  - "Product Owner"
  - "Architect Agent"
area: "Storage & UI Layout"
applies_to:
  - "src/shared/storage"
  - "src/modules/workspace"
enforced_by:
  - "src/shared/storage/tests/storage.test.ts"
  - "src/modules/workspace/tests/workspace-store.test.ts"
  - "src/modules/workspace/tests/workspace-ui.test.tsx"
supersedes: null
superseded_by: null
---

# ADR-0004: Resilient Silent Storage & Terminal Status Bar

## Context and Problem Statement

Z-Trader persists window geometry, active workspace layouts, and user theme preferences on the client via browser storage (`localStorage`). Client storage operations can fail due to quota exhaustion (`QuotaExceededError`), private browsing restrictions (`DOMException: SecurityError`), SSR execution (`typeof window === "undefined"`), or corrupted JSON payloads from schema changes.

Displaying prominent recovery banners or storage diagnostic popovers in a high-density financial trading terminal introduces critical usability issues:

1. **Canvas Occlusion**: Alert banners displace or cover live candlestick charts, Level 2 order books, and Time & Sales feeds during active market monitoring.
2. **Cognitive Distraction**: Storage health warnings create false urgency for non-critical client caching anomalies that should never interrupt trading workflows.

How should Z-Trader handle client-side storage failures and allocate status bar real estate?

## Decision Drivers

- **Zero Trader Disruption**: Client persistence failures must never throw unhandled exceptions, render blocking banners, or occlude active trading windows.
- **Graceful In-Memory Degradation**: When `localStorage` is blocked or full, state persistence must transparently fall back to an in-memory session store.
- **Dedicated Operational Telemetry**: The 24px bottom `StatusBar` must be reserved strictly for trading and market feed telemetry (connection status, tick latency, UTC clock).

## Decision Outcome

Chosen option: **Silent Resilient `safeStorage` (`src/shared/storage/`) with In-Memory Fallback + Telemetry-Only `StatusBar` (`src/modules/workspace/`)**.

### 1. Abolish Storage Error Banners & Diagnostic Popovers

Z-Trader renders zero UI error banners, toasts, or status bar icons for client storage anomalies. All storage recovery happens silently behind the storage abstraction.

### 2. Resilient Dual-Layer `safeStorage` (`src/shared/storage/`)

`src/shared/storage/` exports `safeStorage`, providing a unified dual-layer API:

- **Low-Level String API**: Browser-compatible `getItem`, `setItem`, `removeItem`, and `clear`.
- **High-Level Typed JSON & Schema API**: `getJSON<T>` and `setJSON<T>` supporting optional runtime Zod schema validation and typed default fallbacks.
- **Transparent In-Memory Fallback**: Traps SSR environments, `SecurityError`, `QuotaExceededError`, and malformed JSON payloads, automatically diverting reads/writes to an internal in-memory map for the remainder of the session without throwing.

### 3. Telemetry-Dedicated `StatusBar` (`src/modules/workspace/`)

The terminal shell (`TerminalShell` in `src/modules/workspace/ui/terminal-shell.tsx`) maintains a strict three-tier vertical layout:

```text
TerminalShell
├── TopBar            # Top (32px): branding, window creation ("New"), workspace actions, theme toggle
├── WorkspaceCanvas   # Main: multi-window draggable MDI canvas (Chart, Order Book, Time & Sales)
└── StatusBar         # Bottom (24px): operational telemetry (feed health, tick latency, UTC clock)
```

## Confirmation and Enforcement

- **Storage Resilience Unit Tests (`src/shared/storage/tests/storage.test.ts`)**: Verifies silent in-memory fallback when `localStorage` throws `SecurityError` or `QuotaExceededError`, and verifies Zod schema fallback on corrupt JSON payloads.
- **Workspace Persistence & UI Tests (`src/modules/workspace/tests/workspace-store.test.ts`, `src/modules/workspace/tests/workspace-ui.test.tsx`)**: Verifies layout recovery on corrupted storage envelopes and ensures `StatusBar` renders operational telemetry without storage alert clutter.

## Consequences

### Positive

- Charts and market depth ladders retain 100% canvas visibility under all browser storage conditions.
- Domain modules (`workspace`, `theme`) consume `safeStorage` without repetitive `try/catch` boilerplate.
- The bottom `StatusBar` communicates high-signal market connectivity and latency metrics.

### Negative

- Users in strict incognito/private browsing sessions that block `localStorage` retain layout modifications only for the duration of the tab session.

## Rejected Alternatives

- **Canvas Recovery Banner (`StorageRecoveryBanner`)**: Shifts viewport layout and obstructs live financial charts.
- **Status Bar Storage Diagnostic Popover (`StorageStatusIcon`)**: Adds cognitive noise for background caching that already degrades safely in-memory.
- **Toast Notifications on Storage Failure**: Transient toasts distract traders and occlude corner windows.

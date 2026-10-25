# ADR-0004: Resilient Silent Storage & Terminal Status Bar

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** System Architect, Core Team

## Context

Z-Trader persists window geometry, active layouts, and user preferences on the client using browser storage (`localStorage`). Storage operations can fail due to quota restrictions, private browsing / incognito mode restrictions (`DOMException: SecurityError`), or JSON payload corruption from schema migrations.

The initial legacy approach relied on a prominent `StorageRecoveryBanner` inside the `WorkspaceCanvas`. An intermediate RFC proposed a reactive `StorageStatusIcon` with diagnostic popovers in the status bar.

In a high-density multi-window financial trading terminal:

1. **Canvas Occlusion:** Banners displace or cover active candlestick charts, Level 2 order books, and real-time execution monitors, disrupting active trading operations.
2. **Cognitive Distraction & Redundant Telemetry:** High-contrast banners or reactive storage health icons in the status bar produce false urgency for transient or background client storage anomalies. Client caching failure should never disrupt the trader nor demand manual intervention.
3. **Resilience Principle:** If persistent browser storage is blocked or exhausted, the terminal must degrade gracefully and silently into an in-memory session store, allowing all trading workflows to proceed unobstructed.

## Decision

We establish silent, resilient client-side storage and dedicate the terminal status bar strictly to operational trading telemetry:

### 1. Abolish All Storage Error Banners and UI Status Indicators

We eliminate `StorageRecoveryBanner`, and explicitly reject `StorageStatusIcon` and diagnostic storage popovers. Storage operates completely silently without distracting or cluttering the trader UI.

### 2. Introduce Resilient Dual-Layer `safeStorage` (`src/shared/storage/`)

We introduce a domain-agnostic, resilient storage utility in `src/shared/storage/` providing a unified dual-layer API:

- **Low-level Storage API:** String-based key-value methods matching the browser contract (`getItem`, `setItem`, `removeItem`, `clear`).
- **High-level Typed JSON & Schema API:** Typed helpers (`getJSON<T>`, `setJSON<T>`) supporting optional runtime Zod schema parsing and safe fallbacks.
- **Transparent In-Memory Fallback:** Traps SSR environments (`typeof window === 'undefined'`), private browsing errors (`DOMException: SecurityError`), and storage exhaustion (`QuotaExceededError`). When `localStorage` is inaccessible or fails, operations automatically and silently divert to an internal in-memory key-value store for the remainder of the session without throwing.

### 3. Retain `StatusBar` Strictly for Terminal Telemetry (`src/modules/workspace/`)

We maintain the standardized bottom bar component (`src/modules/workspace/ui/status-bar.tsx` with `status-bar.module.css`) in the terminal shell structure:

```text
TerminalShell
├── TopBar            # Top: branding, window creation ("New"), workspace actions, theme toggle
├── WorkspaceCanvas   # Main: multi-window draggable canvas (Chart, Order Book, Time & Sales)
└── StatusBar         # Bottom: operational telemetry (WebSocket feed health, tick latency, UTC clock)
```

- **Height & Layout:** Compact height (24px), docked to the bottom edge with a subtle border (`var(--border)`) and neutral surface (`var(--surface)`).
- **Telemetry Host:** Hosts purely operational trading telemetry (market data connectivity, server clock, latency). Hosts zero storage diagnostic controls or icons.

## Consequences

### Positive

- **Zero Trader Disruption:** Charts and execution views retain 100% visibility; storage failures degrade gracefully in-memory without error popovers or banners.
- **Developer Ergonomics:** Modules (`workspace`, `theme`) consume a unified dual API (`safeStorage.getItem` or `safeStorage.getJSON`) without boilerplate try-catch blocks.
- **Clean Telemetry Separation:** The status bar remains dedicated to actual market infrastructure telemetry rather than client-side persistence internals.

### Negative

- If a user operates in private browsing mode, layout changes persist only for the duration of the browser tab session (expected behavior for private sessions).

## Rejected Alternatives

- **Canvas Recovery Banner (`StorageRecoveryBanner`):** Obstructs financial charts and creates intrusive visual clutter.
- **Storage Status Icon & Diagnostic Popover (`StorageStatusIcon`):** Unnecessary cognitive overhead and visual noise for background client caching that degrades safely in-memory.
- **Toast Notifications:** Ephemeral toasts disappear before traders observe them, while persistent toasts block canvas corners.
- **Embedding Storage Status in `TopBar`:** The top bar is reserved for primary navigation, instrument search triggers, and window management.

# Architectural Decision Records (ADRs)

This directory contains only active, current architectural decisions for Z-Trader. When a decision is superseded, the outdated record is removed, and its rationale and rejected alternatives are incorporated into the replacement ADR.

## Governance & Ownership

- **Owner**: System Architect (in consultation with Core Team / Developer).
- **Lifecycle & Timing**: Authored and reconciled during architectural design sessions or Session 1 (`/spec`) _before_ implementation begins. Downstream agents (`coder`, `tester`, reviewers) execute strictly within these bounds and do not modify ADRs.

## Active Decisions Index

| ID                                                                   | Title                                                                       | Status   | Date       | Area                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- | ---------- | ----------------------- |
| [ADR-0001](./0001-modular-architecture.md)                           | Modular Architecture & Vertical Domain Slices                               | Accepted | 2026-10-24 | Architecture & Layout   |
| [ADR-0002](./0002-boundary-enforcement-and-quarantine.md)            | Automated Architectural Boundary Enforcement                                | Accepted | 2026-10-24 | Tooling & Governance    |
| [ADR-0003](./0003-css-architecture.md)                               | CSS Modules, Design Tokens & Styling Standard                               | Accepted | 2026-10-24 | UI & Styling            |
| [ADR-0004](./0004-resilient-storage-and-terminal-status-bar.md)      | Resilient Silent Storage & Terminal Status Bar                              | Accepted | 2026-10-25 | Storage & UI Layout     |
| [ADR-0005](./0005-market-data-streaming-and-transport-separation.md) | Out-of-React Market Data Streaming & Transport Separation                   | Accepted | 2026-10-25 | Market Data & Streaming |
| [ADR-0006](./0006-canvas-charting-and-lightweight-charts.md)         | High-Performance Canvas Charting via Lightweight Charts & Theme Integration | Accepted | 2026-10-25 | Charting & Performance  |
| [ADR-0007](./0007-ninjatrader-cme-market-data.md)                    | CME Futures Market Data via NinjaTrader 8 Dual-Workflow Architecture        | Accepted | 2026-10-30 | Market Data & Replay    |

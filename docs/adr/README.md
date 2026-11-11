# Architectural Decision Records (ADRs)

This directory contains the Architecture Decision Log (ADL) for Z-Trader, structured according to the **MADR 4.0 (Markdown Architectural Decision Records)** standard enhanced with **AI-Agent bidirectional traceability** (`applies_to` and `enforced_by` frontmatter).

## Governance, Lifecycle & Immutability

- **Decision Makers**: Product Owner & specialized AI agents (e.g. Architect Agent, Main Agent, Tester Agent).
- **MADR 4.0 Immutable Log**: Accepted ADRs are immutable historical records. When an architectural decision is replaced or retired, the original file is never deleted or overwritten; its frontmatter `status` is updated to `superseded by ADR-XXXX` or `deprecated`, and a new ADR is created.
- **AI Agent Filtering & Enforcement**: Coding agents and automated path gates enforce only active decisions (`status: "accepted"`). Use `pnpm adr:list --module <name>` to query active decisions for a domain module, and `pnpm adr:check` to validate compliance.

## Active Decisions Index

| ID                                                                   | Title                                                                        | Status   | Date       | Area                    |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- | ---------- | ----------------------- |
| [ADR-0000](./0000-executable-adr-governance.md)                      | Executable ADR Governance via Hybrid MADR 4.0 and Bidirectional Traceability | accepted | 2026-11-05 | Tooling & Governance    |
| [ADR-0001](./0001-modular-architecture.md)                           | Modular Architecture & Vertical Domain Slices                                | accepted | 2026-10-24 | Architecture & Layout   |
| [ADR-0002](./0002-boundary-enforcement-and-quarantine.md)            | Automated Architectural Boundary Enforcement                                 | accepted | 2026-11-05 | Tooling & Governance    |
| [ADR-0003](./0003-css-architecture.md)                               | CSS Modules, Design Tokens & Styling Standard                                | accepted | 2026-10-24 | UI & Styling            |
| [ADR-0004](./0004-resilient-storage-and-terminal-status-bar.md)      | Resilient Silent Storage & Terminal Status Bar                               | accepted | 2026-10-25 | Storage & UI Layout     |
| [ADR-0005](./0005-market-data-streaming-and-transport-separation.md) | Out-of-React Market Data Streaming & Transport Separation                    | accepted | 2026-10-25 | Market Data & Streaming |
| [ADR-0006](./0006-canvas-charting-and-lightweight-charts.md)         | High-Performance Canvas Charting via Lightweight Charts & Theme Integration  | accepted | 2026-10-25 | Charting & Performance  |
| [ADR-0007](./0007-ninjatrader-cme-market-data.md)                    | CME Futures Market Data via NinjaTrader 8 Dual-Workflow Architecture         | accepted | 2026-10-30 | Market Data & Replay    |
| [ADR-0008](./0008-langfuse-native-self-improving-agent-flywheel.md)  | Langfuse-Native Self-Improving Agent Flywheel                                | accepted | 2026-11-11 | AI & Observability      |

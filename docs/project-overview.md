# Z-Trader: Domain Map & Module Topology

## 1. Domain Modules & Responsibilities

| Module           | Type                | Domain Role & Semantics                                                                                       | Status    |
| :--------------- | :------------------ | :------------------------------------------------------------------------------------------------------------ | :-------- |
| `workspace`      | Infrastructure / UI | Multi-window desktop manager: window geometry, positioning, z-ordering, layout persistence, TopBar, StatusBar | Planned   |
| `instruments`    | Domain Slice        | Financial instrument specification (symbol, exchange, precision, lot size) & search dialog                    | Completed |
| `market-data`    | Service / Core      | Streaming feeds manager: out-of-React adapters for candles (OHLCV), Level 2 depth, and trade ticks            | Completed |
| `indicators`     | Algorithm Engine    | Pure mathematical calculation engine transforming historical candle data into plotted time series             | Planned   |
| `chart`          | Widget              | Real-time candlestick & indicator visualization window (Lightweight Charts v5)                                | Planned   |
| `order-book`     | Widget              | Level 2 DOM depth ladder visualization window                                                                 | Completed |
| `time-and-sales` | Widget              | Real-time tape of executed trade ticks window                                                                 | Planned   |

---

## 2. High-Level Data Flow

```text
[ Market Data Feed / Provider ] (External WebSocket / Mock)
              │
              ▼
    [ streaming/adapter ] (Out-of-React streaming manager)
              │
              ▼
   [ src/shared/contracts/ ] (Standardized event interfaces & types)
              │
      ┌───────┴──────────────────┐
      ▼                          ▼
[ Module Zustand Store ]   [ Module Zustand Store ]
  (e.g., chart/model)        (e.g., order-book/model)
      │                          │
      ▼                          ▼
 [ Widget UI (React) ]      [ Widget UI (React) ]
```

- **Market Data Flow**: Streaming updates flow from out-of-React adapters into module stores through standardized contracts (`src/shared/contracts/`).
- **Composition Root**: Widgets do not know about each other; `src/composition/widgets.ts` registers widget definitions into the workspace window manager.

---

## 3. Architectural References

- **Architectural Decisions & Invariants**: [adr/README.md](adr/README.md)
- **Roadmap Tasks & Status**: [../.agents/plans/tasks.md](../.agents/plans/tasks.md)
- **Design Tokens & Themes**: [../DESIGN.md](../DESIGN.md)
- **Codebase Layout Rules**: [../.agents/rules/codebase-layout.md](../.agents/rules/codebase-layout.md)
- **Naming Conventions**: [../.agents/rules/naming-conventions.md](../.agents/rules/naming-conventions.md)

# Macro Plan: Receiving Real CME Market Data (`market-data`)

- **Architectural Decision**: [ADR-0007](../../docs/adr/0007-ninjatrader-cme-market-data.md)
- **Task Checklist**: [tasks.md](./tasks.md)

## Agreed Scope (From Initial Data-Receiving Discussion)

- **Market & Source**: Real CME Futures data from NinjaTrader 8 only (free and accurate prices, volume, Level 2 order book, and Time & Sales).
- **Historical / Offline Files (`Replay`)**: Only `.nrd` Market Replay files are used (60–90 days available from NT8 servers; `.ncd` files are excluded). `.nrd` files are exported to disk via `Tools -> NRD to CSV` inside NT8 so Z-Trader can read them with NT8 closed (Workflow A).
- **Live & 10-Minute Delayed Streaming (`Live`)**: A C# NinjaScript AddOn inside running NT8 streams data over a local WebSocket (`ws://localhost`) to Z-Trader (Workflow B), using the 14-day free real-time CME trial and continuing with 10-minute delayed CME data after trial expiration.
- **Connections & Playback UX**: A NinjaTrader-style `Connections` menu in `TopBar` with strictly 2 options (`Live | Replay`) that shows a Playback Controller (`Play/Pause`, `Speed`, `Date/Time`) when `Replay` is active.
- **Instruments**: Exact CME contract expiries (e.g. `ES 12-26`, `NQ 12-26`) dynamically discovered from NT8 / local `db` folders and shown in the Instrument Search dialog.

---

## Macrosteps (To Be Discussed in Detail in Microplans)

1. **Macrostep 1 — Offline Local Files (Workflow A: `.nrd` Exported Files & `Replay`)**
   - Discuss and define how exported `.nrd` CSV files on disk are structured, discovered, and read into Z-Trader for prices, volume, order book, and Time & Sales.
2. **Macrostep 2 — NT8 WebSocket Bridge (Workflow B: `Live` Real-Time & 10-Minute Delayed Stream)**
   - Discuss and define how the NinjaTrader 8 C# AddOn streams live trial and 10-minute delayed data over `ws://localhost` into Z-Trader.
3. **Macrostep 3 — Dynamic CME Contract Expiry Discovery**
   - Discuss and define how exact contract expiries (`ES 12-26`, `NQ 12-26`, etc.) are discovered from local folders and NT8 and presented in the Instrument Search dialog.
4. **Macrostep 4 — `Connections` Menu (`Live | Replay`) & Playback Controller**
   - Discuss and define switching between `Live` and `Replay`, and controlling `Replay` (`Play/Pause`, `Speed`, `Date/Time`).

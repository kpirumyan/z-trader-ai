# Z-Trader Development Tasks (Roadmap Checklist)

Master checklist tracking macrosteps and their microplan tasks for receiving real CME market data.
See [market-data.md](./market-data.md) and [ADR-0007](../../docs/adr/0007-ninjatrader-cme-market-data.md).

---

## Macrostep 1 — Offline Local Files (Workflow A: `.nrd` Exported Files & `Replay`)

- [ ] `nrd-csv-parser`: Parse NinjaTrader 8 semicolon-delimited `L1;` and `L2;` CSV rows into typed records (`YYYYMMDDhhmmss` + `100ns` offset to Unix ms, locale-safe `,`/`.` decimal parsing, safe rejection of malformed rows) (`src/modules/market-data`)
- [ ] `nrd-state-reconstructor`: Reconstruct canonical `Trade` (with Bid/Ask Buy/Sell classification and tick-rule fallback), positional `L2` `OrderBookSnapshot`, multi-timeframe `Candle` (`1m`, `5m`, `15m`, `1h`, `1d`), and `TickerQuote` from parsed NRD records (`src/modules/market-data`)
- [ ] `nrd-file-reader`: Discover and stream `data/replay/<Symbol>/<YYYYMMDD>.csv` (with `ZTRADER_REPLAY_DIR` override) line-by-line in Node.js (`readline`) and pre-aggregate initial historical candles up to a target replay timestamp (`src/modules/market-data`)
- [ ] `replay-market-data-feed`: Connect server replay stream to browser `ReplayMarketDataFeed` implementing `MarketDataFeed`, load initial chart history, and batch visual UI repaints via `requestAnimationFrame` (`src/modules/market-data`, `src/composition`, `app/api/replay`)
- [ ] `nt8-nrd-to-csv-addon`: Ready-to-import C# NinjaScript AddOn (`ZTraderNrdToCsv.cs`) exporting `.nrd` files from NinjaTrader 8 directly into `data/replay/<Symbol>/<YYYYMMDD>.csv` (`tools/ninjatrader/`)

---

## Macrostep 2 — NT8 WebSocket Bridge (Workflow B: `Live` Real-Time & 10-Minute Delayed Stream)

- [ ] *Discuss and create microplan for Macrostep 2*

---

## Macrostep 3 — Dynamic CME Contract Expiry Discovery

- [ ] *Discuss and create microplan for Macrostep 3*

---

## Macrostep 4 — `Connections` Menu (`Live | Replay`) & Playback Controller

- [ ] *Discuss and create microplan for Macrostep 4*

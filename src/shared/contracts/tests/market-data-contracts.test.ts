import { describe, expect, it } from "vitest";

import {
  candleSchema,
  orderBookLevelSchema,
  orderBookSnapshotSchema,
  orderSideSchema,
  tickerQuoteSchema,
  timeframeSchema,
  tradeSchema,
  type Candle,
  type OrderBookSnapshot,
  type TickerQuote,
  type Trade,
} from "@/src/shared/contracts";

describe("shared-contracts: market data schema validation", () => {
  describe("orderSideSchema", () => {
    it("validates canonical order sides 'buy' and 'sell'", () => {
      // Given: canonical order sides
      const buyResult = orderSideSchema.safeParse("buy");
      const sellResult = orderSideSchema.safeParse("sell");

      // Then
      expect(buyResult.success).toBe(true);
      expect(sellResult.success).toBe(true);

      if (buyResult.success && sellResult.success) {
        expect(buyResult.data).toBe("buy");
        expect(sellResult.data).toBe("sell");
      }
    });

    it("rejects invalid or case-mismatched order sides", () => {
      // Given: invalid order sides
      const invalidSides: readonly unknown[] = [
        "BUY",
        "SELL",
        "hold",
        "bid",
        "ask",
        "",
        123,
        null,
        undefined,
        {},
      ];

      for (const side of invalidSides) {
        // When
        const result = orderSideSchema.safeParse(side);

        // Then
        expect(result.success).toBe(false);
      }
    });
  });

  describe("timeframeSchema", () => {
    it("validates supported timeframes ('1m', '5m', '15m', '1h', '1d')", () => {
      // Given
      const timeframes = ["1m", "5m", "15m", "1h", "1d"] as const;

      for (const tf of timeframes) {
        // When
        const result = timeframeSchema.safeParse(tf);

        // Then
        expect(result.success).toBe(true);

        if (result.success) {
          expect(result.data).toBe(tf);
        }
      }
    });

    it("rejects unsupported timeframe identifiers", () => {
      // Given
      const invalidTimeframes: readonly unknown[] = [
        "1s",
        "2m",
        "30m",
        "4h",
        "1w",
        "1M",
        "",
        1,
        null,
        undefined,
      ];

      for (const tf of invalidTimeframes) {
        // When
        const result = timeframeSchema.safeParse(tf);

        // Then
        expect(result.success).toBe(false);
      }
    });
  });

  describe("candleSchema", () => {
    it("validates and accepts a canonical OHLCV candle", () => {
      // Given: valid candle payload
      const validCandle: Candle = {
        time: 1700000000,
        open: 5000.25,
        high: 5010.5,
        low: 4995.0,
        close: 5005.75,
        volume: 1250,
      };

      // When
      const result = candleSchema.safeParse(validCandle);

      // Then
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data).toEqual(validCandle);
      }
    });

    it("accepts flat candles where open, high, low, close are equal with zero volume", () => {
      // Given: flat candle with zero volume
      const flatCandle: Candle = {
        time: 1700000060,
        open: 5000.0,
        high: 5000.0,
        low: 5000.0,
        close: 5000.0,
        volume: 0,
      };

      // When
      const result = candleSchema.safeParse(flatCandle);

      // Then
      expect(result.success).toBe(true);
    });

    it("rejects candles violating price boundary invariants (high < low, high < open, low > close)", () => {
      // Given: candles with invalid price relationships
      const invalidRelationshipCandles: readonly unknown[] = [
        // high is lower than low
        { time: 1700000000, open: 100, high: 90, low: 95, close: 92, volume: 10 },
        // high is lower than open
        { time: 1700000000, open: 110, high: 105, low: 95, close: 100, volume: 10 },
        // high is lower than close
        { time: 1700000000, open: 100, high: 105, low: 95, close: 110, volume: 10 },
        // low is higher than open
        { time: 1700000000, open: 90, high: 105, low: 95, close: 100, volume: 10 },
        // low is higher than close
        { time: 1700000000, open: 100, high: 105, low: 95, close: 90, volume: 10 },
      ];

      for (const candle of invalidRelationshipCandles) {
        // When
        const result = candleSchema.safeParse(candle);

        // Then
        expect(result.success).toBe(false);
      }
    });

    it("rejects candles with negative or non-positive price and non-integer/non-positive time", () => {
      // Given: candles with non-positive numeric fields
      const invalidCandles: readonly unknown[] = [
        // non-positive open
        { time: 1700000000, open: 0, high: 100, low: 0, close: 50, volume: 10 },
        // negative low
        { time: 1700000000, open: 100, high: 110, low: -5, close: 105, volume: 10 },
        // negative volume
        { time: 1700000000, open: 100, high: 110, low: 95, close: 105, volume: -1 },
        // non-integer timestamp
        { time: 1700000000.5, open: 100, high: 110, low: 95, close: 105, volume: 10 },
        // non-positive timestamp
        { time: 0, open: 100, high: 110, low: 95, close: 105, volume: 10 },
        { time: -1700000000, open: 100, high: 110, low: 95, close: 105, volume: 10 },
        // missing fields
        { open: 100, high: 110, low: 95, close: 105 },
        null,
        undefined,
      ];

      for (const candle of invalidCandles) {
        // When
        const result = candleSchema.safeParse(candle);

        // Then
        expect(result.success).toBe(false);
      }
    });
  });

  describe("tradeSchema", () => {
    it("validates and accepts a canonical market trade", () => {
      // Given: valid buy and sell trades
      const validTrade: Trade = {
        id: "tr-001",
        time: 1700000000123,
        price: 5002.5,
        size: 15,
        side: "buy",
      };

      // When
      const result = tradeSchema.safeParse(validTrade);

      // Then
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data).toEqual(validTrade);
      }
    });

    it("rejects trades with invalid id, time, price, size, or side", () => {
      // Given: malformed trade candidates
      const invalidTrades: readonly unknown[] = [
        // empty id
        { id: "", time: 1700000000000, price: 100, size: 10, side: "buy" },
        // non-positive price
        { id: "tr-1", time: 1700000000000, price: 0, size: 10, side: "buy" },
        { id: "tr-2", time: 1700000000000, price: -50, size: 10, side: "buy" },
        { id: "tr-3", time: 1700000000000, price: Number.NaN, size: 10, side: "buy" },
        // non-positive size
        { id: "tr-4", time: 1700000000000, price: 100, size: 0, side: "buy" },
        { id: "tr-5", time: 1700000000000, price: 100, size: -5, side: "buy" },
        // non-positive/non-integer time
        { id: "tr-6", time: 0, price: 100, size: 1, side: "buy" },
        { id: "tr-7", time: 1700000000.75, price: 100, size: 1, side: "buy" },
        // invalid side
        { id: "tr-8", time: 1700000000000, price: 100, size: 1, side: "HOLD" },
        null,
        undefined,
      ];

      for (const trade of invalidTrades) {
        // When
        const result = tradeSchema.safeParse(trade);

        // Then
        expect(result.success).toBe(false);
      }
    });
  });

  describe("orderBookSnapshotSchema", () => {
    it("validates and accepts a canonical order book snapshot", () => {
      // Given: valid snapshot with bids and asks
      const validSnapshot: OrderBookSnapshot = {
        symbol: "ES",
        timestamp: 1700000000500,
        bids: [
          { price: 5000.0, size: 20 },
          { price: 4999.75, size: 35 },
        ],
        asks: [
          { price: 5000.25, size: 15 },
          { price: 5000.5, size: 40 },
        ],
      };

      // When
      const result = orderBookSnapshotSchema.safeParse(validSnapshot);

      // Then
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data).toEqual(validSnapshot);
      }
    });

    it("accepts snapshots with empty bids or asks arrays", () => {
      // Given: crossed or empty market snapshot
      const emptyBookSnapshot = {
        symbol: "NQ",
        timestamp: 1700000000000,
        bids: [],
        asks: [],
      };

      // When
      const result = orderBookSnapshotSchema.safeParse(emptyBookSnapshot);

      // Then
      expect(result.success).toBe(true);
    });

    it("trims whitespace from symbol", () => {
      // Given: symbol with extra whitespace
      const input = {
        symbol: "  AAPL  ",
        timestamp: 1700000000000,
        bids: [],
        asks: [],
      };

      // When
      const result = orderBookSnapshotSchema.safeParse(input);

      // Then
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.symbol).toBe("AAPL");
      }
    });

    it("rejects snapshots with invalid symbol, timestamp, or book levels", () => {
      // Given: invalid snapshots
      const invalidSnapshots: readonly unknown[] = [
        // empty symbol
        { symbol: "", timestamp: 1700000000000, bids: [], asks: [] },
        { symbol: "   ", timestamp: 1700000000000, bids: [], asks: [] },
        // non-positive timestamp
        { symbol: "ES", timestamp: 0, bids: [], asks: [] },
        { symbol: "ES", timestamp: -100, bids: [], asks: [] },
        // invalid level in bids (negative size)
        {
          symbol: "ES",
          timestamp: 1700000000000,
          bids: [{ price: 5000, size: -1 }],
          asks: [],
        },
        // invalid level in asks (non-positive price)
        {
          symbol: "ES",
          timestamp: 1700000000000,
          bids: [],
          asks: [{ price: 0, size: 10 }],
        },
        null,
        undefined,
      ];

      for (const snapshot of invalidSnapshots) {
        // When
        const result = orderBookSnapshotSchema.safeParse(snapshot);

        // Then
        expect(result.success).toBe(false);
      }
    });

    it("orderBookLevelSchema validates non-negative sizes and positive prices", () => {
      // Given: level with size 0 (e.g. cancelled/cleared level)
      const zeroSizeLevel = { price: 5000.25, size: 0 };
      const validResult = orderBookLevelSchema.safeParse(zeroSizeLevel);

      expect(validResult.success).toBe(true);

      // Given: negative size level
      const negativeSizeLevel = { price: 5000.25, size: -1 };
      const invalidResult = orderBookLevelSchema.safeParse(negativeSizeLevel);

      expect(invalidResult.success).toBe(false);
    });
  });

  describe("tickerQuoteSchema", () => {
    it("validates and accepts a canonical ticker quote", () => {
      // Given: valid ticker quote
      const validQuote: TickerQuote = {
        symbol: "ES",
        timestamp: 1700000000000,
        lastPrice: 5005.5,
        bid: 5005.25,
        ask: 5005.75,
        volume24h: 350200,
        change24hPct: 1.45,
      };

      // When
      const result = tickerQuoteSchema.safeParse(validQuote);

      // Then
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data).toEqual(validQuote);
      }
    });

    it("accepts negative percentage change and zero 24h volume", () => {
      // Given: negative change and zero volume
      const fallingQuote = {
        symbol: "NVDA",
        timestamp: 1700000000000,
        lastPrice: 850.0,
        bid: 849.5,
        ask: 850.5,
        volume24h: 0,
        change24hPct: -4.32,
      };

      // When
      const result = tickerQuoteSchema.safeParse(fallingQuote);

      // Then
      expect(result.success).toBe(true);
    });

    it("trims symbol whitespace", () => {
      // Given
      const input = {
        symbol: "  MSFT  ",
        timestamp: 1700000000000,
        lastPrice: 420.0,
        bid: 419.8,
        ask: 420.2,
        volume24h: 1000,
        change24hPct: 0.5,
      };

      // When
      const result = tickerQuoteSchema.safeParse(input);

      // Then
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.symbol).toBe("MSFT");
      }
    });

    it("rejects ticker quotes with non-positive prices, negative volume, or invalid timestamp", () => {
      // Given: invalid ticker quotes
      const invalidQuotes: readonly unknown[] = [
        // empty symbol
        {
          symbol: "",
          timestamp: 1700000000000,
          lastPrice: 100,
          bid: 99,
          ask: 101,
          volume24h: 10,
          change24hPct: 0,
        },
        // non-positive lastPrice
        {
          symbol: "ES",
          timestamp: 1700000000000,
          lastPrice: 0,
          bid: 99,
          ask: 101,
          volume24h: 10,
          change24hPct: 0,
        },
        // non-positive bid
        {
          symbol: "ES",
          timestamp: 1700000000000,
          lastPrice: 100,
          bid: -1,
          ask: 101,
          volume24h: 10,
          change24hPct: 0,
        },
        // non-positive ask
        {
          symbol: "ES",
          timestamp: 1700000000000,
          lastPrice: 100,
          bid: 99,
          ask: 0,
          volume24h: 10,
          change24hPct: 0,
        },
        // negative volume24h
        {
          symbol: "ES",
          timestamp: 1700000000000,
          lastPrice: 100,
          bid: 99,
          ask: 101,
          volume24h: -10,
          change24hPct: 0,
        },
        // non-positive timestamp
        {
          symbol: "ES",
          timestamp: 0,
          lastPrice: 100,
          bid: 99,
          ask: 101,
          volume24h: 10,
          change24hPct: 0,
        },
        null,
        undefined,
      ];

      for (const quote of invalidQuotes) {
        // When
        const result = tickerQuoteSchema.safeParse(quote);

        // Then
        expect(result.success).toBe(false);
      }
    });
  });
});

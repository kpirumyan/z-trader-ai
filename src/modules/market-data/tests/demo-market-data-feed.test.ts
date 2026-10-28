import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDemoMarketDataFeed,
  DEMO_FEED_INTERVALS,
  DemoMarketDataFeed,
  type FeedStatus,
  type MarketDataFeed,
  type MarketDataMessage,
} from "@/src/modules/market-data";
import {
  candleSchema,
  orderBookSnapshotSchema,
  tickerQuoteSchema,
  tradeSchema,
  type Candle,
  type OrderBookSnapshot,
  type TickerQuote,
  type Trade,
} from "@/src/shared/contracts";

describe("demo-market-data-feed: DemoMarketDataFeed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Lifecycle and status transitions", () => {
    it("transitions through idle -> connected -> disconnected states", () => {
      // Given: freshly instantiated feed
      const feed: MarketDataFeed = createDemoMarketDataFeed();
      const statuses: FeedStatus[] = [];

      feed.onStatusChange((status) => statuses.push(status));

      // Initial state is idle
      expect(feed.getStatus()).toBe("idle");

      // When: connect is called
      feed.connect();

      // Then: status transitions to connected
      expect(feed.getStatus()).toBe("connected");
      expect(statuses).toEqual(["connected"]);

      // When: disconnect is called
      feed.disconnect();

      // Then: status transitions to disconnected
      expect(feed.getStatus()).toBe("disconnected");
      expect(statuses).toEqual(["connected", "disconnected"]);
    });

    it("allows unsubscribing from status changes", () => {
      // Given
      const feed = new DemoMarketDataFeed();
      const statuses: FeedStatus[] = [];
      const unsub = feed.onStatusChange((s) => statuses.push(s));

      feed.connect();
      expect(statuses).toEqual(["connected"]);

      // When: unsubscribed
      unsub();
      feed.disconnect();

      // Then: disconnected status is not received
      expect(statuses).toEqual(["connected"]);
    });
  });

  describe("Timer-based quote emissions", () => {
    it("emits valid trades at DEMO_FEED_INTERVALS.tradeMs intervals", () => {
      // Given: connected feed subscribed to trades
      const feed = createDemoMarketDataFeed();

      feed.connect();

      const receivedMessages: MarketDataMessage[] = [];

      feed.onMessage((msg) => receivedMessages.push(msg));

      feed.subscribeTopic({ symbol: "ES", channel: "trades" });

      // When: advancing timers by tradeMs
      vi.advanceTimersByTime(DEMO_FEED_INTERVALS.tradeMs);

      // Then: at least one trade is emitted
      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);

      const firstTradeMsg = receivedMessages[0];

      expect(firstTradeMsg.topic).toEqual({ symbol: "ES", channel: "trades" });

      // And: trade data conforms to canonical tradeSchema
      const parseResult = tradeSchema.safeParse(firstTradeMsg.data);

      expect(parseResult.success).toBe(true);

      if (parseResult.success) {
        const trade: Trade = parseResult.data;

        expect(trade.price).toBeGreaterThan(0);
        expect(trade.size).toBeGreaterThan(0);
        expect(["buy", "sell"]).toContain(trade.side);
        expect(trade.time).toBeGreaterThan(0);
      }
    });

    it("emits valid order book snapshots at DEMO_FEED_INTERVALS.orderBookMs intervals", () => {
      // Given: connected feed subscribed to orderBook
      const feed = createDemoMarketDataFeed();

      feed.connect();

      const receivedMessages: MarketDataMessage[] = [];

      feed.onMessage((msg) => receivedMessages.push(msg));

      feed.subscribeTopic({ symbol: "NQ", channel: "orderBook" });

      // When: advance time by orderBookMs
      vi.advanceTimersByTime(DEMO_FEED_INTERVALS.orderBookMs);

      // Then: order book snapshot is emitted
      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);

      const msg = receivedMessages[0];

      expect(msg.topic).toEqual({ symbol: "NQ", channel: "orderBook" });

      const parseResult = orderBookSnapshotSchema.safeParse(msg.data);

      expect(parseResult.success).toBe(true);

      if (parseResult.success) {
        const snapshot: OrderBookSnapshot = parseResult.data;

        expect(snapshot.symbol).toBe("NQ");
        expect(snapshot.bids.length).toBeGreaterThan(0);
        expect(snapshot.asks.length).toBeGreaterThan(0);

        // Best bid should be less than best ask (non-crossed book)
        const bestBid = snapshot.bids[0].price;
        const bestAsk = snapshot.asks[0].price;

        expect(bestBid).toBeLessThan(bestAsk);
      }
    });

    it("Scenario C: DemoMarketDataFeed generates 50 levels of bids and asks", () => {
      // Given: DemoMarketDataFeed instance subscribed to ES orderBook topic
      const feed = createDemoMarketDataFeed();

      feed.connect();

      const receivedMessages: MarketDataMessage[] = [];

      feed.onMessage((msg) => receivedMessages.push(msg));

      feed.subscribeTopic({ symbol: "ES", channel: "orderBook" });

      // When: timer advances by orderBookMs
      vi.advanceTimersByTime(DEMO_FEED_INTERVALS.orderBookMs);

      // Then: received snapshot bids and asks strictly have length of 50
      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);

      const message = receivedMessages[0];

      expect(message.topic).toEqual({ symbol: "ES", channel: "orderBook" });

      const parseResult = orderBookSnapshotSchema.safeParse(message.data);

      expect(parseResult.success).toBe(true);

      if (parseResult.success) {
        const snapshot: OrderBookSnapshot = parseResult.data;

        expect(snapshot.bids).toHaveLength(50);
        expect(snapshot.asks).toHaveLength(50);
      }
    });

    it("emits valid ticker quotes at DEMO_FEED_INTERVALS.tickerMs intervals", () => {
      // Given: connected feed subscribed to ticker
      const feed = createDemoMarketDataFeed();

      feed.connect();

      const receivedMessages: MarketDataMessage[] = [];

      feed.onMessage((msg) => receivedMessages.push(msg));

      feed.subscribeTopic({ symbol: "AAPL", channel: "ticker" });

      // When: advance time by tickerMs
      vi.advanceTimersByTime(DEMO_FEED_INTERVALS.tickerMs);

      // Then: ticker quote is received
      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);

      const msg = receivedMessages[0];

      expect(msg.topic).toEqual({ symbol: "AAPL", channel: "ticker" });

      const parseResult = tickerQuoteSchema.safeParse(msg.data);

      expect(parseResult.success).toBe(true);

      if (parseResult.success) {
        const quote: TickerQuote = parseResult.data;

        expect(quote.symbol).toBe("AAPL");
        expect(quote.lastPrice).toBeGreaterThan(0);
        expect(quote.bid).toBeGreaterThan(0);
        expect(quote.ask).toBeGreaterThan(0);
        expect(quote.bid).toBeLessThanOrEqual(quote.ask);
        expect(quote.volume24h).toBeGreaterThanOrEqual(0);
      }
    });

    it("emits valid candles at DEMO_FEED_INTERVALS.candleMs intervals", () => {
      // Given: connected feed subscribed to candles
      const feed = createDemoMarketDataFeed();

      feed.connect();

      const receivedMessages: MarketDataMessage[] = [];

      feed.onMessage((msg) => receivedMessages.push(msg));

      feed.subscribeTopic({
        symbol: "MSFT",
        channel: "candles",
        timeframe: "1m",
      });

      // When: advance time by candleMs
      vi.advanceTimersByTime(DEMO_FEED_INTERVALS.candleMs);

      // Then: candle message received
      expect(receivedMessages.length).toBeGreaterThanOrEqual(1);

      const msg = receivedMessages[0];

      expect(msg.topic).toEqual({
        symbol: "MSFT",
        channel: "candles",
        timeframe: "1m",
      });

      const parseResult = candleSchema.safeParse(msg.data);

      expect(parseResult.success).toBe(true);

      if (parseResult.success) {
        const candle: Candle = parseResult.data;

        expect(candle.high).toBeGreaterThanOrEqual(candle.low);
        expect(candle.high).toBeGreaterThanOrEqual(candle.open);
        expect(candle.high).toBeGreaterThanOrEqual(candle.close);
        expect(candle.low).toBeLessThanOrEqual(candle.open);
        expect(candle.low).toBeLessThanOrEqual(candle.close);
        expect(candle.volume).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Topic unsubscription and teardown", () => {
    it("stops emissions for a specific topic when unsubscribeTopic is called", () => {
      // Given: feed subscribed to trades and ticker
      const feed = createDemoMarketDataFeed();

      feed.connect();

      const receivedTrades: MarketDataMessage[] = [];
      const receivedTickers: MarketDataMessage[] = [];

      feed.onMessage((msg) => {
        if (msg.topic.channel === "trades") {
          receivedTrades.push(msg);
        } else if (msg.topic.channel === "ticker") {
          receivedTickers.push(msg);
        }
      });

      feed.subscribeTopic({ symbol: "ES", channel: "trades" });
      feed.subscribeTopic({ symbol: "ES", channel: "ticker" });

      // Let both channels emit initially
      vi.advanceTimersByTime(1000);
      expect(receivedTrades.length).toBeGreaterThan(0);
      expect(receivedTickers.length).toBeGreaterThan(0);

      // When: unsubscribe from trades only
      feed.unsubscribeTopic({ symbol: "ES", channel: "trades" });

      const tradesCountBefore = receivedTrades.length;
      const tickersCountBefore = receivedTickers.length;

      // And: advance time further
      vi.advanceTimersByTime(1000);

      // Then: trades count did not increase, but tickers continue to emit
      expect(receivedTrades.length).toBe(tradesCountBefore);
      expect(receivedTickers.length).toBeGreaterThan(tickersCountBefore);
    });

    it("disconnect ceases all timer emissions completely", () => {
      // Given: actively emitting feed
      const feed = createDemoMarketDataFeed();

      feed.connect();

      const received: MarketDataMessage[] = [];

      feed.onMessage((msg) => received.push(msg));

      feed.subscribeTopic({ symbol: "NVDA", channel: "trades" });
      feed.subscribeTopic({ symbol: "NVDA", channel: "orderBook" });

      vi.advanceTimersByTime(500);
      expect(received.length).toBeGreaterThan(0);

      // When: disconnect is called
      feed.disconnect();

      const countAtDisconnect = received.length;

      // And: virtual time advances significantly
      vi.advanceTimersByTime(10000);

      // Then: no new messages are emitted
      expect(received.length).toBe(countAtDisconnect);
    });
  });

  describe("Custom initial prices", () => {
    it("uses provided initial prices when available", () => {
      // Given: feed initialized with custom price for BTC
      const feed = createDemoMarketDataFeed({ BTC: 65000.0 });

      feed.connect();

      const receivedMessages: MarketDataMessage[] = [];

      feed.onMessage((msg) => receivedMessages.push(msg));

      feed.subscribeTopic({ symbol: "BTC", channel: "ticker" });

      // When: advance time for ticker
      vi.advanceTimersByTime(DEMO_FEED_INTERVALS.tickerMs);

      // Then: received ticker price revolves around 65000
      expect(receivedMessages.length).toBeGreaterThan(0);

      const parseResult = tickerQuoteSchema.safeParse(receivedMessages[0].data);

      expect(parseResult.success).toBe(true);

      if (parseResult.success) {
        expect(parseResult.data.lastPrice).toBeGreaterThan(50000);
        expect(parseResult.data.lastPrice).toBeLessThan(80000);
      }
    });
  });

  describe("Error handler registration", () => {
    it("registers and unregisters error handlers cleanly", () => {
      const feed = createDemoMarketDataFeed();
      const errorSpy = vi.fn();

      const unsub = feed.onError(errorSpy);

      expect(typeof unsub).toBe("function");

      unsub();
      // Unsubscribing should not throw
      expect(() => unsub()).not.toThrow();
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMarketStreamService,
  marketChannelSchema,
  marketTopicSchema,
  type ErrorHandler,
  type FeedStatus,
  type MarketDataFeed,
  type MarketDataMessage,
  type MarketTopic,
  type MessageHandler,
  type StatusHandler,
  type Unsubscribe,
} from "@/src/modules/market-data";

import type { Candle, OrderBookSnapshot, TickerQuote, Trade } from "@/src/shared/contracts";

class MockMarketDataFeed implements MarketDataFeed {
  status: FeedStatus = "connected";
  readonly subscribedTopics: MarketTopic[] = [];
  readonly unsubscribedTopics: MarketTopic[] = [];
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly errorHandlers = new Set<ErrorHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  connectCallCount = 0;
  disconnectCallCount = 0;

  connect(): void {
    this.connectCallCount += 1;
    this.setStatus("connected");
  }

  disconnect(): void {
    this.disconnectCallCount += 1;
    this.setStatus("disconnected");
  }

  getStatus(): FeedStatus {
    return this.status;
  }

  setStatus(status: FeedStatus): void {
    this.status = status;

    for (const handler of this.statusHandlers) {
      handler(this.status);
    }
  }

  subscribeTopic(topic: MarketTopic): void {
    this.subscribedTopics.push(topic);
  }

  unsubscribeTopic(topic: MarketTopic): void {
    this.unsubscribedTopics.push(topic);
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler);

    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onError(handler: ErrorHandler): Unsubscribe {
    this.errorHandlers.add(handler);

    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  onStatusChange(handler: StatusHandler): Unsubscribe {
    this.statusHandlers.add(handler);

    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  emitMessage(message: MarketDataMessage): void {
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }
}

describe("market-stream: MarketDataStreamService", () => {
  let mockFeed: MockMarketDataFeed;

  beforeEach(() => {
    mockFeed = new MockMarketDataFeed();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Ingress validation boundary", () => {
    it("drops malformed messages violating contract schemas without crashing or calling subscriber", () => {
      // Given: service with mock feed and a trades subscriber
      const service = createMarketStreamService(mockFeed);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const receivedTrades: Trade[] = [];

      service.subscribeTrades("AAPL", (trade) => {
        receivedTrades.push(trade);
      });

      // When: feed emits a trade violating positive price & time schema constraints
      const malformedTrade: Trade = {
        id: "tr-bad",
        time: -100,
        price: -50.0,
        size: -10,
        side: "buy",
      };

      mockFeed.emitMessage({
        topic: { symbol: "AAPL", channel: "trades" },
        data: malformedTrade,
      });

      // Then: callback is not called, warning is logged
      expect(receivedTrades).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();

      // When: feed emits a valid trade afterwards
      const validTrade: Trade = {
        id: "tr-good",
        time: 1700000000000,
        price: 180.25,
        size: 50,
        side: "buy",
      };

      mockFeed.emitMessage({
        topic: { symbol: "AAPL", channel: "trades" },
        data: validTrade,
      });

      // Then: subscriber receives the valid trade
      expect(receivedTrades).toHaveLength(1);
      expect(receivedTrades[0]).toEqual(validTrade);
    });

    it("drops candles violating boundary invariants (high < low) at ingress", () => {
      // Given
      const service = createMarketStreamService(mockFeed);

      vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const receivedCandles: Candle[] = [];

      service.subscribeCandles(
        "ES",
        (candle) => {
          receivedCandles.push(candle);
        },
        { timeframe: "1m" },
      );

      // When: feed emits an invalid candle where high is less than low
      const malformedCandle: Candle = {
        time: 1700000000,
        open: 5000,
        high: 4900,
        low: 5050,
        close: 4950,
        volume: 100,
      };

      mockFeed.emitMessage({
        topic: { symbol: "ES", channel: "candles", timeframe: "1m" },
        data: malformedCandle,
      });

      // Then: callback was not invoked
      expect(receivedCandles).toHaveLength(0);
    });
  });

  describe("Multiplexing and Reference Counting", () => {
    it("multiplexes multiple subscribers onto a single feed subscription", () => {
      // Given: service with mock feed
      const service = createMarketStreamService(mockFeed);
      const tradesA: Trade[] = [];
      const tradesB: Trade[] = [];

      // When: two independent listeners subscribe to the same topic
      service.subscribeTrades("AAPL", (t) => tradesA.push(t));
      service.subscribeTrades("AAPL", (t) => tradesB.push(t));

      // Then: transport feed receives exactly ONE subscribeTopic call
      expect(mockFeed.subscribedTopics).toHaveLength(1);

      expect(mockFeed.subscribedTopics[0]).toEqual({
        symbol: "AAPL",
        channel: "trades",
      });

      // When: feed emits a valid trade
      const trade: Trade = {
        id: "t-1",
        time: 1700000000000,
        price: 175.5,
        size: 10,
        side: "buy",
      };

      mockFeed.emitMessage({
        topic: { symbol: "AAPL", channel: "trades" },
        data: trade,
      });

      // Then: both subscribers receive the trade
      expect(tradesA).toHaveLength(1);
      expect(tradesB).toHaveLength(1);
      expect(tradesA[0]).toEqual(trade);
      expect(tradesB[0]).toEqual(trade);

      // And: data is frozen for immutability protection
      expect(Object.isFrozen(tradesA[0])).toBe(true);
    });

    it("unsubscribes from transport feed only when the last subscriber unregisters", () => {
      // Given: two subscribers on the same topic
      const service = createMarketStreamService(mockFeed);
      const unsub1 = service.subscribeCandles("ES", () => undefined, {
        timeframe: "1m",
      });
      const unsub2 = service.subscribeCandles("ES", () => undefined, {
        timeframe: "1m",
      });

      expect(mockFeed.subscribedTopics).toHaveLength(1);
      expect(mockFeed.unsubscribedTopics).toHaveLength(0);

      // When: first subscriber unsubscribes
      unsub1();

      // Then: feed is NOT unsubscribed (reference count = 1)
      expect(mockFeed.unsubscribedTopics).toHaveLength(0);

      // When: second subscriber unsubscribes
      unsub2();

      // Then: feed is unsubscribed (reference count = 0)
      expect(mockFeed.unsubscribedTopics).toHaveLength(1);

      expect(mockFeed.unsubscribedTopics[0]).toEqual({
        symbol: "ES",
        channel: "candles",
        timeframe: "1m",
      });
    });

    it("applies default timeframe ('1m') when subscribeCandles is called without timeframe option", () => {
      // Given
      const service = createMarketStreamService(mockFeed);

      // When
      service.subscribeCandles("NQ", () => undefined);

      // Then: feed receives timeframe '1m'
      expect(mockFeed.subscribedTopics).toHaveLength(1);

      expect(mockFeed.subscribedTopics[0]).toEqual({
        symbol: "NQ",
        channel: "candles",
        timeframe: "1m",
      });
    });
  });

  describe("AbortSignal lifecycle", () => {
    it("automatically unsubscribes when AbortSignal triggers abort", () => {
      // Given: subscription with active AbortController
      const service = createMarketStreamService(mockFeed);
      const controller = new AbortController();
      const receivedQuotes: TickerQuote[] = [];

      service.subscribeTicker("MSFT", (quote) => receivedQuotes.push(quote), {
        signal: controller.signal,
      });

      expect(mockFeed.subscribedTopics).toHaveLength(1);
      expect(mockFeed.unsubscribedTopics).toHaveLength(0);

      // When: controller triggers abort
      controller.abort();

      // Then: transport feed is unsubscribed
      expect(mockFeed.unsubscribedTopics).toHaveLength(1);

      expect(mockFeed.unsubscribedTopics[0]).toEqual({
        symbol: "MSFT",
        channel: "ticker",
      });

      // When: feed emits subsequent ticker quote
      mockFeed.emitMessage({
        topic: { symbol: "MSFT", channel: "ticker" },
        data: {
          symbol: "MSFT",
          timestamp: 1700000000000,
          lastPrice: 420.0,
          bid: 419.5,
          ask: 420.5,
          volume24h: 50000,
          change24hPct: 0.8,
        },
      });

      // Then: subscriber does not receive updates
      expect(receivedQuotes).toHaveLength(0);
    });

    it("does not register subscription if AbortSignal is already aborted", () => {
      // Given: pre-aborted controller
      const service = createMarketStreamService(mockFeed);
      const controller = new AbortController();

      controller.abort();

      const receivedTrades: Trade[] = [];

      // When: subscribe with pre-aborted signal
      const unsub = service.subscribeTrades("NVDA", (trade) => receivedTrades.push(trade), {
        signal: controller.signal,
      });

      // Then: feed subscription is not initiated
      expect(mockFeed.subscribedTopics).toHaveLength(0);

      // And: calling returned unsubscribe is safe and does not throw
      expect(() => unsub()).not.toThrow();
    });
  });

  describe("Topic isolation", () => {
    it("routes messages strictly to subscribers of the matching topic", () => {
      // Given: subscribers to different channels/symbols
      const service = createMarketStreamService(mockFeed);
      const btcTrades: Trade[] = [];
      const ethOrderBooks: OrderBookSnapshot[] = [];

      service.subscribeTrades("BTC", (t) => btcTrades.push(t));
      service.subscribeOrderBook("ETH", (ob) => ethOrderBooks.push(ob));

      // When: feed emits order book for ETH
      const ethSnapshot: OrderBookSnapshot = {
        symbol: "ETH",
        timestamp: 1700000000000,
        bids: [{ price: 3000, size: 5 }],
        asks: [{ price: 3001, size: 4 }],
      };

      mockFeed.emitMessage({
        topic: { symbol: "ETH", channel: "orderBook" },
        data: ethSnapshot,
      });

      // Then: ETH order book subscriber receives message; BTC trade subscriber does not
      expect(ethOrderBooks).toHaveLength(1);
      expect(btcTrades).toHaveLength(0);

      // When: feed emits trade for BTC
      const btcTrade: Trade = {
        id: "tr-btc-1",
        time: 1700000000100,
        price: 65000,
        size: 1.5,
        side: "buy",
      };

      mockFeed.emitMessage({
        topic: { symbol: "BTC", channel: "trades" },
        data: btcTrade,
      });

      // Then: BTC trade subscriber receives message; ETH count unchanged
      expect(btcTrades).toHaveLength(1);
      expect(ethOrderBooks).toHaveLength(1);
    });
  });

  describe("Error handling and status routing", () => {
    it("routes feed errors to topic subscribers with onError handlers", () => {
      // Given: subscriber with registered onError handler
      const service = createMarketStreamService(mockFeed);
      const receivedErrors: Error[] = [];

      service.subscribeTrades(
        "AAPL",
        () => undefined,
        undefined,
        (error) => receivedErrors.push(error),
      );

      // When: feed emits an error
      const testError = new Error("Feed connection timeout");

      mockFeed.emitError(testError);

      // Then: subscriber onError is called with the error
      expect(receivedErrors).toHaveLength(1);
      expect(receivedErrors[0]).toBe(testError);
    });

    it("getStatus delegates to feed status", () => {
      // Given
      const service = createMarketStreamService(mockFeed);

      // Then
      expect(service.getStatus()).toBe("connected");

      // When
      mockFeed.setStatus("connecting");

      // Then
      expect(service.getStatus()).toBe("connecting");
    });
  });

  describe("Disconnect teardown", () => {
    it("disconnects feed and ceases message processing", () => {
      // Given: active subscriptions
      const service = createMarketStreamService(mockFeed);
      const trades: Trade[] = [];

      service.subscribeTrades("ES", (t) => trades.push(t));

      // When: service.disconnect() is called
      service.disconnect();

      // Then: feed disconnect was invoked and status is disconnected
      expect(mockFeed.disconnectCallCount).toBe(1);
      expect(service.getStatus()).toBe("disconnected");

      // When: feed emits a trade after disconnect
      mockFeed.emitMessage({
        topic: { symbol: "ES", channel: "trades" },
        data: {
          id: "tr-post",
          time: 1700000000000,
          price: 5000,
          size: 1,
          side: "buy",
        },
      });

      // Then: message is ignored
      expect(trades).toHaveLength(0);
    });
  });

  describe("Generic subscribe method", () => {
    it("subscribes to arbitrary valid market topic", () => {
      // Given
      const service = createMarketStreamService(mockFeed);
      const received: unknown[] = [];

      service.subscribe({ symbol: "ES", channel: "ticker" }, (data) => received.push(data));

      // Then: feed subscribed to topic
      expect(mockFeed.subscribedTopics).toEqual([{ symbol: "ES", channel: "ticker" }]);

      // When: ticker emitted
      mockFeed.emitMessage({
        topic: { symbol: "ES", channel: "ticker" },
        data: {
          symbol: "ES",
          timestamp: 1700000000000,
          lastPrice: 5000,
          bid: 4999.5,
          ask: 5000.5,
          volume24h: 1000,
          change24hPct: 0.1,
        },
      });

      // Then: generic callback received data
      expect(received).toHaveLength(1);
    });
  });

  describe("market-data schema validation", () => {
    it("marketChannelSchema validates valid channels and rejects unknown ones", () => {
      const validChannels = ["candles", "orderBook", "trades", "ticker"] as const;

      for (const channel of validChannels) {
        expect(marketChannelSchema.safeParse(channel).success).toBe(true);
      }

      const invalidChannels: readonly unknown[] = ["depth", "news", "", 123, null];

      for (const channel of invalidChannels) {
        expect(marketChannelSchema.safeParse(channel).success).toBe(false);
      }
    });

    it("marketTopicSchema validates valid topics with or without timeframe", () => {
      const validTopic = {
        symbol: "AAPL",
        channel: "candles",
        timeframe: "1m",
      };

      expect(marketTopicSchema.safeParse(validTopic).success).toBe(true);

      const validTopicWithoutTf = {
        symbol: "AAPL",
        channel: "trades",
      };

      expect(marketTopicSchema.safeParse(validTopicWithoutTf).success).toBe(true);

      const invalidTopic: readonly unknown[] = [
        { symbol: "", channel: "trades" },
        { symbol: "AAPL", channel: "invalid_channel" },
        { symbol: "AAPL", channel: "candles", timeframe: "10m" },
      ];

      for (const topic of invalidTopic) {
        expect(marketTopicSchema.safeParse(topic).success).toBe(false);
      }
    });
  });
});

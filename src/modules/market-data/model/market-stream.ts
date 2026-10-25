import {
  type Candle,
  candleSchema,
  type OrderBookSnapshot,
  orderBookSnapshotSchema,
  type TickerQuote,
  tickerQuoteSchema,
  type Trade,
  tradeSchema,
} from "@/src/shared/contracts";

import { DEFAULT_TIMEFRAME } from "../constants";
import { createDemoMarketDataFeed, serializeTopic } from "./demo-market-data-feed";

import type {
  CandleSubscriptionOptions,
  ErrorHandler,
  FeedStatus,
  MarketDataFeed,
  MarketDataMessage,
  MarketStreamService,
  MarketTopic,
  SubscriptionOptions,
  Unsubscribe,
} from "../types";

interface TopicSubscriptionState {
  readonly topic: MarketTopic;
  readonly subscribers: Set<(data: unknown) => void>;
  readonly errorHandlers: Set<ErrorHandler>;
}

export class MarketDataStreamServiceImpl implements MarketStreamService {
  private readonly feed: MarketDataFeed;
  private readonly topics = new Map<string, TopicSubscriptionState>();
  private unsubscribeFeedMessage?: Unsubscribe;
  private unsubscribeFeedError?: Unsubscribe;
  private isDisconnected = false;

  constructor(feed: MarketDataFeed = createDemoMarketDataFeed()) {
    this.feed = feed;

    if (typeof this.feed.onMessage === "function") {
      this.unsubscribeFeedMessage = this.feed.onMessage(this.handleFeedMessage);
    }

    if (typeof this.feed.onError === "function") {
      this.unsubscribeFeedError = this.feed.onError(this.handleFeedError);
    }
  }

  getStatus(): FeedStatus {
    if (this.isDisconnected) {
      return "disconnected";
    }

    return this.feed.getStatus?.() ?? "connected";
  }

  subscribeCandles(
    symbol: string,
    callback: (candle: Candle) => void,
    options?: CandleSubscriptionOptions,
    onError?: ErrorHandler,
  ): Unsubscribe {
    return this.subscribe(
      {
        symbol,
        channel: "candles",
        timeframe: options?.timeframe ?? DEFAULT_TIMEFRAME,
      },
      callback as (data: unknown) => void,
      options,
      onError,
    );
  }

  subscribeOrderBook(
    symbol: string,
    callback: (orderBook: OrderBookSnapshot) => void,
    options?: SubscriptionOptions,
    onError?: ErrorHandler,
  ): Unsubscribe {
    return this.subscribe(
      { symbol, channel: "orderBook" },
      callback as (data: unknown) => void,
      options,
      onError,
    );
  }

  subscribeTrades(
    symbol: string,
    callback: (trade: Trade) => void,
    options?: SubscriptionOptions,
    onError?: ErrorHandler,
  ): Unsubscribe {
    return this.subscribe(
      { symbol, channel: "trades" },
      callback as (data: unknown) => void,
      options,
      onError,
    );
  }

  subscribeTicker(
    symbol: string,
    callback: (ticker: TickerQuote) => void,
    options?: SubscriptionOptions,
    onError?: ErrorHandler,
  ): Unsubscribe {
    return this.subscribe(
      { symbol, channel: "ticker" },
      callback as (data: unknown) => void,
      options,
      onError,
    );
  }

  subscribe(
    topic: MarketTopic,
    callback: (data: unknown) => void,
    options?: SubscriptionOptions,
    onError?: ErrorHandler,
  ): Unsubscribe {
    if (options?.signal?.aborted || this.isDisconnected) {
      return () => {};
    }

    const normalizedTopic: MarketTopic =
      topic.channel === "candles" && !topic.timeframe
        ? { ...topic, timeframe: DEFAULT_TIMEFRAME }
        : topic;

    const key = serializeTopic(normalizedTopic);

    let state = this.topics.get(key);
    const isFirstSubscriber = !state;

    if (!state) {
      state = {
        topic: normalizedTopic,
        subscribers: new Set(),
        errorHandlers: new Set(),
      };

      this.topics.set(key, state);
    }

    state.subscribers.add(callback);

    if (onError) {
      state.errorHandlers.add(onError);
    }

    if (this.feed.getStatus?.() === "idle" && typeof this.feed.connect === "function") {
      this.feed.connect();
    }

    if (isFirstSubscriber) {
      this.feed.subscribeTopic(normalizedTopic);
    }

    let unsubscribed = false;

    const unsubscribe = (): void => {
      if (unsubscribed) return;
      unsubscribed = true;

      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }

      const currentState = this.topics.get(key);

      if (!currentState) return;

      currentState.subscribers.delete(callback);

      if (onError) {
        currentState.errorHandlers.delete(onError);
      }

      if (currentState.subscribers.size === 0) {
        this.topics.delete(key);
        this.feed.unsubscribeTopic(normalizedTopic);
      }
    };

    const onAbort = (): void => {
      unsubscribe();
    };

    if (options?.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    return unsubscribe;
  }

  disconnect(): void {
    if (this.isDisconnected) return;
    this.isDisconnected = true;

    for (const state of this.topics.values()) {
      try {
        this.feed.unsubscribeTopic(state.topic);
      } catch (err) {
        console.error("[MarketStreamService] Error unsubscribing topic on disconnect:", err);
      }
    }

    this.topics.clear();

    if (this.unsubscribeFeedMessage) {
      this.unsubscribeFeedMessage();
      this.unsubscribeFeedMessage = undefined;
    }

    if (this.unsubscribeFeedError) {
      this.unsubscribeFeedError();
      this.unsubscribeFeedError = undefined;
    }

    try {
      this.feed.disconnect();
    } catch (err) {
      console.error("[MarketStreamService] Error disconnecting feed:", err);
    }
  }

  private handleFeedMessage = (message: MarketDataMessage): void => {
    if (this.isDisconnected) return;
    if (!message || !message.topic) return;

    const normalizedTopic: MarketTopic =
      message.topic.channel === "candles" && !message.topic.timeframe
        ? { ...message.topic, timeframe: DEFAULT_TIMEFRAME }
        : message.topic;

    const key = serializeTopic(normalizedTopic);
    const state = this.topics.get(key);

    if (!state || state.subscribers.size === 0) {
      return;
    }

    const schema = this.getSchemaForChannel(normalizedTopic.channel);

    if (!schema) {
      console.warn(`[MarketStreamService] No schema found for channel: ${normalizedTopic.channel}`);

      return;
    }

    const result = schema.safeParse(message.data);

    if (!result.success) {
      console.warn(
        `[MarketStreamService] Ingress validation failed for topic ${key}:`,
        result.error.issues,
      );

      return;
    }

    const frozenData = Object.freeze(result.data);
    const subscribers = Array.from(state.subscribers);

    for (const subscriber of subscribers) {
      try {
        subscriber(frozenData);
      } catch (err) {
        console.error(`[MarketStreamService] Subscriber callback threw error for ${key}:`, err);
      }
    }
  };

  private handleFeedError = (error: Error): void => {
    if (this.isDisconnected) return;

    let targetTopic: MarketTopic | string | undefined;
    let targetSymbol: string | undefined;

    if (typeof error === "object" && error !== null) {
      if ("topic" in error) {
        const rawTopic = (error as { topic: unknown }).topic;

        if (typeof rawTopic === "string") {
          targetTopic = rawTopic;
        } else if (
          typeof rawTopic === "object" &&
          rawTopic !== null &&
          "symbol" in rawTopic &&
          "channel" in rawTopic
        ) {
          targetTopic = rawTopic as MarketTopic;
        }
      }

      if ("symbol" in error) {
        const rawSymbol = (error as { symbol: unknown }).symbol;

        if (typeof rawSymbol === "string") {
          targetSymbol = rawSymbol;
        }
      }
    }

    if (!targetSymbol && targetTopic) {
      targetSymbol = typeof targetTopic === "string" ? targetTopic : targetTopic.symbol;
    }

    let notifiedAny = false;

    if (targetTopic || targetSymbol) {
      for (const state of this.topics.values()) {
        const matchTopic =
          typeof targetTopic === "object" && targetTopic !== null
            ? state.topic.symbol === targetTopic.symbol &&
              state.topic.channel === targetTopic.channel &&
              (!targetTopic.timeframe || state.topic.timeframe === targetTopic.timeframe)
            : false;

        const matchSymbol = targetSymbol ? state.topic.symbol === targetSymbol : false;

        if (matchTopic || matchSymbol) {
          const handlers = Array.from(state.errorHandlers);

          for (const handler of handlers) {
            try {
              handler(error);
              notifiedAny = true;
            } catch (err) {
              console.error("[MarketStreamService] Error in onError handler:", err);
            }
          }
        }
      }
    }

    if (!notifiedAny) {
      for (const state of this.topics.values()) {
        const handlers = Array.from(state.errorHandlers);

        for (const handler of handlers) {
          try {
            handler(error);
          } catch (err) {
            console.error("[MarketStreamService] Error in onError handler:", err);
          }
        }
      }
    }
  };

  private getSchemaForChannel(channel: MarketTopic["channel"]) {
    switch (channel) {
      case "candles":
        return candleSchema;

      case "orderBook":
        return orderBookSnapshotSchema;

      case "trades":
        return tradeSchema;

      case "ticker":
        return tickerQuoteSchema;

      default:
        return null;
    }
  }
}

export function createMarketStreamService(feed?: MarketDataFeed): MarketStreamService {
  return new MarketDataStreamServiceImpl(feed);
}

export const marketStreamService: MarketStreamService = createMarketStreamService();

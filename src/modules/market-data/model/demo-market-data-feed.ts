import {
  DEFAULT_TIMEFRAME,
  DEMO_FEED_INTERVALS,
  DEMO_INITIAL_PRICES,
  DEMO_ORDER_BOOK_DEPTH,
} from "../constants";

import type {
  ErrorHandler,
  FeedStatus,
  MarketDataFeed,
  MarketDataMessage,
  MarketTopic,
  MessageHandler,
  StatusHandler,
  Unsubscribe,
} from "../types";
import type {
  Candle,
  OrderBookLevel,
  OrderBookSnapshot,
  OrderSide,
  TickerQuote,
  Timeframe,
  Trade,
} from "@/src/shared/contracts";

export function serializeTopic(topic: MarketTopic): string {
  return `${topic.symbol}:${topic.channel}:${topic.timeframe ?? ""}`;
}

export interface DemoMarketDataFeedOptions {
  readonly initialPrices?: Readonly<Record<string, number>>;
}

function isDemoFeedOptions(
  value: DemoMarketDataFeedOptions | Readonly<Record<string, number>>,
): value is DemoMarketDataFeedOptions {
  return "initialPrices" in value;
}

interface SymbolState {
  currentPrice: number;
  lastSide: OrderSide;
  tradeCount: number;
  currentCandle: Candle | null;
}

export class DemoMarketDataFeed implements MarketDataFeed {
  private status: FeedStatus = "idle";
  private readonly initialPrices: Readonly<Record<string, number>>;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly errorHandlers = new Set<ErrorHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private readonly topicTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly activeTopics = new Map<string, MarketTopic>();
  private readonly symbolStates = new Map<string, SymbolState>();

  constructor(optionsOrPrices?: DemoMarketDataFeedOptions | Readonly<Record<string, number>>) {
    if (!optionsOrPrices) {
      this.initialPrices = DEMO_INITIAL_PRICES;

      return;
    }

    if (isDemoFeedOptions(optionsOrPrices)) {
      this.initialPrices = optionsOrPrices.initialPrices
        ? { ...DEMO_INITIAL_PRICES, ...optionsOrPrices.initialPrices }
        : DEMO_INITIAL_PRICES;
    } else {
      this.initialPrices = { ...DEMO_INITIAL_PRICES, ...optionsOrPrices };
    }
  }

  connect(): void {
    if (this.status === "connected") return;
    this.status = "connected";
    this.notifyStatus("connected");

    for (const topic of this.activeTopics.values()) {
      this.startTopicTimer(topic);
    }
  }

  disconnect(): void {
    if (this.status === "disconnected") return;
    this.status = "disconnected";

    for (const timer of this.topicTimers.values()) {
      clearInterval(timer);
    }

    this.topicTimers.clear();
    this.activeTopics.clear();
    this.notifyStatus("disconnected");
  }

  getStatus(): FeedStatus {
    return this.status;
  }

  subscribeTopic(topic: MarketTopic): void {
    const key = serializeTopic(topic);

    if (this.activeTopics.has(key)) return;

    this.activeTopics.set(key, topic);

    if (this.status === "idle") {
      this.connect();
    } else if (this.status === "connected") {
      this.startTopicTimer(topic);
    }
  }

  unsubscribeTopic(topic: MarketTopic): void {
    const key = serializeTopic(topic);
    const timer = this.topicTimers.get(key);

    if (timer) {
      clearInterval(timer);
      this.topicTimers.delete(key);
    }

    this.activeTopics.delete(key);
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

  private startTopicTimer(topic: MarketTopic): void {
    const key = serializeTopic(topic);

    if (this.topicTimers.has(key)) return;

    const intervalMs = this.getIntervalForChannel(topic.channel);
    const timer = setInterval(() => {
      this.tick(topic);
    }, intervalMs);

    this.topicTimers.set(key, timer);
  }

  private getIntervalForChannel(channel: MarketTopic["channel"]): number {
    switch (channel) {
      case "trades":
        return DEMO_FEED_INTERVALS.tradeMs;

      case "orderBook":
        return DEMO_FEED_INTERVALS.orderBookMs;

      case "ticker":
        return DEMO_FEED_INTERVALS.tickerMs;

      case "candles":
        return DEMO_FEED_INTERVALS.candleMs;

      default:
        return 1000;
    }
  }

  private getCandleBucketDuration(timeframe: Timeframe): number {
    switch (timeframe) {
      case "1m":
        return 60;

      case "5m":
        return 300;

      case "15m":
        return 900;

      case "1h":
        return 3600;

      case "1d":
        return 86400;

      default:
        return 60;
    }
  }

  private getInitialPrice(symbol: string): number {
    return (
      this.initialPrices[symbol] ??
      this.initialPrices[symbol.toUpperCase()] ??
      this.initialPrices[symbol.toLowerCase()] ??
      DEMO_INITIAL_PRICES[symbol] ??
      DEMO_INITIAL_PRICES[symbol.toUpperCase()] ??
      DEMO_INITIAL_PRICES[symbol.toLowerCase()] ??
      this.initialPrices.DEFAULT ??
      DEMO_INITIAL_PRICES.DEFAULT
    );
  }

  private getOrCreateSymbolState(symbol: string): SymbolState {
    let state = this.symbolStates.get(symbol);

    if (!state) {
      const basePrice = this.getInitialPrice(symbol);

      state = {
        currentPrice: basePrice,
        lastSide: "sell",
        tradeCount: 0,
        currentCandle: null,
      };

      this.symbolStates.set(symbol, state);
    }

    return state;
  }

  private getNextPrice(currentPrice: number): number {
    const deltaPct = 0.0005 + Math.random() * 0.0015;
    const sign = Math.random() > 0.5 ? 1 : -1;
    const next = currentPrice * (1 + sign * deltaPct);

    return Number(Math.max(0.01, next).toFixed(2));
  }

  private generateTrade(topic: MarketTopic): Trade {
    const state = this.getOrCreateSymbolState(topic.symbol);

    state.currentPrice = this.getNextPrice(state.currentPrice);
    state.lastSide = state.lastSide === "buy" ? "sell" : "buy";
    state.tradeCount += 1;

    const size = Math.floor(Math.random() * 50) + 1;

    return {
      id: `${topic.symbol}-${Date.now()}-${state.tradeCount}`,
      time: Math.max(1, Date.now()),
      price: state.currentPrice,
      size,
      side: state.lastSide,
    };
  }

  private generateOrderBook(topic: MarketTopic): OrderBookSnapshot {
    const state = this.getOrCreateSymbolState(topic.symbol);
    const mid = state.currentPrice;
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];

    for (let i = 0; i < DEMO_ORDER_BOOK_DEPTH; i++) {
      const bidPrice = Number((mid * (1 - 0.0003 * (i + 1))).toFixed(2));
      const askPrice = Number((mid * (1 + 0.0003 * (i + 1))).toFixed(2));
      const bidSize = Math.floor(Math.random() * 50) + 1;
      const askSize = Math.floor(Math.random() * 50) + 1;

      bids.push({ price: Math.max(0.01, bidPrice), size: bidSize });
      asks.push({ price: Math.max(0.01, askPrice), size: askSize });
    }

    return {
      symbol: topic.symbol,
      timestamp: Math.max(1, Date.now()),
      bids,
      asks,
    };
  }

  private generateTicker(topic: MarketTopic): TickerQuote {
    const state = this.getOrCreateSymbolState(topic.symbol);
    const mid = state.currentPrice;
    const basePrice = this.getInitialPrice(topic.symbol);
    const change24hPct = Number((((mid - basePrice) / basePrice) * 100).toFixed(2));
    const bid = Number((mid * 0.9998).toFixed(2));
    const ask = Number((mid * 1.0002).toFixed(2));

    return {
      symbol: topic.symbol,
      timestamp: Math.max(1, Date.now()),
      lastPrice: mid,
      bid: Math.max(0.01, bid),
      ask: Math.max(0.01, ask),
      volume24h: 150000 + state.tradeCount * 10,
      change24hPct,
    };
  }

  private generateCandle(topic: MarketTopic): Candle {
    const state = this.getOrCreateSymbolState(topic.symbol);

    state.currentPrice = this.getNextPrice(state.currentPrice);

    const nowSec = Math.max(1, Math.floor(Date.now() / 1000));
    const timeframe = topic.timeframe ?? DEFAULT_TIMEFRAME;
    const bucketSec = this.getCandleBucketDuration(timeframe);
    const candleTime = Math.max(1, Math.floor(nowSec / bucketSec) * bucketSec);

    const prev = state.currentCandle;
    let open = state.currentPrice;
    let high = state.currentPrice;
    let low = state.currentPrice;
    let close = state.currentPrice;
    let volume = Math.floor(Math.random() * 20) + 1;

    if (prev && prev.time === candleTime) {
      open = prev.open;
      close = state.currentPrice;
      high = Math.max(prev.high, close);
      low = Math.min(prev.low, close);
      volume = prev.volume + (Math.floor(Math.random() * 10) + 1);
    }

    high = Math.max(high, open, close, low);
    low = Math.min(low, open, close, high);

    const candle: Candle = {
      time: candleTime,
      open,
      high,
      low,
      close,
      volume,
    };

    state.currentCandle = candle;

    return candle;
  }

  private tick(topic: MarketTopic): void {
    if (this.status !== "connected") return;

    let message: MarketDataMessage;

    switch (topic.channel) {
      case "trades":
        message = { topic, data: this.generateTrade(topic) };
        break;

      case "orderBook":
        message = { topic, data: this.generateOrderBook(topic) };
        break;

      case "candles":
        message = { topic, data: this.generateCandle(topic) };
        break;

      case "ticker":
        message = { topic, data: this.generateTicker(topic) };
        break;

      default:
        return;
    }

    this.emitMessage(message);
  }

  private emitMessage(message: MarketDataMessage): void {
    if (this.status !== "connected") return;

    for (const handler of this.messageHandlers) {
      try {
        handler(message);
      } catch (err) {
        console.error("[DemoMarketDataFeed] Error in message handler:", err);
      }
    }
  }

  private notifyStatus(status: FeedStatus): void {
    for (const handler of this.statusHandlers) {
      try {
        handler(status);
      } catch (err) {
        console.error("[DemoMarketDataFeed] Error in status handler:", err);
      }
    }
  }
}

export function createDemoMarketDataFeed(
  optionsOrPrices?: DemoMarketDataFeedOptions | Readonly<Record<string, number>>,
): DemoMarketDataFeed {
  return new DemoMarketDataFeed(optionsOrPrices);
}

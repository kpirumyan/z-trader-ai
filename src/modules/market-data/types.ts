import type {
  Candle,
  MarketChannel,
  OrderBookSnapshot,
  TickerQuote,
  Timeframe,
  Trade,
} from "@/src/shared/contracts";

export type FeedStatus =
  "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

export interface MarketTopic {
  readonly symbol: string;
  readonly channel: MarketChannel;
  readonly timeframe?: Timeframe;
}

export type MarketDataMessage =
  | { readonly topic: MarketTopic; readonly data: Candle }
  | { readonly topic: MarketTopic; readonly data: OrderBookSnapshot }
  | { readonly topic: MarketTopic; readonly data: Trade }
  | { readonly topic: MarketTopic; readonly data: TickerQuote };

export type Unsubscribe = () => void;
export type MessageHandler = (message: MarketDataMessage) => void;
export type ErrorHandler = (error: Error) => void;
export type StatusHandler = (status: FeedStatus) => void;

export interface MarketDataFeed {
  connect(): Promise<void> | void;
  disconnect(): Promise<void> | void;
  getStatus(): FeedStatus;
  subscribeTopic(topic: MarketTopic): void;
  unsubscribeTopic(topic: MarketTopic): void;
  onMessage(handler: MessageHandler): Unsubscribe;
  onError(handler: ErrorHandler): Unsubscribe;
  onStatusChange(handler: StatusHandler): Unsubscribe;
}

export interface SubscriptionOptions {
  readonly signal?: AbortSignal;
}

export interface CandleSubscriptionOptions extends SubscriptionOptions {
  readonly timeframe?: Timeframe;
}

export interface DemoMarketDataFeedOptions {
  readonly initialPrices?: Readonly<Record<string, number>>;
}

export interface MarketStreamService {
  getStatus(): FeedStatus;
  subscribeCandles(
    symbol: string,
    callback: (candle: Candle) => void,
    options?: CandleSubscriptionOptions,
    onError?: ErrorHandler,
  ): Unsubscribe;
  subscribeOrderBook(
    symbol: string,
    callback: (orderBook: OrderBookSnapshot) => void,
    options?: SubscriptionOptions,
    onError?: ErrorHandler,
  ): Unsubscribe;
  subscribeTrades(
    symbol: string,
    callback: (trade: Trade) => void,
    options?: SubscriptionOptions,
    onError?: ErrorHandler,
  ): Unsubscribe;
  subscribeTicker(
    symbol: string,
    callback: (ticker: TickerQuote) => void,
    options?: SubscriptionOptions,
    onError?: ErrorHandler,
  ): Unsubscribe;
  subscribe(
    topic: MarketTopic,
    callback: (data: unknown) => void,
    options?: SubscriptionOptions,
    onError?: ErrorHandler,
  ): Unsubscribe;
  disconnect(): void;
}

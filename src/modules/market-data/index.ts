export type {
  CandleSubscriptionOptions,
  DemoMarketDataFeedOptions,
  ErrorHandler,
  FeedStatus,
  MarketDataFeed,
  MarketDataMessage,
  MarketStreamService,
  MarketTopic,
  MessageHandler,
  StatusHandler,
  SubscriptionOptions,
  Unsubscribe,
} from "./types";

export { marketChannelSchema, marketTopicSchema } from "./schema";

export {
  DEFAULT_TIMEFRAME,
  DEMO_FEED_INTERVALS,
  DEMO_INITIAL_PRICES,
  DEMO_ORDER_BOOK_DEPTH,
  TIMEFRAMES,
} from "./constants";

export { DemoMarketDataFeed, createDemoMarketDataFeed } from "./model/demo-market-data-feed";

export {
  MarketDataStreamServiceImpl,
  createMarketStreamService,
  marketStreamService,
} from "./model/market-stream";

import type { OrderBookDepthLimit } from "./types";

export const DEFAULT_DEPTH_LIMIT: OrderBookDepthLimit = 20;

export const DEPTH_LIMIT_OPTIONS: readonly OrderBookDepthLimit[] = [10, 20, 50] as const;

export const ORDER_BOOK_WIDGET_KIND = "orderBook" as const;

export const ORDER_BOOK_WIDGET_TITLE = "Order Book" as const;

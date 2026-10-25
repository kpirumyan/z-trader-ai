import type { ComponentType } from "react";

export type WindowKind = "chart" | "orderBook" | "timeAndSales";

export interface Instrument {
  readonly symbol: string;
  readonly name: string;
}

export interface WidgetProps {
  readonly windowId: string;
  readonly instrument: Instrument;
  readonly onChangeInstrument?: () => void;
  readonly isFocused?: boolean;
}

export interface WidgetDefinition {
  readonly kind: WindowKind;
  readonly title: string;
  readonly component: ComponentType<WidgetProps>;
}

// Market Data Contracts
export type MarketChannel = "candles" | "orderBook" | "trades" | "ticker";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "1d";
export type OrderSide = "buy" | "sell";

export interface Candle {
  readonly time: number; // Unix timestamp in seconds (Lightweight Charts standard)
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface Trade {
  readonly id: string;
  readonly time: number; // Unix timestamp in milliseconds
  readonly price: number;
  readonly size: number;
  readonly side: OrderSide;
}

export interface OrderBookLevel {
  readonly price: number;
  readonly size: number;
}

export interface OrderBookSnapshot {
  readonly symbol: string;
  readonly timestamp: number;
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
}

export interface TickerQuote {
  readonly symbol: string;
  readonly timestamp: number;
  readonly lastPrice: number;
  readonly bid: number;
  readonly ask: number;
  readonly volume24h: number;
  readonly change24hPct: number;
}

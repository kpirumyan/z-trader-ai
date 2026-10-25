import type {
  OrderBookLevel,
  OrderBookSnapshot,
  OrderSide,
  WidgetProps,
} from "@/src/shared/contracts";

export type OrderBookDepthLimit = 10 | 20 | 50;

export interface OrderBookRow extends OrderBookLevel {
  readonly side: OrderSide;
  readonly cumulativeSize: number;
  readonly depthPercent: number;
}

export interface OrderBookWindowState {
  readonly windowId: string;
  readonly symbol: string;
  readonly depthLimit: OrderBookDepthLimit;
  readonly bids: readonly OrderBookRow[];
  readonly asks: readonly OrderBookRow[];
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  readonly spread: number | null;
  readonly spreadPct: number | null;
  readonly maxCumulativeSize: number;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly lastUpdated: number | null;
}

export interface OrderBookStoreState {
  readonly windows: Readonly<Record<string, OrderBookWindowState>>;
}

export interface OrderBookStoreActions {
  readonly initWindow: (windowId: string, symbol: string, depthLimit?: OrderBookDepthLimit) => void;
  readonly updateSnapshot: (windowId: string, snapshot: OrderBookSnapshot) => void;
  readonly setDepthLimit: (windowId: string, limit: OrderBookDepthLimit) => void;
  readonly setError: (windowId: string, error: string) => void;
  readonly closeWindow: (windowId: string) => void;
}

export type OrderBookStore = OrderBookStoreState & OrderBookStoreActions;

export interface OrderBookWidgetProps extends WidgetProps {
  readonly onSelectPrice?: (price: number) => void;
}

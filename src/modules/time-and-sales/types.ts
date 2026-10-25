import type { Trade, WidgetProps } from "@/src/shared/contracts";

export type TradeBufferLimit = 50 | 100 | 250;

export interface TradeSizeFilter {
  readonly minSize: number;
  readonly maxSize: number | null;
}

export interface FilterPresetOption {
  readonly label: string;
  readonly filter: TradeSizeFilter;
}

export interface TimeAndSalesRow extends Trade {
  readonly formattedTime: string;
  readonly formattedPrice: string;
  readonly isLarge: boolean;
}

export interface TimeAndSalesWindowState {
  readonly windowId: string;
  readonly symbol: string;
  readonly bufferLimit: TradeBufferLimit;
  readonly sizeFilter: TradeSizeFilter;
  readonly trades: readonly Trade[];
  readonly visibleRows: readonly TimeAndSalesRow[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly lastUpdated: number | null;
}

export interface TimeAndSalesStoreState {
  readonly windows: Readonly<Record<string, TimeAndSalesWindowState>>;
}

export interface TimeAndSalesStoreActions {
  readonly initWindow: (
    windowId: string,
    symbol: string,
    bufferLimit?: TradeBufferLimit,
    sizeFilter?: Partial<TradeSizeFilter>,
  ) => void;
  readonly addTrade: (windowId: string, trade: Trade) => void;
  readonly setBufferLimit: (windowId: string, limit: TradeBufferLimit) => void;
  readonly setSizeFilter: (windowId: string, filter: Partial<TradeSizeFilter>) => void;
  readonly resetSizeFilter: (windowId: string) => void;
  readonly setError: (windowId: string, error: string | null) => void;
  readonly closeWindow: (windowId: string) => void;
}

export type TimeAndSalesStore = TimeAndSalesStoreState & TimeAndSalesStoreActions;

export type TimeAndSalesWidgetProps = WidgetProps;

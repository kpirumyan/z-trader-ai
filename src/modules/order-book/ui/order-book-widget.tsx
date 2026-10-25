"use client";

import { useEffect } from "react";

import { cn } from "@/src/shared/lib";

import { DEFAULT_DEPTH_LIMIT } from "../constants";
import { OrderBookHeader } from "./order-book-header";
import { OrderBookLadder } from "./order-book-ladder";
import styles from "./order-book-widget.module.css";
import { useOrderBookStore } from "../model/order-book-store";

import type { OrderBookWidgetProps } from "../types";

export function OrderBookWidget({
  windowId,
  instrument,
  onChangeInstrument,
  isFocused = false,
  onSelectPrice,
}: OrderBookWidgetProps) {
  const windowState = useOrderBookStore((state) => state.windows[windowId]);
  const initWindow = useOrderBookStore((state) => state.initWindow);
  const setDepthLimit = useOrderBookStore((state) => state.setDepthLimit);
  const closeWindow = useOrderBookStore((state) => state.closeWindow);

  useEffect(() => {
    const existing = useOrderBookStore.getState().windows[windowId];

    if (!existing || existing.symbol !== instrument.symbol) {
      initWindow(windowId, instrument.symbol);
    }

    return () => {
      closeWindow(windowId);
    };
  }, [windowId, instrument.symbol, initWindow, closeWindow]);

  const depthLimit = windowState?.depthLimit ?? DEFAULT_DEPTH_LIMIT;
  const bids = windowState?.bids ?? [];
  const asks = windowState?.asks ?? [];
  const isLoading = windowState ? windowState.isLoading : true;
  const error = windowState?.error ?? null;
  const hasData = bids.length > 0 || asks.length > 0;

  return (
    <div
      className={cn(styles.root, isFocused && styles.focused)}
      data-window-id={windowId}
      data-testid={`order-book-widget-${windowId}`}
    >
      <OrderBookHeader
        symbol={instrument.symbol}
        name={instrument.name}
        depthLimit={depthLimit}
        onChangeDepthLimit={(limit) => setDepthLimit(windowId, limit)}
        onChangeInstrument={onChangeInstrument}
      />

      <div className={styles.body}>
        {error ? (
          <div className={styles.errorState} role="alert">
            <p className={styles.errorMessage}>{error}</p>
            <button
              type="button"
              className={styles.retryButton}
              onClick={() => initWindow(windowId, instrument.symbol, depthLimit)}
            >
              Retry
            </button>
          </div>
        ) : isLoading && !hasData ? (
          <div className={styles.loadingState} role="status">
            <div className={styles.loadingSpinner} aria-hidden="true" />
            <p className={styles.loadingText}>Connecting to order book feed...</p>
          </div>
        ) : !hasData ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>No depth data available</p>
          </div>
        ) : (
          <OrderBookLadder
            bids={bids}
            asks={asks}
            bestBid={windowState?.bestBid ?? null}
            bestAsk={windowState?.bestAsk ?? null}
            spread={windowState?.spread ?? null}
            spreadPct={windowState?.spreadPct ?? null}
            onSelectPrice={onSelectPrice}
          />
        )}
      </div>
    </div>
  );
}

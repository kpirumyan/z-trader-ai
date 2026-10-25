"use client";

import { useEffect } from "react";

import { cn } from "@/src/shared/lib";

import { DEFAULT_TRADE_BUFFER_LIMIT, DEFAULT_TRADE_SIZE_FILTER } from "../constants";
import { TimeAndSalesHeader } from "./time-and-sales-header";
import { TimeAndSalesTable } from "./time-and-sales-table";
import styles from "./time-and-sales-widget.module.css";
import { useTimeAndSalesStore } from "../model/time-and-sales-store";

import type { TimeAndSalesWidgetProps } from "../types";

export function TimeAndSalesWidget({
  windowId,
  instrument,
  onChangeInstrument,
  isFocused = false,
}: TimeAndSalesWidgetProps) {
  const windowState = useTimeAndSalesStore((state) => state.windows[windowId]);
  const initWindow = useTimeAndSalesStore((state) => state.initWindow);
  const setBufferLimit = useTimeAndSalesStore((state) => state.setBufferLimit);
  const setSizeFilter = useTimeAndSalesStore((state) => state.setSizeFilter);
  const resetSizeFilter = useTimeAndSalesStore((state) => state.resetSizeFilter);
  const closeWindow = useTimeAndSalesStore((state) => state.closeWindow);

  useEffect(() => {
    const existing = useTimeAndSalesStore.getState().windows[windowId];

    if (!existing || existing.symbol !== instrument.symbol) {
      initWindow(windowId, instrument.symbol);
    }

    return () => {
      closeWindow(windowId);
    };
  }, [windowId, instrument.symbol, initWindow, closeWindow]);

  const bufferLimit = windowState?.bufferLimit ?? DEFAULT_TRADE_BUFFER_LIMIT;
  const sizeFilter = windowState?.sizeFilter ?? DEFAULT_TRADE_SIZE_FILTER;
  const trades = windowState?.trades ?? [];
  const visibleRows = windowState?.visibleRows ?? [];
  const isLoading = windowState ? windowState.isLoading : true;
  const error = windowState?.error ?? null;
  const hasRawTrades = trades.length > 0;
  const hasVisibleRows = visibleRows.length > 0;

  return (
    <div
      className={cn(styles.root, isFocused && styles.focused)}
      data-window-id={windowId}
      data-testid={`time-and-sales-widget-${windowId}`}
    >
      <TimeAndSalesHeader
        symbol={instrument.symbol}
        name={instrument.name}
        bufferLimit={bufferLimit}
        sizeFilter={sizeFilter}
        onChangeBufferLimit={(limit) => setBufferLimit(windowId, limit)}
        onApplyFilter={(newFilter) => setSizeFilter(windowId, newFilter)}
        onResetFilter={() => resetSizeFilter(windowId)}
        onChangeInstrument={onChangeInstrument}
      />

      <div className={styles.body}>
        {error ? (
          <div className={styles.errorState} role="alert">
            <p className={styles.errorMessage}>{error}</p>
            <button
              type="button"
              className={styles.retryButton}
              onClick={() => initWindow(windowId, instrument.symbol, bufferLimit, sizeFilter)}
            >
              Retry
            </button>
          </div>
        ) : !hasRawTrades && isLoading ? (
          <div className={styles.loadingState} role="status">
            <div className={styles.loadingSpinner} aria-hidden="true" />
            <p className={styles.loadingText}>Waiting for trades stream...</p>
          </div>
        ) : !hasRawTrades ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>Waiting for trades stream...</p>
          </div>
        ) : (
          <TimeAndSalesTable
            rows={visibleRows}
            emptyMessage={
              !hasVisibleRows
                ? `No trades matching filter (min: ${sizeFilter.minSize}, max: ${sizeFilter.maxSize ?? "∞"})`
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

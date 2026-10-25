"use client";

import { useEffect, useState } from "react";

import { cn } from "@/src/shared/lib";

import { TRADE_BUFFER_LIMIT_OPTIONS } from "../constants";
import { TimeAndSalesFilterPopover } from "./time-and-sales-filter-popover";
import styles from "./time-and-sales-header.module.css";

import type { TradeBufferLimit, TradeSizeFilter } from "../types";

export interface TimeAndSalesHeaderProps {
  readonly symbol: string;
  readonly name?: string;
  readonly bufferLimit: TradeBufferLimit;
  readonly sizeFilter: TradeSizeFilter;
  readonly onChangeBufferLimit: (limit: TradeBufferLimit) => void;
  readonly onApplyFilter: (filter: TradeSizeFilter) => void;
  readonly onResetFilter: () => void;
  readonly onChangeInstrument?: () => void;
}

export function TimeAndSalesHeader({
  symbol,
  name,
  bufferLimit,
  sizeFilter,
  onChangeBufferLimit,
  onApplyFilter,
  onResetFilter,
  onChangeInstrument,
}: TimeAndSalesHeaderProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const isFilterActive = sizeFilter.minSize > 0 || sizeFilter.maxSize !== null;

  useEffect(() => {
    if (!isFilterOpen) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFilterOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFilterOpen]);

  return (
    <div className={styles.header} role="toolbar" aria-label="Time and sales controls">
      <div className={styles.instrumentGroup}>
        {onChangeInstrument ? (
          <button
            type="button"
            className={styles.tickerButton}
            onClick={onChangeInstrument}
            aria-label={`Change instrument: ${symbol}`}
          >
            <span className={styles.symbol}>{symbol}</span>
            {name && <span className={styles.name}>{name}</span>}
          </button>
        ) : (
          <div className={styles.tickerButton}>
            <span className={styles.symbol}>{symbol}</span>
            {name && <span className={styles.name}>{name}</span>}
          </div>
        )}
      </div>

      <div className={styles.controlsGroup}>
        <div className={styles.bufferSelector}>
          <select
            className={styles.bufferSelect}
            aria-label="Buffer Limit"
            value={bufferLimit}
            onChange={(e) => onChangeBufferLimit(Number(e.target.value) as TradeBufferLimit)}
          >
            {TRADE_BUFFER_LIMIT_OPTIONS.map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterContainer}>
          <button
            type="button"
            className={cn(styles.filterButton, isFilterActive && styles.filterButtonActive)}
            onClick={() => setIsFilterOpen((prev) => !prev)}
            aria-label="Filter"
            aria-expanded={isFilterOpen}
          >
            <span>Filter</span>
            {isFilterActive && <span className={styles.filterBadge} aria-hidden="true" />}
          </button>

          <TimeAndSalesFilterPopover
            isOpen={isFilterOpen}
            onClose={() => setIsFilterOpen(false)}
            filter={sizeFilter}
            onApplyFilter={(newFilter) => {
              onApplyFilter(newFilter);
            }}
            onResetFilter={() => {
              onResetFilter();
            }}
          />
        </div>
      </div>
    </div>
  );
}

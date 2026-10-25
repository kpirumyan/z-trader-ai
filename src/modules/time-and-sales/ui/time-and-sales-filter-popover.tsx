import { cn } from "@/src/shared/lib";

import { SIZE_FILTER_PRESETS } from "../constants";
import styles from "./time-and-sales-filter-popover.module.css";

import type { TradeSizeFilter } from "../types";

export interface TimeAndSalesFilterPopoverProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly filter: TradeSizeFilter;
  readonly onApplyFilter: (filter: TradeSizeFilter) => void;
  readonly onResetFilter: () => void;
}

export function TimeAndSalesFilterPopover({
  isOpen,
  onClose,
  filter,
  onApplyFilter,
  onResetFilter,
}: TimeAndSalesFilterPopoverProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={styles.filterPopover}
      role="dialog"
      aria-label="Trade size filter"
      aria-modal="false"
    >
      <div className={styles.titleRow}>
        <span className={styles.popoverTitle}>Size Filter</span>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close filter popover"
        >
          ✕
        </button>
      </div>

      <div className={styles.presetsGroup}>
        <span className={styles.presetLabel}>Presets</span>
        <div className={styles.presetsGrid} role="group" aria-label="Filter presets">
          {SIZE_FILTER_PRESETS.map((preset) => {
            const isSelected =
              filter.minSize === preset.filter.minSize && filter.maxSize === preset.filter.maxSize;

            return (
              <button
                key={preset.label}
                type="button"
                className={cn(styles.presetButton, isSelected && styles.presetButtonActive)}
                aria-pressed={isSelected}
                onClick={() => {
                  onApplyFilter(preset.filter);
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.inputsGroup}>
        <div className={styles.inputField}>
          <label className={styles.inputLabel} htmlFor="min-trade-size">
            Min Size
          </label>
          <input
            id="min-trade-size"
            type="number"
            min="0"
            className={styles.numberInput}
            aria-label="Min Size"
            value={filter.minSize}
            onChange={(e) => {
              const val = Number(e.target.value);

              onApplyFilter({
                minSize: isNaN(val) || val < 0 ? 0 : val,
                maxSize: filter.maxSize,
              });
            }}
          />
        </div>

        <div className={styles.inputField}>
          <label className={styles.inputLabel} htmlFor="max-trade-size">
            Max Size
          </label>
          <input
            id="max-trade-size"
            type="number"
            min="1"
            className={styles.numberInput}
            aria-label="Max Size"
            placeholder="No max"
            value={filter.maxSize ?? ""}
            onChange={(e) => {
              const val = e.target.value === "" ? null : Number(e.target.value);

              onApplyFilter({
                minSize: filter.minSize,
                maxSize: val !== null && !isNaN(val) && val >= 0 ? val : null,
              });
            }}
          />
        </div>
      </div>

      <div className={styles.actionsRow}>
        <button
          type="button"
          className={styles.resetButton}
          onClick={onResetFilter}
          aria-label="Reset filter"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

import { cn } from "@/src/shared/lib";

import { DEPTH_LIMIT_OPTIONS } from "../constants";
import styles from "./order-book-header.module.css";

import type { OrderBookDepthLimit } from "../types";

export interface OrderBookHeaderProps {
  readonly symbol: string;
  readonly name?: string;
  readonly depthLimit: OrderBookDepthLimit;
  readonly onChangeDepthLimit: (limit: OrderBookDepthLimit) => void;
}

export function OrderBookHeader({
  symbol,
  name,
  depthLimit,
  onChangeDepthLimit,
}: OrderBookHeaderProps) {
  return (
    <div className={styles.header} role="toolbar" aria-label="Order book controls">
      <div className={styles.instrumentGroup}>
        <span className={styles.symbol}>{symbol}</span>
        {name && <span className={styles.name}>{name}</span>}
      </div>

      <div className={styles.depthSelector} role="group" aria-label="Depth Limit">
        {DEPTH_LIMIT_OPTIONS.map((limit) => {
          const isActive = limit === depthLimit;

          return (
            <button
              key={limit}
              type="button"
              className={cn(styles.depthButton, isActive && styles.activeDepth)}
              data-depth={limit}
              data-active={isActive ? "true" : undefined}
              aria-pressed={isActive}
              onClick={() => onChangeDepthLimit(limit)}
            >
              {limit}
            </button>
          );
        })}
      </div>
    </div>
  );
}

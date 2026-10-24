import type { WindowKind } from "./types";

export const WINDOW_KINDS: readonly WindowKind[] = ["chart", "orderBook", "timeAndSales"] as const;

export const WINDOW_KIND_LABELS: Readonly<Record<WindowKind, string>> = {
  chart: "Chart",
  orderBook: "Level II",
  timeAndSales: "T & S",
} as const;

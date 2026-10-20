import type { WindowKind } from "../types/terminal-window";

export const windowKindLabels: Record<WindowKind, string> = {
  chart: "Chart",
  orderBook: "Level II",
  timeAndSales: "T & S",
};

export const WINDOW_CASCADE_OFFSET = 16;
export const WINDOW_CASCADE_STEP = 32;
export const WINDOW_CASCADE_MAX_SLOTS = 8;

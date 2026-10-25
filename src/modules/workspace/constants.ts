import type { WindowKind } from "@/src/shared/contracts";

export const WORKSPACE_STORAGE_KEY = "z-trader.workspace" as const;
export const CURRENT_WORKSPACE_VERSION = 1 as const;
export const DEFAULT_WORKSPACE_ID = "default" as const;

export const WINDOW_CASCADE_OFFSET = 16 as const;
export const WINDOW_CASCADE_STEP = 32 as const;
export const WINDOW_CASCADE_MAX_SLOTS = 8 as const;

export const DEFAULT_WINDOW_WIDTH = 380 as const;
export const DEFAULT_WINDOW_HEIGHT = 440 as const;
export const MIN_WINDOW_WIDTH = 260 as const;
export const MIN_WINDOW_HEIGHT = 180 as const;

export const DEFAULT_WINDOW_KIND_LABELS: Readonly<Record<WindowKind, string>> = {
  chart: "Chart",
  orderBook: "Level II",
  timeAndSales: "T & S",
} as const;

export const EMPTY_WORKSPACE_TITLE = "Your workspace is empty" as const;
export const EMPTY_WORKSPACE_INSTRUCTION =
  "Use New to open a Chart, Level II, or T & S window." as const;

import type { Instrument } from "./types";
import type { WindowKind } from "@/src/shared/contracts";

export const DEFAULT_INSTRUMENTS: readonly Instrument[] = [
  { symbol: "ES", name: "E-mini S&P 500" },
  { symbol: "NQ", name: "E-mini Nasdaq-100" },
  { symbol: "YM", name: "E-mini Dow Jones" },
  { symbol: "RTY", name: "E-mini Russell 2000" },
  { symbol: "CL", name: "Crude Oil" },
  { symbol: "GC", name: "Gold" },
  { symbol: "6E", name: "Euro FX" },
  { symbol: "ZB", name: "U.S. Treasury Bond" },
  { symbol: "MES", name: "Micro E-mini S&P 500" },
  { symbol: "MNQ", name: "Micro E-mini Nasdaq-100" },
] as const;

export const DEFAULT_WINDOW_KIND_LABELS: Readonly<Record<WindowKind, string>> = {
  chart: "Chart",
  orderBook: "Level II",
  timeAndSales: "T & S",
} as const;

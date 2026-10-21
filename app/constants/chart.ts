import type { Candle } from "@/app/types/chart";

export const DEMO_CANDLES: readonly Candle[] = [
  { time: "09:30", open: 100, high: 102, low: 99, close: 101.5 },
  { time: "09:31", open: 101.5, high: 103, low: 101, close: 102.25 },
  { time: "09:32", open: 102.25, high: 102.75, low: 100.5, close: 101 },
  { time: "09:33", open: 101, high: 101.5, low: 98.75, close: 99.5 },
  { time: "09:34", open: 99.5, high: 101.25, low: 99, close: 100.75 },
  { time: "09:35", open: 100.75, high: 103.5, low: 100.25, close: 103 },
  { time: "09:36", open: 103, high: 104, low: 101.75, close: 102.25 },
  { time: "09:37", open: 102.25, high: 104.5, low: 102, close: 104 },
];

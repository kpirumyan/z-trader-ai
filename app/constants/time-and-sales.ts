import type { Trade } from "@/app/types/time-and-sales";

export const DEMO_TRADES: readonly Trade[] = [
  { time: "09:37:06", price: 100.75, size: 3, side: "Buy" },
  { time: "09:37:05", price: 100.5, size: 8, side: "Sell" },
  { time: "09:37:04", price: 100.5, size: 2, side: "Sell" },
  { time: "09:37:03", price: 100.75, size: 12, side: "Buy" },
  { time: "09:37:02", price: 101, size: 5, side: "Buy" },
  { time: "09:37:01", price: 100.75, size: 4, side: "Sell" },
];

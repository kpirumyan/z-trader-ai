import type { PriceLevel } from "@/app/types/order-book";

export const DEMO_PRICE_LEVELS: readonly PriceLevel[] = [
  { price: 101.25, bidSize: 0, askSize: 24 },
  { price: 101, bidSize: 0, askSize: 38 },
  { price: 100.75, bidSize: 0, askSize: 16 },
  { price: 100.5, bidSize: 21, askSize: 0 },
  { price: 100.25, bidSize: 45, askSize: 0 },
  { price: 100, bidSize: 32, askSize: 0 },
];

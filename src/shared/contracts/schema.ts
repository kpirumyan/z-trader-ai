import { z } from "zod";

export const instrumentSchema = z.object({
  symbol: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

export const windowKindSchema = z.enum(["chart", "orderBook", "timeAndSales"]);

export const orderSideSchema = z.enum(["buy", "sell"]);

export const timeframeSchema = z.enum(["1m", "5m", "15m", "1h", "1d"]);

export const candleSchema = z
  .object({
    time: z.number().int().positive(),
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    volume: z.number().nonnegative(),
  })
  .refine(
    (c) =>
      c.high >= c.low &&
      c.high >= c.open &&
      c.high >= c.close &&
      c.low <= c.open &&
      c.low <= c.close,
    {
      message: "Candle high must be >= open, close, low, and low must be <= open, close, high",
    },
  );

export const tradeSchema = z.object({
  id: z.string().min(1),
  time: z.number().int().positive(),
  price: z.number().positive(),
  size: z.number().positive(),
  side: orderSideSchema,
});

export const orderBookLevelSchema = z.object({
  price: z.number().positive(),
  size: z.number().nonnegative(),
});

export const orderBookSnapshotSchema = z.object({
  symbol: z.string().trim().min(1),
  timestamp: z.number().int().positive(),
  bids: z.array(orderBookLevelSchema),
  asks: z.array(orderBookLevelSchema),
});

export const tickerQuoteSchema = z.object({
  symbol: z.string().trim().min(1),
  timestamp: z.number().int().positive(),
  lastPrice: z.number().positive(),
  bid: z.number().positive(),
  ask: z.number().positive(),
  volume24h: z.number().nonnegative(),
  change24hPct: z.number(),
});

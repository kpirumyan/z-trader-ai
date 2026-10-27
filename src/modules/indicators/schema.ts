import { z } from "zod";

export const indicatorTypeSchema = z.enum(["sma", "ema"]);

export const indicatorSourceKeySchema = z.enum([
  "close",
  "open",
  "high",
  "low",
  "hl2",
  "hlc3",
  "ohlc4",
]);

export const indicatorOverlayTypeSchema = z.enum(["overlay", "pane"]);

export const indicatorPointSchema = z.object({
  time: z.number(),
  value: z.number(),
});

export const smaConfigSchema = z.object({
  period: z.number().int().min(1).default(20),
  source: indicatorSourceKeySchema.default("close"),
});

export const emaConfigSchema = z.object({
  period: z.number().int().min(1).default(20),
  source: indicatorSourceKeySchema.default("close"),
});

export const indicatorConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sma"),
    period: z.number().int().min(1).default(20),
    source: indicatorSourceKeySchema.default("close"),
  }),
  z.object({
    type: z.literal("ema"),
    period: z.number().int().min(1).default(20),
    source: indicatorSourceKeySchema.default("close"),
  }),
]);

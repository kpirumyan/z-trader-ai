import { z } from "zod";

import { timeframeSchema } from "@/src/shared/contracts";

export const chartTypeSchema = z.enum(["candlestick", "bars", "line"]);

export const chartIndicatorTypeSchema = z.enum(["volume", "sma", "ema"]);

export const chartConfigSchema = z.object({
  timeframe: timeframeSchema,
  chartType: chartTypeSchema,
  indicators: z.array(chartIndicatorTypeSchema),
});

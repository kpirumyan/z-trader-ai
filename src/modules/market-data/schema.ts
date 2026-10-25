import { z } from "zod";

import { timeframeSchema } from "@/src/shared/contracts";

export const marketChannelSchema = z.enum(["candles", "orderBook", "trades", "ticker"]);

export const marketTopicSchema = z.object({
  symbol: z.string().trim().min(1),
  channel: marketChannelSchema,
  timeframe: timeframeSchema.optional(),
});

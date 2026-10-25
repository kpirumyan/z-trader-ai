import { z } from "zod";

import { orderSideSchema } from "@/src/shared/contracts";

export const orderBookDepthLimitSchema = z.union([z.literal(10), z.literal(20), z.literal(50)]);

export const orderBookRowSchema = z.object({
  price: z.number().positive(),
  size: z.number().nonnegative(),
  side: orderSideSchema,
  cumulativeSize: z.number().nonnegative(),
  depthPercent: z.number().min(0).max(100),
});

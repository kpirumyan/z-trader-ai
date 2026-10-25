import { z } from "zod";

export const tradeBufferLimitSchema = z.union([z.literal(50), z.literal(100), z.literal(250)]);

export const tradeSizeFilterSchema = z
  .object({
    minSize: z.number().nonnegative(),
    maxSize: z.number().positive().nullable(),
  })
  .refine((f) => f.maxSize === null || f.maxSize >= f.minSize, {
    message: "maxSize must be greater than or equal to minSize",
  });

import { z } from "zod";

export const windowKindSchema = z.enum(["chart", "orderBook", "timeAndSales"]);

export const instrumentSchema = z.object({
  symbol: z.string().trim().min(1, "Symbol is required"),
  name: z.string().trim().min(1, "Name is required"),
});

export type InstrumentSchemaInput = z.input<typeof instrumentSchema>;
export type InstrumentSchemaOutput = z.output<typeof instrumentSchema>;

import { z } from "zod";

export const windowPositionSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});

export const windowSizeSchema = z.object({
  width: z.number().int().min(200),
  height: z.number().int().min(150),
});

export const workspaceInstrumentSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
});

export const workspaceWindowSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["chart", "orderBook", "timeAndSales"]),
  instrument: workspaceInstrumentSchema,
  position: windowPositionSchema,
  size: windowSizeSchema.optional(),
  zIndex: z.number().int().nonnegative(),
});

export const workspaceRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  windows: z.array(workspaceWindowSchema),
});

export const workspaceStorageSchema = z.object({
  version: z.literal(1),
  activeWorkspaceId: z.string().min(1),
  workspaces: z.array(workspaceRecordSchema).min(1),
});

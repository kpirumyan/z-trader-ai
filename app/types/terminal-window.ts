import type { Instrument } from "./instrument";

export type WindowKind = "chart" | "orderBook" | "timeAndSales";

export type SearchTarget = { kind: WindowKind; windowId?: string };

export type TerminalWindow = {
  id: string;
  kind: WindowKind;
  instrument: Instrument;
  position: { x: number; y: number };
};

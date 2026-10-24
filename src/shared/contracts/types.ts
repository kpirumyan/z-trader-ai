import type { ComponentType } from "react";

export type WindowKind = "chart" | "orderBook" | "timeAndSales";

export interface Instrument {
  readonly symbol: string;
  readonly name: string;
}

export interface WidgetProps {
  readonly windowId: string;
  readonly instrument: Instrument;
  readonly onChangeInstrument?: () => void;
  readonly isFocused?: boolean;
}

export interface WidgetDefinition {
  readonly kind: WindowKind;
  readonly title: string;
  readonly component: ComponentType<WidgetProps>;
}

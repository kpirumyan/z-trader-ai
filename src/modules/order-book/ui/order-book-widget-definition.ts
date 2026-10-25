import { ORDER_BOOK_WIDGET_KIND, ORDER_BOOK_WIDGET_TITLE } from "../constants";
import { OrderBookWidget } from "./order-book-widget";

import type { WidgetDefinition, WidgetProps } from "@/src/shared/contracts";
import type { ComponentType } from "react";

export const orderBookWidgetDefinition: WidgetDefinition = {
  kind: ORDER_BOOK_WIDGET_KIND,
  title: ORDER_BOOK_WIDGET_TITLE,
  component: OrderBookWidget as ComponentType<WidgetProps>,
};

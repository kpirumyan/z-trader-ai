import { TIME_AND_SALES_WIDGET_KIND, TIME_AND_SALES_WIDGET_TITLE } from "../constants";
import { TimeAndSalesWidget } from "./time-and-sales-widget";

import type { WidgetDefinition, WidgetProps } from "@/src/shared/contracts";
import type { ComponentType } from "react";

export const timeAndSalesWidgetDefinition: WidgetDefinition = {
  kind: TIME_AND_SALES_WIDGET_KIND,
  title: TIME_AND_SALES_WIDGET_TITLE,
  component: TimeAndSalesWidget as ComponentType<WidgetProps>,
};

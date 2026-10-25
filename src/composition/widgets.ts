import { chartWidgetDefinition } from "@/src/modules/chart";
import { orderBookWidgetDefinition } from "@/src/modules/order-book";

import type { WidgetDefinition } from "@/src/shared/contracts";

export const WIDGET_REGISTRY: readonly WidgetDefinition[] = [
  chartWidgetDefinition,
  orderBookWidgetDefinition,
];

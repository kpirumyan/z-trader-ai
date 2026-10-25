"use client";

import { WIDGET_REGISTRY } from "@/src/composition/widgets";
import { TerminalShell } from "@/src/modules/workspace";

export function TerminalApp() {
  return <TerminalShell widgets={WIDGET_REGISTRY} />;
}

"use client";

import { TerminalShell } from "@/src/modules/workspace";

import { WIDGET_REGISTRY } from "./widgets";

export function TerminalApp() {
  return <TerminalShell widgets={WIDGET_REGISTRY} />;
}

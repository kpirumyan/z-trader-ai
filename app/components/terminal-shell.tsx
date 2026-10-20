"use client";

import { TopBar } from "./top-bar";
import { WorkspaceCanvas } from "./workspace-canvas";

export function TerminalShell() {
  return (
    <div className="terminal-shell">
      <TopBar />
      <WorkspaceCanvas />
    </div>
  );
}

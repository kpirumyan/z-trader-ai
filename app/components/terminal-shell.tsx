"use client";

import { Suspense } from "react";
import { TopBar } from "./top-bar";
import { WorkspaceCanvas, WorkspaceState } from "./workspace-canvas";

export function TerminalShell() {
  return (
    <div className="terminal-shell">
      <TopBar />
      <WorkspaceCanvas>
        <Suspense fallback={null}>
          <WorkspaceState />
        </Suspense>
      </WorkspaceCanvas>
    </div>
  );
}

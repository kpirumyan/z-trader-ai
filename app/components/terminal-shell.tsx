"use client";

import { Suspense, useRef, useState } from "react";
import { NewMenuPopover } from "./new-menu-popover";
import { TopBar } from "./top-bar";
import { WorkspaceCanvas, WorkspaceState } from "./workspace-canvas";

export function TerminalShell() {
  const [isNewOpen, setIsNewOpen] = useState(false);
  const newButtonRef = useRef<HTMLButtonElement>(null);

  function closeNew() {
    setIsNewOpen(false);
    newButtonRef.current?.focus();
  }

  return (
    <div className="terminal-shell">
      <TopBar newButtonRef={newButtonRef} isNewOpen={isNewOpen} onNew={() => setIsNewOpen(true)} />
      <WorkspaceCanvas>
        <Suspense fallback={null}>
          <WorkspaceState />
        </Suspense>
      </WorkspaceCanvas>
      {isNewOpen && <NewMenuPopover onClose={closeNew} />}
    </div>
  );
}

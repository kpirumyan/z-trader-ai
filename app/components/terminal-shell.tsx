"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceWindows } from "../hooks/use-workspace-windows";
import { demoInstrumentCatalog } from "../instruments/instrument-catalog";
import type { Instrument } from "../types/instrument";
import type { WindowKind } from "../types/terminal-window";
import { InstrumentSearchDialog } from "./instrument-search-dialog";
import { NewMenuPopover } from "./new-menu-popover";
import { TerminalWindow } from "./terminal-window";
import { TopBar } from "./top-bar";
import { WorkspaceCanvas, WorkspaceState } from "./workspace-canvas";

type SearchTarget = { kind: WindowKind; windowId?: string };

export function TerminalShell() {
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const [focusedWindowId, setFocusedWindowId] = useState<string | null>(null);
  const { windows, addWindow, changeInstrument } = useWorkspaceWindows();
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusToNew = useRef(false);
  useEffect(() => {
    if (!searchTarget && returnFocusToNew.current) {
      returnFocusToNew.current = false;
      newButtonRef.current?.focus();
    }
  }, [searchTarget]);
  const closeNew = useCallback(() => {
    setIsNewOpen(false);
    newButtonRef.current?.focus();
  }, []);

  function selectInstrument(instrument: Instrument) {
    if (!searchTarget) return;
    if (searchTarget.windowId) {
      changeInstrument(searchTarget.windowId, instrument);
      setFocusedWindowId(searchTarget.windowId);
    } else {
      setFocusedWindowId(addWindow(searchTarget.kind, instrument));
    }
    setSearchTarget(null);
  }

  return (
    <div className="terminal-shell">
      <TopBar newButtonRef={newButtonRef} isNewOpen={isNewOpen} onNew={() => setIsNewOpen((open) => !open)}>
        {isNewOpen && <NewMenuPopover onClose={closeNew} onSelect={(kind) => {
          setIsNewOpen(false);
          setSearchTarget({ kind });
        }} />}
      </TopBar>
      <WorkspaceCanvas>
        <Suspense fallback={null}>
          <WorkspaceState hasWindows={windows.length > 0}>
            <div className="workspace-windows">
              {windows.map((window) => (
                <TerminalWindow key={window.id} window={window} focused={focusedWindowId === window.id}
                  onChangeInstrument={() => {
                    setFocusedWindowId(null);
                    setSearchTarget({ kind: window.kind, windowId: window.id });
                  }} />
              ))}
            </div>
          </WorkspaceState>
        </Suspense>
      </WorkspaceCanvas>
      {searchTarget && <InstrumentSearchDialog kind={searchTarget.kind} catalog={demoInstrumentCatalog}
        onSelect={selectInstrument} onCancel={() => {
          returnFocusToNew.current = true;
          setSearchTarget(null);
        }} />}
    </div>
  );
}

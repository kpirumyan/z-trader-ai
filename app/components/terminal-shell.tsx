"use client";

import { Suspense, useEffect, useRef, useState } from "react";

import { InstrumentSearchDialog } from "./instrument-search-dialog";
import { NewMenuPopover } from "./new-menu-popover";
import { TerminalWindow } from "./terminal-window";
import { TopBar } from "./top-bar";
import { WorkspaceCanvas, WorkspaceState } from "./workspace-canvas";
import { useWorkspaceWindows } from "../hooks/use-workspace-windows";
import { demoInstrumentCatalog } from "../instruments/instrument-catalog";

import type { Instrument } from "../types/instrument";
import type { SearchTarget } from "../types/terminal-window";

export function TerminalShell() {
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const [focusedWindowId, setFocusedWindowId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const { windows, addWindow, changeInstrument } = useWorkspaceWindows();
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusToNew = useRef(false);

  useEffect(() => {
    if (!searchTarget && returnFocusToNew.current) {
      returnFocusToNew.current = false;
      newButtonRef.current?.focus();
    }
  }, [searchTarget]);

  function closeNew() {
    setIsNewOpen(false);
    newButtonRef.current?.focus();
  }

  function activateWindow(id: string) {
    setFocusedWindowId(id);
    setFocusRequest((request) => request + 1);
  }

  function selectInstrument(instrument: Instrument) {
    if (!searchTarget) return;

    if (searchTarget.windowId) {
      changeInstrument(searchTarget.windowId, instrument);
      activateWindow(searchTarget.windowId);
    } else {
      activateWindow(addWindow(searchTarget.kind, instrument));
    }

    setSearchTarget(null);
  }

  return (
    <div className="terminal-shell">
      <TopBar
        newButtonRef={newButtonRef}
        isNewOpen={isNewOpen}
        onNew={() => setIsNewOpen((open) => !open)}
      >
        {isNewOpen && (
          <NewMenuPopover
            onClose={closeNew}
            onSelect={(kind) => {
              setIsNewOpen(false);
              setSearchTarget({ kind });
            }}
          />
        )}
      </TopBar>

      <WorkspaceCanvas>
        <Suspense fallback={null}>
          <WorkspaceState hasWindows={windows.length > 0}>
            <div className="workspace-windows">
              {windows.map((window) => (
                <TerminalWindow
                  key={window.id}
                  window={window}
                  focused={focusedWindowId === window.id}
                  focusRequest={focusRequest}
                  onActivate={() => activateWindow(window.id)}
                  onChangeInstrument={() => {
                    setSearchTarget({ kind: window.kind, windowId: window.id });
                  }}
                />
              ))}
            </div>
          </WorkspaceState>
        </Suspense>
      </WorkspaceCanvas>

      {searchTarget && (
        <InstrumentSearchDialog
          kind={searchTarget.kind}
          catalog={demoInstrumentCatalog}
          onSelect={selectInstrument}
          onCancel={() => {
            returnFocusToNew.current = true;
            setSearchTarget(null);
          }}
        />
      )}
    </div>
  );
}

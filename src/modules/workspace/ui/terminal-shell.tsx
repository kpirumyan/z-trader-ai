"use client";

import { useEffect, useRef, useState } from "react";

import { demoInstrumentCatalog, InstrumentSearchDialog } from "@/src/modules/instruments";

import { DEFAULT_WINDOW_KIND_LABELS } from "../constants";
import { NewMenuPopover } from "./new-menu-popover";
import { StatusBar } from "./status-bar";
import styles from "./terminal-shell.module.css";
import { TerminalWindow } from "./terminal-window";
import { TopBar } from "./top-bar";
import { WorkspaceCanvas } from "./workspace-canvas";
import { useWorkspaceStore } from "../model/workspace-store";

import type { TerminalShellProps } from "../types";
import type { Instrument, WindowKind } from "@/src/shared/contracts";

export function TerminalShell({ widgets = [], className }: TerminalShellProps) {
  const windows = useWorkspaceStore((state) => state.windows);
  const activeWindowId = useWorkspaceStore((state) => state.activeWindowId);
  const isInitialized = useWorkspaceStore((state) => state.isInitialized);
  const addWindow = useWorkspaceStore((state) => state.addWindow);
  const closeWindow = useWorkspaceStore((state) => state.closeWindow);
  const focusWindow = useWorkspaceStore((state) => state.focusWindow);
  const moveWindow = useWorkspaceStore((state) => state.moveWindow);
  const changeInstrument = useWorkspaceStore((state) => state.changeInstrument);
  const loadWorkspace = useWorkspaceStore((state) => state.loadWorkspace);

  const [isNewOpen, setIsNewOpen] = useState(false);
  const newButtonRef = useRef<HTMLButtonElement>(null);

  const [searchTarget, setSearchTarget] = useState<{
    kind: WindowKind;
    windowId?: string;
  } | null>(null);

  useEffect(() => {
    if (!isInitialized) {
      loadWorkspace();
    }
  }, [isInitialized, loadWorkspace]);

  const handleSelectWidgetKind = (kind: WindowKind) => {
    setIsNewOpen(false);
    setSearchTarget({ kind });
  };

  const handleChangeInstrument = (windowId: string) => {
    const targetWin = windows.find((w) => w.id === windowId);

    if (targetWin) {
      setSearchTarget({ kind: targetWin.kind, windowId: targetWin.id });
    }
  };

  const handleSelectInstrument = (instrument: Instrument) => {
    if (searchTarget) {
      if (searchTarget.windowId) {
        changeInstrument(searchTarget.windowId, instrument);
      } else {
        addWindow(searchTarget.kind, instrument);
      }
    }

    setSearchTarget(null);
  };

  return (
    <div className={`${styles.terminalShell} ${className ?? ""}`.trim()}>
      <TopBar
        isNewOpen={isNewOpen}
        newButtonRef={newButtonRef}
        onToggleNew={() => setIsNewOpen((prev) => !prev)}
      >
        {isNewOpen && (
          <NewMenuPopover
            widgets={widgets}
            onClose={() => {
              setIsNewOpen(false);
              newButtonRef.current?.focus();
            }}
            onSelect={handleSelectWidgetKind}
          />
        )}
      </TopBar>

      <WorkspaceCanvas isEmpty={windows.length === 0}>
        {windows.map((win) => {
          const widgetDef = widgets.find((w) => w.kind === win.kind);

          return (
            <TerminalWindow
              key={win.id}
              window={win}
              widgetDefinition={widgetDef}
              isFocused={win.id === activeWindowId}
              onClose={closeWindow}
              onFocus={focusWindow}
              onMove={moveWindow}
              onChangeInstrument={handleChangeInstrument}
            />
          );
        })}
      </WorkspaceCanvas>

      <StatusBar />

      {searchTarget && (
        <InstrumentSearchDialog
          kind={searchTarget.kind}
          title={
            searchTarget.windowId
              ? "Change Instrument"
              : `Add ${DEFAULT_WINDOW_KIND_LABELS[searchTarget.kind] ?? searchTarget.kind}`
          }
          catalog={demoInstrumentCatalog}
          onSelect={handleSelectInstrument}
          onCancel={() => setSearchTarget(null)}
        />
      )}
    </div>
  );
}

import { useRef, useState } from "react";
import {
  WINDOW_CASCADE_MAX_SLOTS,
  WINDOW_CASCADE_OFFSET,
  WINDOW_CASCADE_STEP,
} from "../constants/terminal-window";
import type { Instrument } from "../types/instrument";
import type { TerminalWindow, WindowKind } from "../types/terminal-window";

export function useWorkspaceWindows() {
  const [windows, setWindows] = useState<TerminalWindow[]>([]);
  const nextId = useRef(0);
  function addWindow(kind: WindowKind, instrument: Instrument) {
    const id = `window-${++nextId.current}`;
    setWindows((current) => {
      const offset = WINDOW_CASCADE_OFFSET + (current.length % WINDOW_CASCADE_MAX_SLOTS) * WINDOW_CASCADE_STEP;
      return [...current, { id, kind, instrument, position: { x: offset, y: offset } }];
    });
    return id;
  }
  function changeInstrument(id: string, instrument: Instrument) {
    setWindows((current) => current.map((window) =>
      window.id === id ? { ...window, instrument } : window,
    ));
  }
  return { windows, addWindow, changeInstrument };
}

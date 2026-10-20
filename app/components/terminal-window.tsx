import { useEffect, useRef } from "react";
import { windowKindLabels } from "../constants/terminal-window";
import type { TerminalWindow as WindowModel } from "../types/terminal-window";

export function TerminalWindow({ window, focused, onChangeInstrument }: {
  window: WindowModel;
  focused: boolean;
  onChangeInstrument: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.focus();
  }, [focused, window.instrument]);
  return (
    <section ref={ref} className="terminal-window" role="region" tabIndex={-1}
      style={{ left: window.position.x, top: window.position.y }}
      aria-label={`${windowKindLabels[window.kind]} ${window.instrument.symbol}`}>
      <header className="terminal-window-heading">
        <span>{windowKindLabels[window.kind]}</span>
        <button type="button" aria-label="Change instrument" onClick={onChangeInstrument}>
          {window.instrument.symbol}<span aria-hidden="true"> ▾</span>
        </button>
      </header>
    </section>
  );
}

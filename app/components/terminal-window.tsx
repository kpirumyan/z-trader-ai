import { useEffect, useRef } from "react";
import { windowKindLabels } from "../constants/terminal-window";
import type { TerminalWindow as WindowModel } from "../types/terminal-window";
import { Chart } from "./chart";
import { OrderBook } from "./order-book";
import { TimeAndSales } from "./time-and-sales";

export function TerminalWindow({
  window,
  focused,
  focusRequest = 0,
  onChangeInstrument,
  onActivate,
}: {
  window: WindowModel;
  focused: boolean;
  focusRequest?: number;
  onChangeInstrument: () => void;
  onActivate?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focused) ref.current?.focus();
  }, [focused, focusRequest, window.instrument]);

  const top = `min(${window.position.y}px, max(16px, calc(100% - 344px)))`;

  return (
    <section
      ref={ref}
      className="terminal-window"
      role="region"
      tabIndex={-1}
      onPointerDown={onActivate}
      onFocus={onActivate}
      style={{
        left: window.position.x,
        width: `min(360px, calc(100% - ${window.position.x}px - 16px))`,
        top,
        maxHeight: `calc(100% - ${top} - 64px)`,
        zIndex: focused ? 1 : 0,
      }}
      aria-label={`${windowKindLabels[window.kind]} ${window.instrument.symbol}`}
    >
      <header className="terminal-window-heading">
        <span>{windowKindLabels[window.kind]}</span>
        <button type="button" aria-label="Change instrument" onClick={onChangeInstrument}>
          {window.instrument.symbol}
          <span aria-hidden="true"> ▾</span>
        </button>
      </header>
      <div className="terminal-window-content">
        {window.kind === "chart" && <Chart symbol={window.instrument.symbol} />}
        {window.kind === "orderBook" && <OrderBook symbol={window.instrument.symbol} />}
        {window.kind === "timeAndSales" && <TimeAndSales symbol={window.instrument.symbol} />}
      </div>
    </section>
  );
}

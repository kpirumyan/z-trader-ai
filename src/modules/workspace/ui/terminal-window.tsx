"use client";

import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_KIND_LABELS,
  DEFAULT_WINDOW_WIDTH,
} from "../constants";
import styles from "./terminal-window.module.css";

import type { TerminalWindowProps } from "../types";

export function TerminalWindow({
  window,
  widgetDefinition,
  isFocused,
  onClose,
  onFocus,
  onMove,
  onChangeInstrument,
}: TerminalWindowProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    windowX: number;
    windowY: number;
  } | null>(null);

  useEffect(() => {
    if (isFocused) {
      sectionRef.current?.focus();
    }
  }, [isFocused, window.instrument.symbol]);

  const title = DEFAULT_WINDOW_KIND_LABELS[window.kind] ?? widgetDefinition?.title ?? window.kind;

  const width = window.size?.width ?? DEFAULT_WINDOW_WIDTH;
  const height = window.size?.height ?? DEFAULT_WINDOW_HEIGHT;

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }

    onFocus(window.id);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore environments where pointer capture is unsupported
    }

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      windowX: window.position.x,
      windowY: window.position.y,
    };

    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!isDragging || !dragRef.current) return;

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const nextX = Math.max(0, Math.round(dragRef.current.windowX + dx));
    const nextY = Math.max(0, Math.round(dragRef.current.windowY + dy));

    onMove(window.id, { x: nextX, y: nextY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (isDragging) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore errors if capture was lost
      }

      setIsDragging(false);
      dragRef.current = null;
    }
  };

  const WidgetComponent = widgetDefinition?.component;

  return (
    <section
      ref={sectionRef}
      className={styles.window}
      role="region"
      tabIndex={-1}
      aria-label={`${title} ${window.instrument.symbol}`}
      data-focused={isFocused}
      style={{
        transform: `translate3d(${window.position.x}px, ${window.position.y}px, 0)`,
        zIndex: window.zIndex,
        width,
        height,
      }}
      onPointerDown={() => onFocus(window.id)}
    >
      <header
        className={styles.header}
        data-dragging={isDragging}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className={styles.titleGroup}>
          <span className={styles.title}>{title}</span>
          <span className={styles.symbol}>{window.instrument.symbol}</span>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionButton}
            aria-label="Change instrument"
            title="Change instrument"
            onClick={(e) => {
              e.stopPropagation();
              onChangeInstrument(window.id);
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>

          <button
            type="button"
            className={styles.actionButton}
            aria-label="Close window"
            title="Close window"
            onClick={(e) => {
              e.stopPropagation();
              onClose(window.id);
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      <div className={styles.content}>
        {WidgetComponent ? (
          <WidgetComponent
            windowId={window.id}
            instrument={window.instrument}
            onChangeInstrument={() => onChangeInstrument(window.id)}
            isFocused={isFocused}
          />
        ) : null}
      </div>
    </section>
  );
}

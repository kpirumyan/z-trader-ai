"use client";

import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_KIND_LABELS,
  DEFAULT_WINDOW_WIDTH,
  MINIMIZED_WINDOW_HEIGHT,
  MINIMIZED_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
} from "../constants";
import styles from "./terminal-window.module.css";

import type { TerminalWindowProps } from "../types";

export function TerminalWindow({
  window,
  widgetDefinition,
  isFocused,
  renderPosition,
  renderSize,
  onClose,
  onFocus,
  onMove,
  onResize,
  onToggleMinimize,
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

  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const isMinimized = Boolean(window.isMinimized);
  const prevMinimizedRef = useRef(isMinimized);
  const unminimizedPendingFocusRef = useRef(false);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    const wasMinimized = prevMinimizedRef.current;

    prevMinimizedRef.current = isMinimized;

    if (wasMinimized && !isMinimized) {
      unminimizedPendingFocusRef.current = true;
    } else if (!wasMinimized && isMinimized) {
      unminimizedPendingFocusRef.current = false;
    }

    if (!isFocused || !sectionRef.current) return;

    if (
      unminimizedPendingFocusRef.current ||
      !sectionRef.current.contains(document.activeElement)
    ) {
      unminimizedPendingFocusRef.current = false;
      sectionRef.current.focus();
    }
  }, [isFocused, isMinimized, window.instrument.symbol]);

  const title = DEFAULT_WINDOW_KIND_LABELS[window.kind] ?? widgetDefinition?.title ?? window.kind;

  const posX = renderPosition?.x ?? window.position.x;
  const posY = renderPosition?.y ?? window.position.y;
  const width =
    renderSize?.width ??
    (isMinimized ? MINIMIZED_WINDOW_WIDTH : (window.size?.width ?? DEFAULT_WINDOW_WIDTH));
  const height =
    renderSize?.height ??
    (isMinimized ? MINIMIZED_WINDOW_HEIGHT : (window.size?.height ?? DEFAULT_WINDOW_HEIGHT));

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }

    onFocus(window.id);

    if (isMinimized) {
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore environments where pointer capture is unsupported
    }

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      windowX: posX,
      windowY: posY,
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

  const handleResizePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onFocus(window.id);

    resizeCleanupRef.current?.();

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = width;
    const startHeight = height;

    const handleWindowPointerMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const newWidth = Math.max(MIN_WINDOW_WIDTH, Math.round(startWidth + dx));
      const newHeight = Math.max(MIN_WINDOW_HEIGHT, Math.round(startHeight + dy));

      onResize(window.id, { width: newWidth, height: newHeight });
    };

    const handleWindowPointerUp = () => {
      if (typeof globalThis.window !== "undefined") {
        globalThis.window.removeEventListener("pointermove", handleWindowPointerMove);
        globalThis.window.removeEventListener("pointerup", handleWindowPointerUp);
        globalThis.window.removeEventListener("pointercancel", handleWindowPointerUp);
      }

      resizeCleanupRef.current = null;
    };

    if (typeof globalThis.window !== "undefined") {
      globalThis.window.addEventListener("pointermove", handleWindowPointerMove);
      globalThis.window.addEventListener("pointerup", handleWindowPointerUp);
      globalThis.window.addEventListener("pointercancel", handleWindowPointerUp);

      resizeCleanupRef.current = () => {
        globalThis.window.removeEventListener("pointermove", handleWindowPointerMove);
        globalThis.window.removeEventListener("pointerup", handleWindowPointerUp);
        globalThis.window.removeEventListener("pointercancel", handleWindowPointerUp);
      };
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
      data-minimized={isMinimized ? "true" : "false"}
      style={{
        left: `${posX}px`,
        top: `${posY}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: window.zIndex,
      }}
      onPointerDown={() => onFocus(window.id)}
      onFocusCapture={() => onFocus(window.id)}
    >
      <header
        className={styles.header}
        data-dragging={isDragging}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => {
          const wasMinimized = isMinimized;

          onToggleMinimize(window.id);

          if (wasMinimized) {
            onFocus(window.id);
            sectionRef.current?.focus();
          }
        }}
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
            onDoubleClick={(e) => e.stopPropagation()}
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
            aria-label={isMinimized ? "Restore window" : "Minimize window"}
            title={isMinimized ? "Restore window" : "Minimize window"}
            onClick={(e) => {
              e.stopPropagation();

              const wasMinimized = isMinimized;

              if (wasMinimized) {
                e.currentTarget.blur();
              }

              onToggleMinimize(window.id);

              if (wasMinimized) {
                onFocus(window.id);
                sectionRef.current?.focus();
              }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {isMinimized ? "▲" : "—"}
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
            onDoubleClick={(e) => e.stopPropagation()}
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

      <div className={styles.content} style={isMinimized ? { display: "none" } : undefined}>
        {WidgetComponent ? (
          <WidgetComponent
            windowId={window.id}
            instrument={window.instrument}
            onChangeInstrument={() => onChangeInstrument(window.id)}
            isFocused={isFocused}
          />
        ) : null}
      </div>

      {!isMinimized && (
        <div
          className={styles.resizeHandle}
          data-testid="resize-handle"
          aria-label="Resize window"
          onPointerDown={handleResizePointerDown}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="12" y1="4" x2="4" y2="12" />
            <line x1="12" y1="8" x2="8" y2="12" />
          </svg>
        </div>
      )}
    </section>
  );
}

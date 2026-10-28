"use client";

import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";

import {
  EMPTY_WORKSPACE_INSTRUCTION,
  EMPTY_WORKSPACE_TITLE,
  MINIMIZED_WINDOW_GAP,
  MINIMIZED_WINDOW_HEIGHT,
  MINIMIZED_WINDOW_MARGIN,
  MINIMIZED_WINDOW_WIDTH,
} from "../constants";
import styles from "./workspace-canvas.module.css";

import type { TerminalWindowProps, WorkspaceCanvasProps } from "../types";

export function WorkspaceCanvas({ children, isEmpty = false, onClearFocus }: WorkspaceCanvasProps) {
  const mainRef = useRef<HTMLElement>(null);
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({
    width: 1024,
    height: 768,
  });

  useEffect(() => {
    const updateSize = () => {
      if (mainRef.current) {
        const rect = mainRef.current.getBoundingClientRect?.() ?? { width: 0, height: 0 };
        const width = mainRef.current.clientWidth || rect.width;
        const height = mainRef.current.clientHeight || rect.height;

        if (width > 0 && height > 0) {
          setCanvasDimensions((prev) =>
            prev.width === width && prev.height === height ? prev : { width, height },
          );
        }
      }
    };

    updateSize();

    if (typeof ResizeObserver !== "undefined" && mainRef.current) {
      const observer = new ResizeObserver(updateSize);

      observer.observe(mainRef.current);

      return () => observer.disconnect();
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (
      e.target === e.currentTarget ||
      (e.target as HTMLElement)?.closest?.(`.${styles.watermark}`)
    ) {
      onClearFocus?.();
    }
  };

  const canvasWidth = canvasDimensions.width;
  const canvasHeight = canvasDimensions.height;

  let minimizedIndex = 0;
  const itemsPerRow = Math.max(
    1,
    Math.floor(
      (canvasWidth - 2 * MINIMIZED_WINDOW_MARGIN) / (MINIMIZED_WINDOW_WIDTH + MINIMIZED_WINDOW_GAP),
    ),
  );

  const processedChildren = React.Children.map(children, (child) => {
    if (!React.isValidElement<TerminalWindowProps>(child)) {
      return child;
    }

    const childProps = child.props;

    if (childProps.window?.isMinimized) {
      const k = minimizedIndex++;
      const col = k % itemsPerRow;
      const row = Math.floor(k / itemsPerRow);
      const renderX =
        MINIMIZED_WINDOW_MARGIN + col * (MINIMIZED_WINDOW_WIDTH + MINIMIZED_WINDOW_GAP);
      const renderY = canvasHeight - (row + 1) * (MINIMIZED_WINDOW_HEIGHT + MINIMIZED_WINDOW_GAP);

      return React.cloneElement(child, {
        renderPosition: childProps.renderPosition ?? { x: renderX, y: renderY },
        renderSize: childProps.renderSize ?? {
          width: MINIMIZED_WINDOW_WIDTH,
          height: MINIMIZED_WINDOW_HEIGHT,
        },
      });
    }

    return child;
  });

  return (
    <main
      ref={mainRef}
      className={styles.canvas}
      role="main"
      aria-label="Workspace"
      onPointerDown={handlePointerDown}
    >
      <div className={styles.watermark} aria-hidden="true">
        <Image
          className="theme-light-only"
          src="/logo-full.png"
          alt=""
          width={1254}
          height={1254}
          loading="eager"
          fetchPriority="high"
          unoptimized
        />
        <Image
          className="theme-dark-only"
          src="/logo-full-dark.png"
          alt=""
          width={1254}
          height={1254}
          loading="eager"
          fetchPriority="high"
          unoptimized
        />
      </div>

      {isEmpty && (
        <div className={styles.emptyInstruction}>
          <h1 className={styles.emptyTitle}>{EMPTY_WORKSPACE_TITLE}</h1>
          <p className={styles.emptyText}>{EMPTY_WORKSPACE_INSTRUCTION}</p>
        </div>
      )}

      {processedChildren}
    </main>
  );
}

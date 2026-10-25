"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./new-menu-popover.module.css";

import type { NewMenuPopoverProps } from "../types";

export function NewMenuPopover({ widgets, onClose, onSelect }: NewMenuPopoverProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  useEffect(() => {
    const handlePointerDownOutside = (e: PointerEvent | MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest('button[aria-haspopup="menu"]')) {
        return;
      }

      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDownOutside);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDownOutside);
    };
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (widgets.length === 0) return;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % widgets.length);
        break;
      }

      case "ArrowUp": {
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + widgets.length) % widgets.length);
        break;
      }

      case "Home": {
        e.preventDefault();
        setFocusedIndex(0);
        break;
      }

      case "End": {
        e.preventDefault();
        setFocusedIndex(widgets.length - 1);
        break;
      }

      case "Escape": {
        e.preventDefault();
        onClose();
        break;
      }

      case "Tab": {
        onClose();
        break;
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={styles.menu}
      role="menu"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {widgets.map((widget, index) => (
        <button
          key={widget.kind}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          type="button"
          role="menuitem"
          className={styles.menuItem}
          data-focused={index === focusedIndex}
          tabIndex={index === focusedIndex ? 0 : -1}
          onClick={() => {
            onSelect(widget.kind);
            onClose();
          }}
        >
          {widget.title}
        </button>
      ))}
    </div>
  );
}

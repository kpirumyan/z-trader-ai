import { useEffect, useRef } from "react";

import { windowKindLabels } from "../constants/terminal-window";

import type { WindowKind } from "../types/terminal-window";

type NewMenuPopoverProps = { onClose: () => void; onSelect: (kind: WindowKind) => void };

export function NewMenuPopover({ onClose, onSelect }: NewMenuPopoverProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    function outsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.parentElement?.contains(event.target))
        onClose();
    }

    document.addEventListener("pointerdown", outsideClick);

    return () => document.removeEventListener("pointerdown", outsideClick);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="new-menu"
      role="menu"
      aria-label="New window"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();

          const items = Array.from(
            menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
          );
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;

          items[next]?.focus();
        } else if (event.key === "Tab") onClose();
      }}
    >
      {(Object.keys(windowKindLabels) as WindowKind[]).map((kind) => (
        <button key={kind} type="button" role="menuitem" onClick={() => onSelect(kind)}>
          {windowKindLabels[kind]}
        </button>
      ))}
    </div>
  );
}

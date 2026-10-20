import Image from "next/image";
import type { Ref } from "react";
import { ThemeToggle } from "./theme-toggle";

type TopBarProps = {
  newButtonRef: Ref<HTMLButtonElement>;
  isNewOpen: boolean;
  onNew: () => void;
};

export function TopBar({ newButtonRef, isNewOpen, onNew }: TopBarProps) {
  return (
    <header className="top-bar" role="banner">
      <div className="terminal-brand" aria-label="Z-Trader AI">
        <span className="brand-symbol" aria-hidden="true">
          <Image
            className="theme-light-only" src="/logo.png" alt=""
            width={1254} height={1254} loading="eager" fetchPriority="high" unoptimized
          />
          <Image
            className="theme-dark-only" src="/logo-dark.png" alt=""
            width={1254} height={1254} loading="eager" fetchPriority="high" unoptimized
          />
        </span>
        <span className="brand-wordmark" aria-hidden="true">
          <Image
            className="theme-light-only" src="/brand.png" alt=""
            width={1448} height={1086} loading="eager" fetchPriority="high" unoptimized
          />
          <Image
            className="theme-dark-only" src="/brand-dark.png" alt=""
            width={1448} height={1086} loading="eager" fetchPriority="high" unoptimized
          />
        </span>
      </div>
      <button
        ref={newButtonRef}
        className="new-button"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isNewOpen}
        onClick={onNew}
      >
        New
      </button>
      <ThemeToggle />
    </header>
  );
}

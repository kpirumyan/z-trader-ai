"use client";

import Image from "next/image";

import { ThemeToggle } from "@/src/shared/theme";

import styles from "./top-bar.module.css";

import type { TopBarProps } from "../types";

export function TopBar({
  isNewOpen,
  newButtonRef,
  onToggleNew,
  onClearFocus,
  children,
}: TopBarProps) {
  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.target === e.currentTarget) {
      onClearFocus?.();
    }
  };

  return (
    <header className={styles.topBar} role="banner" onPointerDown={handlePointerDown}>
      <div className={styles.brand} aria-label="Z-Trader AI">
        <span className={styles.brandSymbol} aria-hidden="true">
          <Image
            className="theme-light-only"
            src="/logo.png"
            alt=""
            width={1254}
            height={1254}
            loading="eager"
            fetchPriority="high"
            unoptimized
          />
          <Image
            className="theme-dark-only"
            src="/logo-dark.png"
            alt=""
            width={1254}
            height={1254}
            loading="eager"
            fetchPriority="high"
            unoptimized
          />
        </span>
        <span className={styles.brandWordmark} aria-hidden="true">
          <Image
            className="theme-light-only"
            src="/brand.png"
            alt=""
            width={1448}
            height={1086}
            loading="eager"
            fetchPriority="high"
            unoptimized
          />
          <Image
            className="theme-dark-only"
            src="/brand-dark.png"
            alt=""
            width={1448}
            height={1086}
            loading="eager"
            fetchPriority="high"
            unoptimized
          />
        </span>
      </div>

      <div className={styles.newAnchor}>
        <button
          ref={newButtonRef}
          type="button"
          className={styles.newButton}
          aria-haspopup="menu"
          aria-expanded={isNewOpen}
          onClick={onToggleNew}
        >
          New
        </button>
        {children}
      </div>

      <div className={styles.themeToggleWrapper}>
        <ThemeToggle />
      </div>
    </header>
  );
}

"use client";

import { useEffect, useState } from "react";

import styles from "./status-bar.module.css";

import type { StatusBarProps } from "../types";

function formatUtcTime(date: Date): string {
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${hours}:${minutes}:${seconds} UTC`;
}

const STATUS_LABELS: Record<NonNullable<StatusBarProps["status"]>, string> = {
  connected: "Connected",
  connecting: "Connecting",
  disconnected: "Disconnected",
};

export function StatusBar({ status = "connected", latencyMs = 18, serverTime }: StatusBarProps) {
  const [currentTime, setCurrentTime] = useState<string>(() =>
    serverTime ? serverTime : formatUtcTime(new Date()),
  );

  useEffect(() => {
    if (serverTime) {
      return;
    }

    const interval = setInterval(() => {
      setCurrentTime(formatUtcTime(new Date()));
    }, 1000);

    return () => clearInterval(interval);
  }, [serverTime]);

  const displayTime = serverTime ?? currentTime;
  const statusLabel = STATUS_LABELS[status];

  return (
    <footer className={styles.statusBar} role="contentinfo">
      <div className={styles.statusGroup}>
        <span className={styles.item}>
          <span className={styles.statusDot} data-status={status} aria-hidden="true" />
          <span>{statusLabel}</span>
        </span>
        <span className={styles.item}>
          <span>{latencyMs}ms</span>
        </span>
      </div>

      <span className={styles.clock} suppressHydrationWarning>
        {displayTime}
      </span>
    </footer>
  );
}

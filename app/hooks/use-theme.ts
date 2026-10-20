"use client";

import { useCallback } from "react";

export function useTheme() {
  const toggleTheme = useCallback(() => {
    const root = document.documentElement;
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem("z-trader-theme-v1", nextTheme);
    } catch {
      // The current session can still change theme when persistence is unavailable.
    }
  }, []);

  return { toggleTheme };
}

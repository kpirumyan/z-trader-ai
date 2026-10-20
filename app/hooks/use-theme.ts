"use client";

import { useCallback } from "react";
import { THEME_STORAGE_KEY } from "../constants/storage";
import type { Theme } from "../types/theme";

export function useTheme() {
  const toggleTheme = useCallback(() => {
    const root = document.documentElement;
    const nextTheme: Theme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The current session can still change theme when persistence is unavailable.
    }
  }, []);

  return { toggleTheme };
}

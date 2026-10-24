"use client";

import { THEME_STORAGE_KEY } from "./constants";
import type { Theme, UseThemeResult } from "./types";

function switchTheme(): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const currentTheme = root.dataset.theme;
  const nextTheme: Theme = currentTheme === "dark" ? "light" : "dark";

  root.dataset.theme = nextTheme;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // Current session continues without persisting
  }
}

export function useTheme(): UseThemeResult {
  return { toggleTheme: switchTheme };
}

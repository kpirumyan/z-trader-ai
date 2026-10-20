import type { Theme } from "../types/theme";

export const THEMES: readonly Theme[] = ["light", "dark"] as const;
export const DEFAULT_THEME: Theme = "dark";

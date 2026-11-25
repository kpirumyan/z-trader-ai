import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { safeStorage } from "@/src/shared/storage";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  themeSchema,
  useTheme,
} from "@/src/shared/theme";

const originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");

beforeEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(window, "localStorage", originalLocalStorage);
  } else {
    Reflect.deleteProperty(window, "localStorage");
  }

  window.localStorage.clear();
  safeStorage.clear();
  document.documentElement.dataset.theme = DEFAULT_THEME;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();

  if (originalLocalStorage) {
    Object.defineProperty(window, "localStorage", originalLocalStorage);
  } else {
    Reflect.deleteProperty(window, "localStorage");
  }

  window.localStorage.clear();
  safeStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme constants and schema", () => {
  it("exports expected static constants", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(THEME_STORAGE_KEY).toBe("z-trader-theme");
    expect(THEMES).toEqual(["dark", "light"]);
  });

  // Scenario 4: Runtime validation via themeSchema
  it("validates theme values conforming to themeSchema and rejects invalid inputs", () => {
    const validDark = themeSchema.safeParse("dark");

    expect(validDark.success).toBe(true);

    if (validDark.success) {
      expect(validDark.data).toBe("dark");
    }

    const validLight = themeSchema.safeParse("light");

    expect(validLight.success).toBe(true);

    if (validLight.success) {
      expect(validLight.data).toBe("light");
    }

    const invalidCases = ["", "blue", 123, null, undefined, {}, []];

    for (const input of invalidCases) {
      const parsed = themeSchema.safeParse(input);

      expect(parsed.success).toBe(false);
    }
  });
});

describe("useTheme", () => {
  // Scenario 1: useTheme toggling and persistence in localStorage and safeStorage
  it("toggles document.documentElement.dataset.theme and persists selection to localStorage and safeStorage", () => {
    document.documentElement.dataset.theme = "dark";

    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(safeStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(safeStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  // Scenario 2: fallback to dark theme when dataset theme is corrupted or missing
  it("falls back to default dark theme when dataset theme is corrupted", () => {
    document.documentElement.dataset.theme = "corrupted";

    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(safeStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("falls back to default dark theme when dataset theme is missing", () => {
    delete document.documentElement.dataset.theme;

    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(safeStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  // Scenario 3: useTheme resilience to localStorage quota and security errors
  it("switches theme in DOM without throwing when localStorage.setItem throws QuotaExceededError", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });

    const { result } = renderHook(() => useTheme());

    expect(() => {
      act(() => {
        result.current.toggleTheme();
      });
    }).not.toThrow();

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(safeStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("switches theme in DOM without throwing when window.localStorage getter throws SecurityError", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });

    const { result } = renderHook(() => useTheme());

    expect(() => {
      act(() => {
        result.current.toggleTheme();
      });
    }).not.toThrow();

    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

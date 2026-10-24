import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  ThemeToggle,
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
  // Scenario 1: useTheme toggling and persistence in localStorage
  it("toggles document.documentElement.dataset.theme and persists selection to localStorage", () => {
    document.documentElement.dataset.theme = "dark";

    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
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
  });

  it("falls back to default dark theme when dataset theme is missing", () => {
    delete document.documentElement.dataset.theme;

    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
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

describe("ThemeToggle", () => {
  // Scenario 5: Accessibility structure, no title, sr-only labels, aria-hidden SVGs, focus preservation
  it("renders an accessible button without title attribute and preserves focus across toggles", () => {
    render(<ThemeToggle />);

    const button = screen.getByRole("button");

    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("title")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();

    button.focus();
    expect(document.activeElement).toBe(button);

    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  // Scenario 6: Zero-hydration-flicker via CSS Modules classes present simultaneously
  it("renders light and dark icon containers simultaneously with scoped CSS Module classes", () => {
    render(<ThemeToggle />);

    const button = screen.getByRole("button");

    const lightContainer = button.querySelector('[class*="lightOnly"]');
    const darkContainer = button.querySelector('[class*="darkOnly"]');

    expect(lightContainer).not.toBeNull();
    expect(darkContainer).not.toBeNull();

    const lightLabel = lightContainer?.querySelector('[class*="srOnly"], .sr-only');

    expect(lightLabel?.textContent).toBe("Switch to dark theme");

    const lightSvg = lightContainer?.querySelector("svg");

    expect(lightSvg).not.toBeNull();
    expect(lightSvg?.getAttribute("aria-hidden")).toBe("true");

    const darkLabel = darkContainer?.querySelector('[class*="srOnly"], .sr-only');

    expect(darkLabel?.textContent).toBe("Switch to light theme");

    const darkSvg = darkContainer?.querySelector("svg");

    expect(darkSvg).not.toBeNull();
    expect(darkSvg?.getAttribute("aria-hidden")).toBe("true");
  });
});

import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { THEME_STORAGE_KEY } from "@/app/constants/storage";
import { useTheme } from "@/app/hooks/use-theme";

const originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");

beforeEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(window, "localStorage", originalLocalStorage);
  } else {
    Reflect.deleteProperty(window, "localStorage");
  }

  window.localStorage.clear();
  document.documentElement.dataset.theme = "dark";
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

describe("useTheme", () => {
  it("toggles document.documentElement.dataset.theme and saves the selection in localStorage", () => {
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

  it("continues switching theme in the current session when localStorage write or access fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });

    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.dataset.theme).toBe("light");

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage disabled", "SecurityError");
      },
    });

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("falls back to default dark theme when document dataset theme is corrupted or missing", () => {
    document.documentElement.dataset.theme = "corrupted";

    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});

describe("ThemeToggle", () => {
  it("renders expected structure with theme containers, sr-only labels, and aria-hidden SVGs", () => {
    render(<ThemeToggle />);

    const button = screen.getByRole("button");

    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("title")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();

    const lightContainer = button.querySelector(".theme-light-only");

    expect(lightContainer).not.toBeNull();

    const lightLabel = lightContainer?.querySelector(".sr-only");

    expect(lightLabel?.textContent).toBe("Switch to dark theme");

    const lightSvg = lightContainer?.querySelector("svg");

    expect(lightSvg).not.toBeNull();
    expect(lightSvg?.getAttribute("aria-hidden")).toBe("true");

    const darkContainer = button.querySelector(".theme-dark-only");

    expect(darkContainer).not.toBeNull();

    const darkLabel = darkContainer?.querySelector(".sr-only");

    expect(darkLabel?.textContent).toBe("Switch to light theme");

    const darkSvg = darkContainer?.querySelector("svg");

    expect(darkSvg).not.toBeNull();
    expect(darkSvg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("preserves focus across toggles without duplicating useTheme storage assertions", () => {
    render(<ThemeToggle />);

    const button = screen.getByRole("button");

    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(document.activeElement).toBe(button);
  });
});

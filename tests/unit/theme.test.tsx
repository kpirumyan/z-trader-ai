import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { useTheme } from "@/app/hooks/use-theme";

const THEME_KEY = "z-trader-theme-v1";

describe("useTheme and ThemeToggle", () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(window, "localStorage");

  beforeEach(() => {
    if (originalLocalStorage) {
      Object.defineProperty(window, "localStorage", originalLocalStorage);
    }
    window.localStorage.clear();
    document.documentElement.dataset.theme = "dark";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalLocalStorage) {
      Object.defineProperty(window, "localStorage", originalLocalStorage);
    }
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("toggles document.documentElement.dataset.theme and saves the selection in localStorage", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");

    act(() => {
      result.current.toggleTheme();
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
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

  it("renders a single ThemeToggle button without title or tooltip and preserves focus across toggles", () => {
    render(<ThemeToggle />);

    const button = screen.getByRole("button", {
      name: /Switch to (light|dark) theme/,
    });
    expect(button.getAttribute("title")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();

    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
    expect(
      screen.getByRole("button", { name: /Switch to (light|dark) theme/ }),
    ).toBe(button);
    expect(document.activeElement).toBe(button);

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });

    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.activeElement).toBe(button);
  });
});

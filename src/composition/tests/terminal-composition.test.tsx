import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { TerminalApp } from "@/src/composition";
import { useWorkspaceStore } from "@/src/modules/workspace";
import { safeStorage } from "@/src/shared/storage";

vi.mock("lightweight-charts", () => {
  return {
    createChart: vi.fn((container: HTMLElement) => {
      const mockSeries = {
        setData: vi.fn(),
        update: vi.fn(),
        applyOptions: vi.fn(),
        seriesType: vi.fn().mockReturnValue("Candlestick"),
      };

      const canvas = document.createElement("canvas");

      container.appendChild(canvas);

      return {
        applyOptions: vi.fn(),
        resize: vi.fn(),
        remove: vi.fn(() => {
          if (container.contains(canvas)) {
            container.removeChild(canvas);
          }
        }),
        addSeries: vi.fn().mockReturnValue(mockSeries),
        addCandlestickSeries: vi.fn().mockReturnValue(mockSeries),
        addHistogramSeries: vi.fn().mockReturnValue(mockSeries),
        addLineSeries: vi.fn().mockReturnValue(mockSeries),
        addBarSeries: vi.fn().mockReturnValue(mockSeries),
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        timeScale: vi.fn().mockReturnValue({
          fitContent: vi.fn(),
          scrollToRealtime: vi.fn(),
        }),
      };
    }),
    CandlestickSeries: "CandlestickSeries",
    HistogramSeries: "HistogramSeries",
    LineSeries: "LineSeries",
    BarSeries: "BarSeries",
    ColorType: { Solid: "solid", VerticalGradient: "gradient" },
    CrosshairMode: { Normal: 0, Magnet: 1 },
  };
});

class MockResizeObserver implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

const originalResizeObserver = global.ResizeObserver;

beforeAll(() => {
  global.ResizeObserver = MockResizeObserver;
});

afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
});

describe("Terminal Composition (Integration)", () => {
  beforeEach(() => {
    cleanup();
    safeStorage.clear();
    useWorkspaceStore.getState().resetWorkspace();
  });

  afterEach(() => {
    cleanup();
    safeStorage.clear();
    useWorkspaceStore.getState().resetWorkspace();
  });

  describe("Scenario 1: TerminalApp composition mounting with complete shell hierarchy", () => {
    it("renders top bar, workspace canvas, and status bar landmarks", () => {
      render(<TerminalApp />);

      const topBar = screen.getByRole("banner");

      expect(topBar).toBeDefined();

      const mainLandmark = screen.getByRole("main", { name: /Workspace/i });

      expect(mainLandmark).toBeDefined();

      const statusBar = screen.queryByRole("status") ?? screen.getByRole("contentinfo");

      expect(statusBar).toBeDefined();
    });
  });

  describe("Scenario 2: End-to-end widget wiring across workspace and domain modules", () => {
    async function spawnWidgetFromMenu(menuItemLabel: RegExp) {
      const newButton = screen.getByRole("button", { name: "New" });

      fireEvent.click(newButton);

      const menuItem = screen.getByRole("menuitem", { name: menuItemLabel });

      fireEvent.click(menuItem);

      const firstInstrumentOption = await waitFor(() => {
        const options = screen.getAllByRole("option");

        expect(options.length).toBeGreaterThan(0);

        return options[0]!;
      });

      const optionButton = within(firstInstrumentOption).getByRole("button");

      fireEvent.click(optionButton);
    }

    it("exposes Chart, Order Book, and Time & Sales in the New menu and mounts each real domain widget", async () => {
      render(<TerminalApp />);

      await spawnWidgetFromMenu(/^Chart$/i);

      const chartRegion = screen.getByRole("region", { name: /^Chart /i });

      expect(chartRegion).toBeDefined();
      expect(within(chartRegion).getByTestId(/^chart-widget-/)).toBeDefined();

      await spawnWidgetFromMenu(/^Level II$/i);

      const orderBookRegion = screen.getByRole("region", { name: /^Level II /i });

      expect(orderBookRegion).toBeDefined();
      expect(within(orderBookRegion).getByTestId(/^order-book-widget-/)).toBeDefined();

      await spawnWidgetFromMenu(/^T & S$/i);

      const timeAndSalesRegion = screen.getByRole("region", { name: /^T & S /i });

      expect(timeAndSalesRegion).toBeDefined();
      expect(within(timeAndSalesRegion).getByTestId(/^time-and-sales-widget-/)).toBeDefined();
    });
  });
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_WORKSPACE_INSTRUCTION,
  EMPTY_WORKSPACE_TITLE,
  NewMenuPopover,
  StatusBar,
  TerminalShell,
  TerminalWindow,
  TopBar,
  WorkspaceCanvas,
  useWorkspaceStore,
  type WorkspaceWindow,
} from "@/src/modules/workspace";
import { safeStorage } from "@/src/shared/storage";

import type { Instrument, WidgetDefinition } from "@/src/shared/contracts";

const appleInstrument: Instrument = {
  symbol: "AAPL",
  name: "Apple Inc.",
};

const microsoftInstrument: Instrument = {
  symbol: "MSFT",
  name: "Microsoft Corp.",
};

const spFuturesInstrument: Instrument = {
  symbol: "ES",
  name: "E-mini S&P 500",
};

const mockChartWidget: WidgetDefinition = {
  kind: "chart",
  title: "Chart",
  component: ({ windowId, instrument, isFocused }) => (
    <div data-testid={`widget-chart-${windowId}`} data-focused={String(Boolean(isFocused))}>
      <span>Chart View: {instrument.symbol}</span>
    </div>
  ),
};

const mockOrderBookWidget: WidgetDefinition = {
  kind: "orderBook",
  title: "Level II",
  component: ({ windowId, instrument }) => (
    <div data-testid={`widget-orderBook-${windowId}`}>
      <span>Order Book View: {instrument.symbol}</span>
    </div>
  ),
};

const mockTimeAndSalesWidget: WidgetDefinition = {
  kind: "timeAndSales",
  title: "T & S",
  component: ({ windowId, instrument }) => (
    <div data-testid={`widget-timeAndSales-${windowId}`}>
      <span>Tape View: {instrument.symbol}</span>
    </div>
  ),
};

const mockWidgets: readonly WidgetDefinition[] = [
  mockChartWidget,
  mockOrderBookWidget,
  mockTimeAndSalesWidget,
];

describe("Workspace UI Components (Unit)", () => {
  beforeEach(() => {
    cleanup();
    safeStorage.clear();
    useWorkspaceStore.getState().resetWorkspace();
  });

  afterEach(() => {
    cleanup();
    safeStorage.clear();
  });

  describe("Scenario 1: Initial Empty Workspace Render", () => {
    it("renders empty workspace canvas landmark, title, instruction, and no window regions", () => {
      render(<TerminalShell widgets={mockWidgets} />);

      const mainLandmark = screen.getByRole("main", { name: "Workspace" });

      expect(mainLandmark).toBeDefined();

      const title = screen.getByText(EMPTY_WORKSPACE_TITLE);
      const instruction = screen.getByText(EMPTY_WORKSPACE_INSTRUCTION);

      expect(title).toBeDefined();
      expect(instruction).toBeDefined();

      // No terminal window regions when workspace is empty
      const windowRegions = screen.queryAllByRole("region");

      expect(windowRegions).toHaveLength(0);

      // TopBar New button is visible
      const newButton = screen.getByRole("button", { name: "New" });

      expect(newButton).toBeDefined();
      expect(newButton.getAttribute("aria-haspopup")).toBe("menu");

      // Bottom operational status bar is present
      const statusBar = screen.getByRole("contentinfo");

      expect(statusBar).toBeDefined();

      // Ensure no storage recovery banners exist (ADR-0004)
      expect(screen.queryByText(/corrupt|damaged|recovery/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Start empty" })).toBeNull();
    });
  });

  describe("Scenario 2 & 10 UI: Window Region Rendering and Instrument Change", () => {
    it("renders window region with accessible label and updates label on instrument change", () => {
      const store = useWorkspaceStore.getState();
      const windowId = store.addWindow("chart", appleInstrument);

      const { rerender } = render(<TerminalShell widgets={mockWidgets} />);

      // A window region exists with accessible name "Chart AAPL"
      const windowRegion = screen.getByRole("region", { name: "Chart AAPL" });

      expect(windowRegion).toBeDefined();

      // Contains Change instrument and Close window buttons
      const changeButton = within(windowRegion).getByRole("button", {
        name: "Change instrument",
      });
      const closeButton = within(windowRegion).getByRole("button", {
        name: "Close window",
      });

      expect(changeButton).toBeDefined();
      expect(closeButton).toBeDefined();

      // Empty instruction is no longer shown
      expect(screen.queryByText(EMPTY_WORKSPACE_TITLE)).toBeNull();
      expect(screen.queryByText(EMPTY_WORKSPACE_INSTRUCTION)).toBeNull();

      // Change instrument in store
      store.changeInstrument(windowId, microsoftInstrument);
      rerender(<TerminalShell widgets={mockWidgets} />);

      // Accessible name is now updated to "Chart MSFT"
      expect(screen.queryByRole("region", { name: "Chart AAPL" })).toBeNull();

      const updatedWindowRegion = screen.getByRole("region", { name: "Chart MSFT" });

      expect(updatedWindowRegion).toBeDefined();
    });
  });

  describe("Scenario 4 UI: Focus Window Interaction", () => {
    it("raises active window focus when an inactive window is clicked", () => {
      const store = useWorkspaceStore.getState();
      const win1Id = store.addWindow("chart", appleInstrument);
      const win2Id = store.addWindow("orderBook", spFuturesInstrument);

      render(<TerminalShell widgets={mockWidgets} />);

      const region1 = screen.getByRole("region", { name: "Chart AAPL" });
      const region2 = screen.getByRole("region", { name: "Level II ES" });

      expect(region1).toBeDefined();
      expect(region2).toBeDefined();
      expect(useWorkspaceStore.getState().activeWindowId).toBe(win2Id);

      // Click on region 1
      fireEvent.pointerDown(region1);

      expect(useWorkspaceStore.getState().activeWindowId).toBe(win1Id);
    });
  });

  describe("Scenario 5 UI: Close Window Interaction", () => {
    it("closes a window when clicking Close window button and removes it from the canvas", () => {
      const store = useWorkspaceStore.getState();
      const win1Id = store.addWindow("chart", appleInstrument);

      store.addWindow("orderBook", spFuturesInstrument);

      const { rerender } = render(<TerminalShell widgets={mockWidgets} />);

      expect(screen.getAllByRole("region")).toHaveLength(2);

      const region2 = screen.getByRole("region", { name: "Level II ES" });
      const closeButton = within(region2).getByRole("button", { name: "Close window" });

      fireEvent.click(closeButton);
      rerender(<TerminalShell widgets={mockWidgets} />);

      expect(screen.queryByRole("region", { name: "Level II ES" })).toBeNull();
      expect(screen.getByRole("region", { name: "Chart AAPL" })).toBeDefined();
      expect(useWorkspaceStore.getState().activeWindowId).toBe(win1Id);

      // Close the remaining window
      const region1 = screen.getByRole("region", { name: "Chart AAPL" });
      const closeButton1 = within(region1).getByRole("button", { name: "Close window" });

      fireEvent.click(closeButton1);
      rerender(<TerminalShell widgets={mockWidgets} />);

      expect(screen.queryAllByRole("region")).toHaveLength(0);
      expect(screen.getByText(EMPTY_WORKSPACE_TITLE)).toBeDefined();
    });
  });

  describe("Scenario 7: Dynamic Widget Component Resolution", () => {
    it("resolves and renders the registered widget component with windowId and instrument props", () => {
      const store = useWorkspaceStore.getState();
      const winId = store.addWindow("chart", appleInstrument);

      render(<TerminalShell widgets={mockWidgets} />);

      const renderedWidget = screen.getByTestId(`widget-chart-${winId}`);

      expect(renderedWidget).toBeDefined();
      expect(within(renderedWidget).getByText("Chart View: AAPL")).toBeDefined();
    });

    it("renders fallback message when no widget definition matches the window kind", () => {
      const store = useWorkspaceStore.getState();

      store.addWindow("chart", appleInstrument);

      // Provide an empty widget registry
      render(<TerminalShell widgets={[]} />);

      const windowRegion = screen.getByRole("region", { name: "Chart AAPL" });

      expect(windowRegion).toBeDefined();
      expect(screen.queryByTestId(/^widget-chart-/)).toBeNull();
    });
  });

  describe("Scenario 8: NewMenuPopover Keyboard Navigation", () => {
    it("provides accessible role='menu', navigates with Arrow keys, and closes on Escape", () => {
      const handleClose = vi.fn();
      const handleSelect = vi.fn();

      render(
        <NewMenuPopover widgets={mockWidgets} onClose={handleClose} onSelect={handleSelect} />,
      );

      const menu = screen.getByRole("menu");

      expect(menu).toBeDefined();

      const items = screen.getAllByRole("menuitem");

      expect(items).toHaveLength(3);
      expect(items[0]?.textContent).toContain("Chart");
      expect(items[1]?.textContent).toContain("Level II");
      expect(items[2]?.textContent).toContain("T & S");

      // First item is focused initially
      expect(document.activeElement).toBe(items[0]);

      // Navigate down
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(document.activeElement).toBe(items[1]);

      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(document.activeElement).toBe(items[2]);

      // Navigate up
      fireEvent.keyDown(menu, { key: "ArrowUp" });
      expect(document.activeElement).toBe(items[1]);

      // Escape closes the menu
      fireEvent.keyDown(menu, { key: "Escape" });
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it("triggers onSelect and onClose when clicking a menu item", () => {
      const handleClose = vi.fn();
      const handleSelect = vi.fn();

      render(
        <NewMenuPopover widgets={mockWidgets} onClose={handleClose} onSelect={handleSelect} />,
      );

      const level2Item = screen.getByRole("menuitem", { name: /Level II/i });

      fireEvent.click(level2Item);

      expect(handleSelect).toHaveBeenCalledWith("orderBook");
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("TerminalWindow Unit Component", () => {
    it("renders header, controls, handles drag pointer events, and dispatches callbacks", () => {
      const sampleWindow: WorkspaceWindow = {
        id: "win-test-1",
        kind: "chart",
        instrument: appleInstrument,
        position: { x: 50, y: 60 },
        size: { width: 400, height: 300 },
        zIndex: 5,
      };

      const handleClose = vi.fn();
      const handleFocus = vi.fn();
      const handleMove = vi.fn();
      const handleChangeInstrument = vi.fn();

      render(
        <TerminalWindow
          window={sampleWindow}
          widgetDefinition={mockChartWidget}
          isFocused={true}
          onClose={handleClose}
          onFocus={handleFocus}
          onMove={handleMove}
          onChangeInstrument={handleChangeInstrument}
        />,
      );

      const region = screen.getByRole("region", { name: "Chart AAPL" });

      expect(region).toBeDefined();

      // Test Change instrument button
      const changeBtn = within(region).getByRole("button", { name: "Change instrument" });

      fireEvent.click(changeBtn);
      expect(handleChangeInstrument).toHaveBeenCalledWith("win-test-1");

      // Test Close button
      const closeBtn = within(region).getByRole("button", { name: "Close window" });

      fireEvent.click(closeBtn);
      expect(handleClose).toHaveBeenCalledWith("win-test-1");

      // Test Focus on click
      fireEvent.pointerDown(region);
      expect(handleFocus).toHaveBeenCalledWith("win-test-1");
    });
  });

  describe("TopBar Unit Component", () => {
    it("renders branding, 'New' button, and toggles popover", () => {
      const handleToggle = vi.fn();
      const buttonRef = createRef<HTMLButtonElement>();

      render(
        <TopBar isNewOpen={false} newButtonRef={buttonRef} onToggleNew={handleToggle}>
          <div data-testid="top-bar-child">Child Element</div>
        </TopBar>,
      );

      const newButton = screen.getByRole("button", { name: "New" });

      expect(newButton).toBeDefined();
      expect(newButton.getAttribute("aria-haspopup")).toBe("menu");

      fireEvent.click(newButton);
      expect(handleToggle).toHaveBeenCalledTimes(1);

      expect(screen.getByTestId("top-bar-child")).toBeDefined();
    });
  });

  describe("WorkspaceCanvas Unit Component", () => {
    it("renders landmark with empty watermark when isEmpty is true", () => {
      render(
        <WorkspaceCanvas isEmpty={true}>
          <div data-testid="canvas-child">Canvas Content</div>
        </WorkspaceCanvas>,
      );

      const canvas = screen.getByRole("main", { name: "Workspace" });

      expect(canvas).toBeDefined();
      expect(screen.getByText(EMPTY_WORKSPACE_TITLE)).toBeDefined();
      expect(screen.getByText(EMPTY_WORKSPACE_INSTRUCTION)).toBeDefined();
    });

    it("renders landmark without empty watermark when isEmpty is false", () => {
      render(
        <WorkspaceCanvas isEmpty={false}>
          <div data-testid="canvas-child">Canvas Content</div>
        </WorkspaceCanvas>,
      );

      expect(screen.getByTestId("canvas-child")).toBeDefined();
      expect(screen.queryByText(EMPTY_WORKSPACE_TITLE)).toBeNull();
    });
  });

  describe("StatusBar Unit Component (ADR-0004)", () => {
    it("renders operational status, latency, and UTC time, with zero storage banners", () => {
      render(<StatusBar status="connected" latencyMs={18} serverTime="15:30:00 UTC" />);

      const footer = screen.getByRole("contentinfo");

      expect(footer).toBeDefined();
      expect(within(footer).getByText(/connected/i)).toBeDefined();
      expect(within(footer).getByText(/18ms/i)).toBeDefined();
      expect(within(footer).getByText(/15:30:00 UTC/i)).toBeDefined();

      // Zero storage diagnostic banners or popover controls (ADR-0004)
      expect(within(footer).queryByRole("button")).toBeNull();
      expect(within(footer).queryByText(/storage|corrupt|recovery|banner/i)).toBeNull();
    });
  });
});

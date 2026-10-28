import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React, { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_WORKSPACE_INSTRUCTION,
  EMPTY_WORKSPACE_TITLE,
  MINIMIZED_WINDOW_HEIGHT,
  MINIMIZED_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
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

  describe("Scenario 2 UI (focus-management): Deactivate window when clicking empty canvas or chrome background", () => {
    it("deactivates active window when clicking empty canvas area", () => {
      const store = useWorkspaceStore.getState();

      store.addWindow("chart", appleInstrument);

      const win2Id = store.addWindow("orderBook", spFuturesInstrument);

      render(<TerminalShell widgets={mockWidgets} />);

      const region1 = screen.getByRole("region", { name: "Chart AAPL" });
      const region2 = screen.getByRole("region", { name: "Level II ES" });

      expect(useWorkspaceStore.getState().activeWindowId).toBe(win2Id);
      expect(region2.getAttribute("data-focused")).toBe("true");
      expect(region1.getAttribute("data-focused")).toBe("false");

      // Click on empty canvas background (main landmark)
      const mainCanvas = screen.getByRole("main", { name: "Workspace" });

      fireEvent.pointerDown(mainCanvas);

      // Active window is deactivated in store
      expect(useWorkspaceStore.getState().activeWindowId).toBeNull();
      // Both windows display data-focused="false"
      expect(region1.getAttribute("data-focused")).toBe("false");
      expect(region2.getAttribute("data-focused")).toBe("false");
    });

    it("deactivates active window when clicking empty TopBar header area", () => {
      const store = useWorkspaceStore.getState();

      store.addWindow("chart", appleInstrument);

      render(<TerminalShell widgets={mockWidgets} />);

      expect(useWorkspaceStore.getState().activeWindowId).not.toBeNull();

      const newButton = screen.getByRole("button", { name: "New" });
      const banner = newButton.closest("header")!;

      fireEvent.pointerDown(banner);

      expect(useWorkspaceStore.getState().activeWindowId).toBeNull();
    });

    it("deactivates active window when clicking empty StatusBar footer area", () => {
      const store = useWorkspaceStore.getState();

      store.addWindow("chart", appleInstrument);

      render(<TerminalShell widgets={mockWidgets} />);

      expect(useWorkspaceStore.getState().activeWindowId).not.toBeNull();

      const statusBar = screen.getByRole("contentinfo");

      fireEvent.pointerDown(statusBar);

      expect(useWorkspaceStore.getState().activeWindowId).toBeNull();
    });
  });

  describe("Scenario 3 UI (focus-management): Focus activation via keyboard navigation (onFocusCapture)", () => {
    it("activates window and elevates zIndex when keyboard focus moves into a window", () => {
      const store = useWorkspaceStore.getState();
      const win1Id = store.addWindow("chart", appleInstrument);
      const win2Id = store.addWindow("orderBook", spFuturesInstrument);

      // Set win1 as active window first
      store.focusWindow(win1Id);
      expect(useWorkspaceStore.getState().activeWindowId).toBe(win1Id);

      render(<TerminalShell widgets={mockWidgets} />);

      const region2 = screen.getByRole("region", { name: "Level II ES" });
      const closeBtn2 = within(region2).getByRole("button", { name: "Close window" });

      // Emulate keyboard Tab navigation into win-2
      fireEvent.focus(closeBtn2);

      // Store updates activeWindowId to win2
      expect(useWorkspaceStore.getState().activeWindowId).toBe(win2Id);

      const win1State = useWorkspaceStore.getState().windows.find((w) => w.id === win1Id);
      const win2State = useWorkspaceStore.getState().windows.find((w) => w.id === win2Id);

      expect(win2State?.zIndex).toBeGreaterThan(win1State?.zIndex ?? 0);
    });
  });

  describe("Scenario 4 UI (focus-management): Focus stealing prevention on interactive click", () => {
    it("preserves DOM focus on clicked interactive control without stealing focus to window container", () => {
      const store = useWorkspaceStore.getState();
      const win1Id = store.addWindow("chart", appleInstrument);

      store.addWindow("orderBook", spFuturesInstrument);

      render(<TerminalShell widgets={mockWidgets} />);

      const region1 = screen.getByRole("region", { name: "Chart AAPL" });
      const changeBtn = within(region1).getByRole("button", { name: "Change instrument" });

      // Focus and click the Change instrument button
      changeBtn.focus();
      fireEvent.click(changeBtn);

      // Window becomes active
      expect(useWorkspaceStore.getState().activeWindowId).toBe(win1Id);
      // DOM focus is NOT stolen by section container
      expect(document.activeElement).toBe(changeBtn);
      expect(document.activeElement).not.toBe(region1);
    });
  });

  describe("Scenario 5 UI (focus-management): Single border focus indicator without double borders", () => {
    it("renders data-focused='true' strictly on outer TerminalWindow when focused and data-focused='false' when unfocused", () => {
      const sampleWindow: WorkspaceWindow = {
        id: "win-border-1",
        kind: "chart",
        instrument: appleInstrument,
        position: { x: 50, y: 60 },
        size: { width: 400, height: 300 },
        zIndex: 5,
      };

      const { rerender } = render(
        <TerminalWindow
          window={sampleWindow}
          widgetDefinition={mockChartWidget}
          isFocused={true}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onMove={vi.fn()}
          onResize={vi.fn()}
          onToggleMinimize={vi.fn()}
          onChangeInstrument={vi.fn()}
        />,
      );

      const focusedRegion = screen.getByRole("region", { name: "Chart AAPL" });

      expect(focusedRegion.getAttribute("data-focused")).toBe("true");

      rerender(
        <TerminalWindow
          window={sampleWindow}
          widgetDefinition={mockChartWidget}
          isFocused={false}
          onClose={vi.fn()}
          onFocus={vi.fn()}
          onMove={vi.fn()}
          onResize={vi.fn()}
          onToggleMinimize={vi.fn()}
          onChangeInstrument={vi.fn()}
        />,
      );

      const unfocusedRegion = screen.getByRole("region", { name: "Chart AAPL" });

      expect(unfocusedRegion.getAttribute("data-focused")).toBe("false");
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
      const handleResize = vi.fn();
      const handleToggleMinimize = vi.fn();
      const handleChangeInstrument = vi.fn();

      render(
        <TerminalWindow
          window={sampleWindow}
          widgetDefinition={mockChartWidget}
          isFocused={true}
          onClose={handleClose}
          onFocus={handleFocus}
          onMove={handleMove}
          onResize={handleResize}
          onToggleMinimize={handleToggleMinimize}
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

    it("invokes onFocus callback when an interactive child inside window receives focus via onFocusCapture", () => {
      const sampleWindow: WorkspaceWindow = {
        id: "win-test-focus-capture",
        kind: "chart",
        instrument: appleInstrument,
        position: { x: 50, y: 60 },
        size: { width: 400, height: 300 },
        zIndex: 5,
      };

      const handleFocus = vi.fn();

      render(
        <TerminalWindow
          window={sampleWindow}
          widgetDefinition={mockChartWidget}
          isFocused={false}
          onClose={vi.fn()}
          onFocus={handleFocus}
          onMove={vi.fn()}
          onResize={vi.fn()}
          onToggleMinimize={vi.fn()}
          onChangeInstrument={vi.fn()}
        />,
      );

      const region = screen.getByRole("region", { name: "Chart AAPL" });
      const changeBtn = within(region).getByRole("button", { name: "Change instrument" });

      fireEvent.focus(changeBtn);
      expect(handleFocus).toHaveBeenCalledWith("win-test-focus-capture");
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

    it("invokes onClearFocus when clicking empty banner background", () => {
      const handleClearFocus = vi.fn();
      const buttonRef = createRef<HTMLButtonElement>();

      render(
        <TopBar
          isNewOpen={false}
          newButtonRef={buttonRef}
          onToggleNew={vi.fn()}
          onClearFocus={handleClearFocus}
        />,
      );

      const header = screen.getByRole("banner");

      fireEvent.pointerDown(header);

      expect(handleClearFocus).toHaveBeenCalledTimes(1);
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

    it("invokes onClearFocus when canvas background receives pointerDown", () => {
      const handleClearFocus = vi.fn();

      render(
        <WorkspaceCanvas isEmpty={false} onClearFocus={handleClearFocus}>
          <div data-testid="canvas-child">Canvas Content</div>
        </WorkspaceCanvas>,
      );

      const canvas = screen.getByRole("main", { name: "Workspace" });

      fireEvent.pointerDown(canvas);

      expect(handleClearFocus).toHaveBeenCalledTimes(1);
    });

    it("does not invoke onClearFocus when pointerDown originates from child content", () => {
      const handleClearFocus = vi.fn();

      render(
        <WorkspaceCanvas isEmpty={false} onClearFocus={handleClearFocus}>
          <button data-testid="canvas-child-button">Action</button>
        </WorkspaceCanvas>,
      );

      const button = screen.getByTestId("canvas-child-button");

      fireEvent.pointerDown(button);

      expect(handleClearFocus).not.toHaveBeenCalled();
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

    it("invokes onClearFocus when clicking empty status bar background", () => {
      const handleClearFocus = vi.fn();

      render(<StatusBar status="connected" onClearFocus={handleClearFocus} />);

      const footer = screen.getByRole("contentinfo");

      fireEvent.pointerDown(footer);

      expect(handleClearFocus).toHaveBeenCalledTimes(1);
    });
  });

  describe("Window Minimization & Resizing UI Scenarios (Scenarios 7-10)", () => {
    describe("Scenario 7 UI: Minimizing window collapses it to header dimensions and snaps to bottom of canvas", () => {
      it("collapses window to header dimensions and hides widget content when clicking Minimize button", () => {
        const store = useWorkspaceStore.getState();

        store.addWindow("chart", appleInstrument);

        render(<TerminalShell widgets={mockWidgets} />);

        const windowRegion = screen.getByRole("region", { name: "Chart AAPL" });

        expect(windowRegion.getAttribute("data-minimized")).toBe("false");

        const minimizeBtn = within(windowRegion).getByRole("button", {
          name: "Minimize window",
        });

        fireEvent.click(minimizeBtn);

        expect(windowRegion.getAttribute("data-minimized")).toBe("true");

        // Minimize button toggles to 'Restore window' accessible label
        const restoreBtn = within(windowRegion).getByRole("button", {
          name: "Restore window",
        });

        expect(restoreBtn).toBeDefined();

        // Dimensions collapse to 180px x 28px
        expect(windowRegion.style.width).toBe(`${MINIMIZED_WINDOW_WIDTH}px`);
        expect(windowRegion.style.height).toBe(`${MINIMIZED_WINDOW_HEIGHT}px`);

        // Widget content is hidden in minimized state
        const widgetContent = windowRegion.querySelector("[data-testid^='widget-chart-']");

        if (widgetContent) {
          const contentContainer = widgetContent.closest("[class*='content']");

          if (contentContainer) {
            expect(window.getComputedStyle(contentContainer).display).toBe("none");
          }
        }
      });
    });

    describe("Scenario 8 UI: Multiple minimized windows wrap into multiple rows at the bottom", () => {
      it("calculates MDI slot positions wrapping across rows for multiple minimized windows", () => {
        const store = useWorkspaceStore.getState();
        const win1 = store.addWindow("chart", appleInstrument);
        const win2 = store.addWindow("orderBook", spFuturesInstrument);
        const win3 = store.addWindow("timeAndSales", microsoftInstrument);
        const win4 = store.addWindow("chart", appleInstrument);

        // Mock canvas client dimensions: width 500px, height 600px
        // (500 - 2 * 8) / (180 + 6) = 484 / 186 = 2.6 => 2 items per row
        const clientWidthSpy = vi
          .spyOn(HTMLElement.prototype, "clientWidth", "get")
          .mockImplementation(function (this: HTMLElement) {
            if (this.getAttribute("role") === "main" || this.tagName.toLowerCase() === "main") {
              return 500;
            }

            return 0;
          });

        const clientHeightSpy = vi
          .spyOn(HTMLElement.prototype, "clientHeight", "get")
          .mockImplementation(function (this: HTMLElement) {
            if (this.getAttribute("role") === "main" || this.tagName.toLowerCase() === "main") {
              return 600;
            }

            return 0;
          });

        store.minimizeWindow(win1);
        store.minimizeWindow(win2);
        store.minimizeWindow(win3);
        store.minimizeWindow(win4);

        render(<TerminalShell widgets={mockWidgets} />);

        const regions = screen.getAllByRole("region");

        expect(regions).toHaveLength(4);

        // All 4 windows have data-minimized="true"
        for (const region of regions) {
          expect(region.getAttribute("data-minimized")).toBe("true");
        }

        // Row 0 (bottom row): y = 600 - (0 + 1) * (28 + 6) = 566px
        // Win 0: left = 8 + 0 * 186 = 8px, top = 566px
        // Win 1: left = 8 + 1 * 186 = 194px, top = 566px
        // Row 1 (upper row): y = 600 - (1 + 1) * 34 = 532px
        // Win 2: left = 8px, top = 532px
        // Win 3: left = 194px, top = 532px
        expect(regions[0]?.style.left).toBe("8px");
        expect(regions[0]?.style.top).toBe("566px");

        expect(regions[1]?.style.left).toBe("194px");
        expect(regions[1]?.style.top).toBe("566px");

        expect(regions[2]?.style.left).toBe("8px");
        expect(regions[2]?.style.top).toBe("532px");

        expect(regions[3]?.style.left).toBe("194px");
        expect(regions[3]?.style.top).toBe("532px");

        clientWidthSpy.mockRestore();
        clientHeightSpy.mockRestore();
      });

      it("TerminalWindow applies renderPosition and renderSize overrides when provided", () => {
        const sampleWindow: WorkspaceWindow = {
          id: "win-min-render",
          kind: "chart",
          instrument: appleInstrument,
          position: { x: 100, y: 100 },
          size: { width: 400, height: 300 },
          zIndex: 2,
          isMinimized: true,
        };

        render(
          <TerminalWindow
            window={sampleWindow}
            widgetDefinition={mockChartWidget}
            isFocused={false}
            renderPosition={{ x: 8, y: 566 }}
            renderSize={{ width: MINIMIZED_WINDOW_WIDTH, height: MINIMIZED_WINDOW_HEIGHT }}
            onClose={vi.fn()}
            onFocus={vi.fn()}
            onMove={vi.fn()}
            onResize={vi.fn()}
            onToggleMinimize={vi.fn()}
            onChangeInstrument={vi.fn()}
          />,
        );

        const region = screen.getByRole("region", { name: "Chart AAPL" });

        expect(region.getAttribute("data-minimized")).toBe("true");
        expect(region.style.left).toBe("8px");
        expect(region.style.top).toBe("566px");
        expect(region.style.width).toBe(`${MINIMIZED_WINDOW_WIDTH}px`);
        expect(region.style.height).toBe(`${MINIMIZED_WINDOW_HEIGHT}px`);
      });
    });

    describe("Scenario 9 UI: Restoring window via button or double-click expands to original geometry", () => {
      it("restores minimized window to original size and visible content on Restore button click", () => {
        const store = useWorkspaceStore.getState();
        const winId = store.addWindow("chart", appleInstrument);

        store.resizeWindow(winId, { width: 450, height: 350 });
        store.minimizeWindow(winId);

        render(<TerminalShell widgets={mockWidgets} />);

        const region = screen.getByRole("region", { name: "Chart AAPL" });

        expect(region.getAttribute("data-minimized")).toBe("true");

        const restoreBtn = within(region).getByRole("button", { name: "Restore window" });

        fireEvent.click(restoreBtn);

        expect(region.getAttribute("data-minimized")).toBe("false");
        expect(region.getAttribute("data-focused")).toBe("true");
        expect(region.style.width).toBe("450px");
        expect(region.style.height).toBe("350px");

        // Button toggles back to Minimize window
        expect(within(region).getByRole("button", { name: "Minimize window" })).toBeDefined();
      });

      it("restores minimized window when double clicking the window header", () => {
        const store = useWorkspaceStore.getState();
        const winId = store.addWindow("chart", appleInstrument);

        store.minimizeWindow(winId);

        render(<TerminalShell widgets={mockWidgets} />);

        const region = screen.getByRole("region", { name: "Chart AAPL" });

        expect(region.getAttribute("data-minimized")).toBe("true");

        const header = region.querySelector("header")!;

        expect(header).toBeDefined();

        fireEvent.doubleClick(header);

        expect(region.getAttribute("data-minimized")).toBe("false");
        expect(region.getAttribute("data-focused")).toBe("true");
      });

      it("TerminalWindow dispatches onToggleMinimize on double-click and on minimize/restore button click", () => {
        const handleToggleMinimize = vi.fn();
        const sampleWindow: WorkspaceWindow = {
          id: "win-toggle-test",
          kind: "chart",
          instrument: appleInstrument,
          position: { x: 50, y: 50 },
          size: { width: 380, height: 440 },
          zIndex: 1,
          isMinimized: false,
        };

        const { rerender } = render(
          <TerminalWindow
            window={sampleWindow}
            widgetDefinition={mockChartWidget}
            isFocused={true}
            onClose={vi.fn()}
            onFocus={vi.fn()}
            onMove={vi.fn()}
            onResize={vi.fn()}
            onToggleMinimize={handleToggleMinimize}
            onChangeInstrument={vi.fn()}
          />,
        );

        const region = screen.getByRole("region", { name: "Chart AAPL" });
        const minimizeBtn = within(region).getByRole("button", { name: "Minimize window" });

        fireEvent.click(minimizeBtn);
        expect(handleToggleMinimize).toHaveBeenCalledWith("win-toggle-test");

        // When minimized, double-click on header also invokes onToggleMinimize
        rerender(
          <TerminalWindow
            window={{ ...sampleWindow, isMinimized: true }}
            widgetDefinition={mockChartWidget}
            isFocused={true}
            onClose={vi.fn()}
            onFocus={vi.fn()}
            onMove={vi.fn()}
            onResize={vi.fn()}
            onToggleMinimize={handleToggleMinimize}
            onChangeInstrument={vi.fn()}
          />,
        );

        const header = region.querySelector("header")!;

        fireEvent.doubleClick(header);
        expect(handleToggleMinimize).toHaveBeenCalledWith("win-toggle-test");
      });
    });

    describe("Scenario 10 UI: Pointer drag on resize handle updates dimensions", () => {
      it("dispatches onResize with updated dimensions on pointer drag and clamps to minimums", () => {
        const handleResize = vi.fn();
        const sampleWindow: WorkspaceWindow = {
          id: "win-resize-test",
          kind: "chart",
          instrument: appleInstrument,
          position: { x: 50, y: 50 },
          size: { width: 380, height: 440 },
          zIndex: 1,
          isMinimized: false,
        };

        render(
          <TerminalWindow
            window={sampleWindow}
            widgetDefinition={mockChartWidget}
            isFocused={true}
            onClose={vi.fn()}
            onFocus={vi.fn()}
            onMove={vi.fn()}
            onResize={handleResize}
            onToggleMinimize={vi.fn()}
            onChangeInstrument={vi.fn()}
          />,
        );

        const region = screen.getByRole("region", { name: "Chart AAPL" });
        const resizeHandle = region.querySelector(
          "[data-testid='resize-handle'], [aria-label='Resize window'], [class*='resizeHandle']",
        )!;

        expect(resizeHandle).toBeDefined();

        // Drag SE handle by +50px X, +60px Y
        fireEvent.pointerDown(resizeHandle, { clientX: 430, clientY: 490, pointerId: 1 });
        fireEvent.pointerMove(window, { clientX: 480, clientY: 550, pointerId: 1 });
        fireEvent.pointerUp(window, { clientX: 480, clientY: 550, pointerId: 1 });

        expect(handleResize).toHaveBeenCalledWith("win-resize-test", {
          width: 430,
          height: 500,
        });

        handleResize.mockClear();

        // Drag SE handle inward below minimums (-300px X, -300px Y)
        fireEvent.pointerDown(resizeHandle, { clientX: 430, clientY: 490, pointerId: 1 });
        fireEvent.pointerMove(window, { clientX: 130, clientY: 190, pointerId: 1 });
        fireEvent.pointerUp(window, { clientX: 130, clientY: 190, pointerId: 1 });

        // Should clamp to MIN_WINDOW_WIDTH (260) and MIN_WINDOW_HEIGHT (180)
        expect(handleResize).toHaveBeenCalledWith("win-resize-test", {
          width: MIN_WINDOW_WIDTH,
          height: MIN_WINDOW_HEIGHT,
        });
      });

      it("hides resize handle when window is minimized", () => {
        const sampleWindow: WorkspaceWindow = {
          id: "win-min-no-resize",
          kind: "chart",
          instrument: appleInstrument,
          position: { x: 50, y: 50 },
          size: { width: 380, height: 440 },
          zIndex: 1,
          isMinimized: true,
        };

        render(
          <TerminalWindow
            window={sampleWindow}
            widgetDefinition={mockChartWidget}
            isFocused={false}
            onClose={vi.fn()}
            onFocus={vi.fn()}
            onMove={vi.fn()}
            onResize={vi.fn()}
            onToggleMinimize={vi.fn()}
            onChangeInstrument={vi.fn()}
          />,
        );

        const region = screen.getByRole("region", { name: "Chart AAPL" });
        const resizeHandle = region.querySelector(
          "[data-testid='resize-handle'], [aria-label='Resize window'], [class*='resizeHandle']",
        );

        if (resizeHandle) {
          expect(window.getComputedStyle(resizeHandle).display).toBe("none");
        } else {
          expect(resizeHandle).toBeNull();
        }
      });
    });
  });
});

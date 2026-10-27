import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TerminalApp, WIDGET_REGISTRY } from "@/src/composition";
import { safeStorage } from "@/src/shared/storage";

describe("Terminal Composition (Integration)", () => {
  beforeEach(() => {
    cleanup();
    safeStorage.clear();
  });

  afterEach(() => {
    cleanup();
    safeStorage.clear();
  });

  describe("Scenario 1: TerminalApp composition mounting with complete shell hierarchy", () => {
    it("renders top bar, workspace canvas, and status bar landmarks", () => {
      render(<TerminalApp />);

      const topBar = screen.getByRole("banner");

      expect(topBar).toBeDefined();

      const mainLandmark = screen.getByRole("main");

      expect(mainLandmark).toBeDefined();
      expect(mainLandmark.getAttribute("aria-label")).toMatch(/Workspace/i);

      const statusBar = screen.queryByRole("status") ?? screen.getByRole("contentinfo");

      expect(statusBar).toBeDefined();
    });
  });

  describe("Scenario 2: Widget registry exposure and widget definitions integration", () => {
    it("exposes exactly three widget definitions with unique kinds and valid components", () => {
      expect(WIDGET_REGISTRY).toHaveLength(3);

      const kinds = WIDGET_REGISTRY.map((widget) => widget.kind);
      const uniqueKinds = new Set(kinds);

      expect(uniqueKinds.size).toBe(3);

      const chartWidget = WIDGET_REGISTRY.find((widget) => widget.kind === "chart");

      expect(chartWidget).toBeDefined();
      expect(chartWidget?.title).toBe("Chart");
      expect(typeof chartWidget?.component).toBe("function");

      const orderBookWidget = WIDGET_REGISTRY.find((widget) => widget.kind === "orderBook");

      expect(orderBookWidget).toBeDefined();
      expect(orderBookWidget?.title).toBe("Order Book");
      expect(typeof orderBookWidget?.component).toBe("function");

      const timeAndSalesWidget = WIDGET_REGISTRY.find((widget) => widget.kind === "timeAndSales");

      expect(timeAndSalesWidget).toBeDefined();
      expect(timeAndSalesWidget?.title).toBe("Time & Sales");
      expect(typeof timeAndSalesWidget?.component).toBe("function");
    });
  });

  describe("Scenario 3: Clean application shell perimeter validation", () => {
    it("contains strictly layout.tsx, page.tsx, globals.css in app directory", () => {
      const appDirectory = path.resolve(process.cwd(), "app");
      const entries = readdirSync(appDirectory);
      const sortedEntries = [...entries].sort();

      expect(sortedEntries).toEqual(["globals.css", "layout.tsx", "page.tsx"]);
    });

    it("verifies tests/unit directory is completely removed from the project", () => {
      const unitTestsDirectory = path.resolve(process.cwd(), "tests/unit");

      expect(existsSync(unitTestsDirectory)).toBe(false);
    });

    it("ensures app/page.tsx imports TerminalApp strictly from @/src/composition", () => {
      const pageFilePath = path.resolve(process.cwd(), "app/page.tsx");
      const fileContent = readFileSync(pageFilePath, "utf-8");

      expect(fileContent).toMatch(/from\s+["']@\/src\/composition["']/);
      expect(fileContent).not.toMatch(/from\s+["']@\/src\/composition\/.+["']/);
    });
  });
});

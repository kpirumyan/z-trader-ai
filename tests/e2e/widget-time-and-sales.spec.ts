import { expect, test, type Locator, type Page } from "@playwright/test";

const defaultSymbol = "GC";

async function selectInstrument(dialog: Locator, symbol: string) {
  await dialog.getByRole("combobox", { name: "Search instruments" }).fill(symbol);
  await dialog.getByRole("button", { name: new RegExp(`\\b${symbol}\\b`) }).click();
}

async function openTimeAndSalesWindow(
  page: Page,
  symbol: string = defaultSymbol,
): Promise<Locator> {
  const newButton = page.getByRole("banner").getByRole("button", { name: "New", exact: true });

  await newButton.click();

  const menu = page.getByRole("menu");

  await expect(menu).toBeVisible();

  // Menu item corresponds to WINDOW_KIND_LABELS.timeAndSales ("T & S" or "Time & Sales")
  const menuItem = menu.getByRole("menuitem", { name: /^(?:T & S|Time & Sales)$/i });

  await menuItem.click();

  const dialog = page.getByRole("dialog", { name: /(?:T & S|Time & Sales)/i });

  await expect(dialog).toBeVisible();
  await selectInstrument(dialog, symbol);

  // Region name pattern matches "T & S <symbol>" or "Time & Sales <symbol>"
  const region = page
    .getByRole("main")
    .getByRole("region", { name: new RegExp(`(?:T & S|Time & Sales) ${symbol}`) });

  await expect(region).toBeVisible();

  return region;
}

test.describe("Widget: Time & Sales E2E Integration", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("Scenario 1: mounts Time & Sales widget and populates live trades at Top-of-Tape", async ({
    page,
  }) => {
    const region = await openTimeAndSalesWindow(page, defaultSymbol);
    const table = region.getByRole("table");

    await expect(table).toBeVisible();

    // Verify fixed table column headers
    await expect(table.getByRole("columnheader", { name: "Time", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Price", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Size", exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Side", exact: true })).toBeVisible();

    // Wait for streaming trade rows to arrive
    const rows = table.getByRole("row");

    await expect.poll(async () => (await rows.count()) > 1).toBe(true);

    const firstDataRow = rows.nth(1);

    await expect(firstDataRow).toBeVisible();

    // Numeric and side contents validation
    const cells = firstDataRow.getByRole("cell").or(firstDataRow.getByRole("gridcell"));

    await expect(cells).toHaveCount(4);

    const sideText = await cells.nth(3).innerText();

    expect(["Buy", "Sell", "BUY", "SELL"]).toContain(sideText.trim());
  });

  test("Scenario 2: applies size filtering to live trades feed and restores upon reset", async ({
    page,
  }) => {
    const region = await openTimeAndSalesWindow(page, defaultSymbol);
    const filterBtn = region.getByRole("button", { name: "Filter", exact: true });

    await expect(filterBtn).toBeVisible();
    await filterBtn.click();

    const popover = page.getByRole("dialog").or(page.locator('[data-state="open"]'));

    await expect(popover.first()).toBeVisible();

    // Select preset "Large (≥50)"
    const largePreset = popover.getByRole("button", { name: /Large \(≥50\)/i });

    await expect(largePreset).toBeVisible();
    await largePreset.click();

    // Wait for filtered view to take effect
    const table = region.getByRole("table");
    const rows = table.getByRole("row");

    // Check visible trade rows: if any are displayed, size must be >= 50
    await expect
      .poll(async () => {
        const rowCount = await rows.count();

        if (rowCount <= 1) return true; // header only is valid if no large trades yet

        for (let i = 1; i < rowCount; i += 1) {
          const cells = rows.nth(i).getByRole("cell");
          const cellCount = await cells.count();

          if (cellCount < 4) continue; // Empty message row

          const sizeCell = cells.nth(2);
          const sizeVal = parseFloat((await sizeCell.innerText()).replace(/,/g, ""));

          if (!Number.isNaN(sizeVal) && sizeVal < 50) return false;
        }

        return true;
      })
      .toBe(true);

    // Reset filter
    if (await popover.first().isHidden()) {
      await filterBtn.click();
    }

    const allPreset = popover.first().getByRole("button", { name: /^all$/i });

    await expect(allPreset).toBeVisible();
    await allPreset.click();

    // Verify smaller trades can appear again
    await expect.poll(async () => (await rows.count()) > 1).toBe(true);
  });

  test("Scenario 3: preserves tape content and adapts layout across theme toggles", async ({
    page,
  }) => {
    const region = await openTimeAndSalesWindow(page, defaultSymbol);
    const table = region.getByRole("table");

    await expect(table).toBeVisible();

    const themeToggle = page
      .getByRole("banner")
      .getByRole("button", { name: /Switch to (light|dark) theme/ });

    await expect(themeToggle).toBeVisible();

    // Toggle theme
    await themeToggle.click();

    // Time & Sales table remains visible and operational
    await expect(table).toBeVisible();

    const rows = table.getByRole("row");

    await expect.poll(async () => (await rows.count()) > 1).toBe(true);
  });
});

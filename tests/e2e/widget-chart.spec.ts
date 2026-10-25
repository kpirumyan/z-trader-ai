import { expect, test, type Locator, type Page } from "@playwright/test";

const defaultSymbol = "AAPL";

const windowFor = (page: Page, symbol: string) =>
  page.getByRole("main").getByRole("region", { name: `Chart ${symbol}`, exact: true });

async function selectInstrument(dialog: Locator, symbol: string) {
  await dialog.getByRole("searchbox", { name: "Search instruments" }).fill(symbol);
  await dialog.getByRole("button", { name: new RegExp(`\\b${symbol}\\b`) }).click();
}

async function openChartWindow(page: Page, symbol: string = defaultSymbol): Promise<Locator> {
  const newButton = page.getByRole("banner").getByRole("button", { name: "New", exact: true });

  await newButton.click();

  const menu = page.getByRole("menu");

  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Chart", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: /Chart/i });

  await expect(dialog).toBeVisible();
  await selectInstrument(dialog, symbol);

  const region = windowFor(page, symbol);

  await expect(region).toBeVisible();

  return region;
}

test.describe("Widget: Chart E2E Integration", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("mounts chart widget and renders interactive canvas surface in workspace", async ({
    page,
  }) => {
    const region = await openChartWindow(page, defaultSymbol);
    const canvas = region.locator("canvas").first();

    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();

    expect(box).not.toBeNull();

    if (box) {
      expect(box.width).toBeGreaterThan(50);
      expect(box.height).toBeGreaterThan(50);
    }
  });

  test("switches timeframes on toolbar interaction and updates active state", async ({ page }) => {
    const region = await openChartWindow(page, defaultSymbol);

    const btn1m = region.getByRole("button", { name: "1m", exact: true });
    const btn5m = region.getByRole("button", { name: "5m", exact: true });
    const btn1h = region.getByRole("button", { name: "1h", exact: true });

    await expect(btn1m).toBeVisible();
    await expect(btn5m).toBeVisible();
    await expect(btn1h).toBeVisible();

    // Default timeframe 1m is active
    await expect(btn1m).toHaveAttribute("aria-pressed", "true");
    await expect(btn5m).toHaveAttribute("aria-pressed", "false");

    // Click 5m button
    await btn5m.click();
    await expect(btn5m).toHaveAttribute("aria-pressed", "true");
    await expect(btn1m).toHaveAttribute("aria-pressed", "false");

    // Click 1h button
    await btn1h.click();
    await expect(btn1h).toHaveAttribute("aria-pressed", "true");
    await expect(btn5m).toHaveAttribute("aria-pressed", "false");
  });

  test("preserves chart canvas surface and adapts layout on theme change", async ({ page }) => {
    const region = await openChartWindow(page, defaultSymbol);
    const canvas = region.locator("canvas").first();

    await expect(canvas).toBeVisible();

    const themeToggle = page
      .getByRole("banner")
      .getByRole("button", { name: /Switch to (light|dark) theme/ });

    await expect(themeToggle).toBeVisible();

    const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);

    await themeToggle.click();

    const nextTheme = await page.evaluate(() => document.documentElement.dataset.theme);

    expect(nextTheme).not.toBe(initialTheme);

    // Canvas surface remains rendered and responsive
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();

    expect(box).not.toBeNull();

    if (box) {
      expect(box.width).toBeGreaterThan(50);
      expect(box.height).toBeGreaterThan(50);
    }
  });

  test("adapts canvas dimensions when workspace geometry or viewport changes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    const region = await openChartWindow(page, defaultSymbol);
    const canvas = region.locator("canvas").first();

    await expect(canvas).toBeVisible();

    const initialBox = await canvas.boundingBox();

    expect(initialBox).not.toBeNull();

    // Resize viewport to larger dimensions
    await page.setViewportSize({ width: 1600, height: 1000 });

    await expect
      .poll(
        async () => {
          const newBox = await canvas.boundingBox();

          return newBox && initialBox ? newBox.width !== initialBox.width : false;
        },
        { timeout: 5000 },
      )
      .toBe(true);
  });
});

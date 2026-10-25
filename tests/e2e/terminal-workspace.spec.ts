import { expect, test, type Locator, type Page } from "@playwright/test";

const WORKSPACE_STORAGE_KEY = "z-trader.workspace";
const emptyTitle = "Your workspace is empty";
const emptyInstruction = "Use New to open a Chart, Level II, or T & S window.";

const newButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "New", exact: true });

const themeButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /Switch to (dark|light) theme/ });

const windowRegions = (page: Page) =>
  page.getByRole("main").getByRole("region", { name: /^(?:Chart|Level II|T & S) \S+$/ });

async function expectShellSurvives(page: Page) {
  const banner = page.getByRole("banner");

  await expect(banner).toBeVisible();
  await expect(newButton(page)).toBeVisible();
  await expect(themeButton(page)).toBeVisible();

  // Branding logos in TopBar and watermark in Canvas
  await expect(banner.locator('img[src*="logo"]:visible')).toBeVisible();
  await expect(banner.locator('img[src*="brand"]:visible')).toBeVisible();
  await expect(page.getByRole("main").locator('img[src*="logo-full"]:visible')).toBeVisible();

  // ADR-0004: zero storage recovery banners or modal alerts
  await expect(page.getByText(/unable to restore|corrupt|damaged|storage recovery/i)).toHaveCount(
    0,
  );

  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start empty" })).toHaveCount(0);
}

async function expectEmptyWorkspace(page: Page) {
  const main = page.getByRole("main");

  await expect(main.getByText(emptyTitle, { exact: true })).toBeVisible();
  await expect(main.getByText(emptyInstruction, { exact: true })).toBeVisible();
  await expect(windowRegions(page)).toHaveCount(0);
  await expectShellSurvives(page);
  expect(await page.locator("body").innerText()).not.toMatch(/[А-Яа-яЁё]/);
}

async function openNewWindow(
  page: Page,
  kind: "Chart" | "Level II" | "T & S",
  symbol: string,
): Promise<Locator> {
  await newButton(page).click();

  const menu = page.getByRole("menu");

  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["Chart", "Level II", "T & S"]);

  await menu.getByRole("menuitem", { name: kind, exact: true }).click();

  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(new RegExp(kind));

  const searchInput = dialog.getByRole("combobox", { name: "Search instruments" });

  await expect(searchInput).toBeVisible();
  await searchInput.fill(symbol);

  const instrumentOption = dialog.getByRole("button", {
    name: new RegExp(`\\b${symbol}\\b`),
  });

  await expect(instrumentOption).toBeVisible();
  await instrumentOption.click();

  await expect(dialog).toBeHidden();

  const region = page.getByRole("region", { name: `${kind} ${symbol}`, exact: true });

  await expect(region).toBeVisible();

  return region;
}

test.describe("Terminal Multi-Window Workspace E2E Scenarios", () => {
  test("Scenario 1: Terminal loads with empty state, TopBar branding, and watermark logo", async ({
    page,
  }) => {
    await page.goto("/");
    await expectShellSurvives(page);
    await expectEmptyWorkspace(page);

    // Bottom operational status bar is docked and visible
    const statusBar = page.getByRole("contentinfo");

    await expect(statusBar).toBeVisible();
    await expect(statusBar).toContainText(/connected|connecting/i);
    await expect(statusBar).toContainText(/UTC/i);
  });

  test("Scenario 2: Open 'New' menu -> select 'Chart' -> search 'NQ' -> window created on canvas", async ({
    page,
  }) => {
    await page.goto("/");
    await expectEmptyWorkspace(page);

    const chartWindow = await openNewWindow(page, "Chart", "NQ");

    await expect(chartWindow).toBeVisible();
    await expect(chartWindow).toBeFocused();
    await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
    await expect(page.getByText(emptyInstruction, { exact: true })).toBeHidden();
    await expect(windowRegions(page)).toHaveCount(1);

    // Verify window header controls
    await expect(
      chartWindow.getByRole("button", { name: "Change instrument", exact: true }),
    ).toBeVisible();

    await expect(
      chartWindow.getByRole("button", { name: "Close window", exact: true }),
    ).toBeVisible();
  });

  test("Scenario 3: Open second window 'Level II' for 'ES', drag window, switch focus between windows", async ({
    page,
  }) => {
    await page.goto("/");
    await expectEmptyWorkspace(page);

    const chartWindow = await openNewWindow(page, "Chart", "NQ");
    const orderBookWindow = await openNewWindow(page, "Level II", "ES");

    await expect(windowRegions(page)).toHaveCount(2);
    await expect(orderBookWindow).toBeFocused();

    // Drag second window by header
    const header = orderBookWindow.locator("header");
    const headerBox = await header.boundingBox();
    const boxBefore = await orderBookWindow.boundingBox();

    expect(headerBox).not.toBeNull();
    expect(boxBefore).not.toBeNull();

    if (headerBox && boxBefore) {
      await page.mouse.move(headerBox.x + 20, headerBox.y + 10);
      await page.mouse.down();
      await page.mouse.move(headerBox.x + 420, headerBox.y + 50, { steps: 5 });
      await page.mouse.up();

      const boxAfter = await orderBookWindow.boundingBox();

      expect(boxAfter).not.toBeNull();

      if (boxAfter) {
        expect(boxAfter.x).toBeGreaterThan(boxBefore.x);
      }
    }

    // Switch focus back to first window by clicking on it
    await chartWindow.click({ position: { x: 50, y: 10 } });
    await expect(chartWindow).toBeFocused();

    // Switch focus back to second window
    await orderBookWindow.click({ position: { x: 50, y: 10 } });
    await expect(orderBookWindow).toBeFocused();
  });

  test("Scenario 4: Change instrument in window via search dialog", async ({ page }) => {
    await page.goto("/");
    await expectEmptyWorkspace(page);

    const windowRegion = await openNewWindow(page, "Chart", "NQ");

    await expect(windowRegion).toHaveAccessibleName("Chart NQ");

    const changeBtn = windowRegion.getByRole("button", {
      name: "Change instrument",
      exact: true,
    });

    await changeBtn.click();

    const dialog = page.getByRole("dialog");

    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(/(?:Chart|Change Instrument)/);

    const searchInput = dialog.getByRole("combobox", { name: "Search instruments" });

    await searchInput.fill("YM");

    const ymOption = dialog.getByRole("button", { name: /\bYM\b/ });

    await expect(ymOption).toBeVisible();
    await ymOption.click();

    await expect(dialog).toBeHidden();

    // Window accessible name and content updated
    const updatedWindow = page.getByRole("region", { name: "Chart YM", exact: true });

    await expect(updatedWindow).toBeVisible();
    await expect(updatedWindow).toBeFocused();
    await expect(page.getByRole("region", { name: "Chart NQ" })).toHaveCount(0);
    await expect(windowRegions(page)).toHaveCount(1);
  });

  test("Scenario 5: Close window via 'Close window' button and restore empty canvas", async ({
    page,
  }) => {
    await page.goto("/");
    await expectEmptyWorkspace(page);

    const chartWindow = await openNewWindow(page, "Chart", "NQ");
    const domWindow = await openNewWindow(page, "Level II", "ES");

    await expect(windowRegions(page)).toHaveCount(2);

    // Close DOM window -> focus falls back to Chart window
    await domWindow.getByRole("button", { name: "Close window", exact: true }).click();
    await expect(domWindow).toBeHidden();
    await expect(windowRegions(page)).toHaveCount(1);
    await expect(chartWindow).toBeFocused();

    // Close remaining Chart window -> empty canvas restored
    await chartWindow.getByRole("button", { name: "Close window", exact: true }).click();
    await expect(chartWindow).toBeHidden();
    await expectEmptyWorkspace(page);
  });

  test("Scenario 6: Persist window layout in safeStorage and restore on page reload", async ({
    page,
  }) => {
    await page.goto("/");
    await expectEmptyWorkspace(page);

    await openNewWindow(page, "Chart", "NQ");
    await openNewWindow(page, "Level II", "ES");

    await expect(windowRegions(page)).toHaveCount(2);

    // Check that layout was persisted in storage
    await expect
      .poll(async () => {
        return page.evaluate((key) => {
          const raw = localStorage.getItem(key);

          if (!raw) return null;

          try {
            const data = JSON.parse(raw);

            return data?.workspaces?.[0]?.windows?.map(
              (w: { kind?: string; instrument?: { symbol?: string } }) => ({
                kind: w.kind,
                symbol: w.instrument?.symbol,
              }),
            );
          } catch {
            return null;
          }
        }, WORKSPACE_STORAGE_KEY);
      })
      .toEqual([
        { kind: "chart", symbol: "NQ" },
        { kind: "orderBook", symbol: "ES" },
      ]);

    // Reload the page
    await page.reload();

    // Both windows restored from storage
    await expect(windowRegions(page)).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Chart NQ" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Level II ES" })).toBeVisible();
    await expectShellSurvives(page);
  });

  test("Silent Storage Recovery: corrupted payload resets cleanly without UI error banners (ADR-0004)", async ({
    page,
  }) => {
    // Seed corrupt storage payload
    await page.addInitScript(
      ({ key }) => {
        localStorage.setItem(key, "{corrupted-broken-json");
      },
      { key: WORKSPACE_STORAGE_KEY },
    );

    await page.goto("/");

    // Terminal loads smoothly into empty state
    await expectEmptyWorkspace(page);
    await expectShellSurvives(page);

    // Interactivity is preserved: New button can open window
    const windowRegion = await openNewWindow(page, "Chart", "NQ");

    await expect(windowRegion).toBeVisible();
    await expect(windowRegions(page)).toHaveCount(1);
  });
});

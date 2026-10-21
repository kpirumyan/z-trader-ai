import { expect, test, type Locator, type Page } from "@playwright/test";
import { WORKSPACE_STORAGE_KEY } from "@/app/constants/storage";

const emptyTitle = "Your workspace is empty";
const emptyInstruction = "Use New to open a Chart, Level II, or T & S window.";
const samples = [
  { kind: "Chart", symbol: "ES" },
  { kind: "Level II", symbol: "NQ" },
  { kind: "T & S", symbol: "GC" },
] as const;

type Kind = (typeof samples)[number]["kind"];

const windows = (page: Page) =>
  page.getByRole("main").getByRole("region", { name: /^(?:Chart|Level II|T & S) \S+$/ });
const windowFor = (page: Page, kind: Kind, symbol: string) =>
  page.getByRole("main").getByRole("region", { name: `${kind} ${symbol}`, exact: true });
const watermark = (page: Page) => page.getByRole("main").locator('img[src*="logo-full"]:visible');

async function selectInstrument(page: Page, dialog: Locator, symbol: string) {
  await dialog.getByRole("searchbox", { name: "Search instruments" }).fill(symbol);
  await dialog.getByRole("button", { name: new RegExp(`\\b${symbol}\\b`) }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function openWindow(page: Page, kind: Kind, symbol: string) {
  await page.getByRole("banner").getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: kind, exact: true }).click();
  await selectInstrument(page, page.getByRole("dialog", { name: new RegExp(kind) }), symbol);

  const region = windowFor(page, kind, symbol);

  await expect(region).toBeVisible();
  await expect(region).toBeFocused();

  return region;
}

async function expectShell(page: Page) {
  const banner = page.getByRole("banner");

  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await expect(banner.getByRole("button", { name: /Switch to (dark|light) theme/ })).toBeVisible();
  await expect(banner.locator('img[src*="logo"]:visible')).toBeVisible();
  await expect(banner.locator('img[src*="brand"]:visible')).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(watermark(page)).toBeVisible();

  const opacity = await watermark(page).evaluate((element) => {
    let opacity = 1;

    for (let node: Element | null = element; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity);
    }

    return opacity;
  });

  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);
}

async function expectEmpty(page: Page) {
  await expect(windows(page)).toHaveCount(0);
  await expect(page.getByText(emptyTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(emptyInstruction, { exact: true })).toBeVisible();
  await expectShell(page);
}

async function shellGeometry(page: Page) {
  return Promise.all(
    [page.getByRole("banner"), page.getByRole("main"), watermark(page)].map((element) =>
      element.boundingBox(),
    ),
  );
}

async function expectChart(region: Locator, symbol: string) {
  const graphic = region.getByRole("img", { name: `Candlestick chart for ${symbol}`, exact: true });

  await expect(graphic).toBeVisible();

  // Inspect only the browser's public drawing surface; do not depend on candle DOM,
  // React state, chart library APIs, classes or a particular SVG path structure.
  await expect
    .poll(
      () =>
        graphic.evaluate((element) => {
          const surfaces = [element, ...element.querySelectorAll("svg, canvas, img")];

          return surfaces.some((surface) => {
            const box = surface.getBoundingClientRect();

            if (box.width <= 0 || box.height <= 0) return false;

            if (surface instanceof SVGSVGElement) {
              const drawing = surface.getBBox();

              return drawing.width > 0 && drawing.height > 0;
            }

            if (surface instanceof HTMLCanvasElement) {
              const context = surface.getContext("2d");

              if (!context || !surface.width || !surface.height) return false;

              const data = context.getImageData(0, 0, surface.width, surface.height).data;
              const colors = new Set<string>();

              for (let index = 0; index < data.length; index += 4) {
                colors.add(
                  `${data[index]},${data[index + 1]},${data[index + 2]},${data[index + 3]}`,
                );

                if (colors.size > 1) return true;
              }

              return false;
            }

            return (
              surface instanceof HTMLImageElement && surface.complete && surface.naturalWidth > 0
            );
          });
        }),
      { message: "the chart must contain a rendered drawing, not just an accessible title" },
    )
    .toBe(true);
}

async function expectTable(region: Locator, kind: Exclude<Kind, "Chart">) {
  const table = region.getByRole("table").or(region.getByRole("grid"));

  await expect(table).toBeVisible();

  const headers =
    kind === "Level II" ? ["Bid size", "Price", "Ask size"] : ["Time", "Price", "Size", "Side"];

  await expect(table.getByRole("columnheader")).toHaveText(headers);

  const dataRows = table.getByRole("row").filter({
    has: region.page().getByRole("cell").or(region.page().getByRole("gridcell")),
  });

  await expect.poll(() => dataRows.count()).toBeGreaterThanOrEqual(5);

  for (const row of await dataRows.all()) {
    await expect(row).toBeVisible();

    const cells = row.getByRole("cell").or(row.getByRole("gridcell"));

    await expect(cells).toHaveCount(headers.length);

    const values = (await cells.allTextContents()).map((value) => value.trim());
    const numeric = kind === "Level II" ? values : values.slice(1, 3);

    for (const value of numeric) {
      expect(value).not.toBe("");

      const number = Number(value.replaceAll(",", ""));

      expect(Number.isFinite(number)).toBe(true);
      expect(number).toBeGreaterThanOrEqual(0);
    }

    if (kind === "T & S") {
      expect(values[0]).not.toBe("");
      expect(["Buy", "Sell"]).toContain(values[3]);
    }
  }

  if (kind === "T & S") {
    await expect(
      table
        .getByRole("cell", { name: "Buy", exact: true })
        .or(table.getByRole("gridcell", { name: "Buy", exact: true }))
        .first(),
    ).toBeVisible();

    await expect(
      table
        .getByRole("cell", { name: "Sell", exact: true })
        .or(table.getByRole("gridcell", { name: "Sell", exact: true }))
        .first(),
    ).toBeVisible();
  }
}

async function expectContent(page: Page, kind: Kind, symbol: string) {
  const region = windowFor(page, kind, symbol);

  await expect(region).toBeVisible();
  await expect(region).toContainText(symbol);
  await expect(region.getByText("Demo data", { exact: true })).toBeVisible();

  await expect(
    region.getByRole("button", { name: "Change instrument", exact: true }),
  ).toBeVisible();

  if (kind === "Chart") await expectChart(region, symbol);
  else await expectTable(region, kind);
}

for (const colorScheme of ["light", "dark"] as const) {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`${colorScheme} ${viewport.width}px: three demo windows coexist without moving the shell and reload starts empty`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      await expectEmpty(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const before = await shellGeometry(page);

      expect(before.every((box) => box !== null)).toBe(true);

      for (const [index, { kind, symbol }] of samples.entries()) {
        await openWindow(page, kind, symbol);
        await expectContent(page, kind, symbol);
        await expect(windows(page)).toHaveCount(index + 1);
        await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
        await expect(page.getByText(emptyInstruction, { exact: true })).toBeHidden();
        await expectShell(page);

        expect(
          await shellGeometry(page),
          "opening a window must not move or resize the banner, workspace or watermark",
        ).toEqual(before);
      }

      // Recheck earlier windows after the third opens: a single shared content panel
      // that merely changes its title cannot satisfy simultaneous availability.
      for (const { kind, symbol } of samples) await expectContent(page, kind, symbol);
      await expect(windows(page)).toHaveCount(3);
      expect(await page.locator("body").innerText()).not.toMatch(/[А-Яа-яЁё]/);

      await page.reload();
      await expectEmpty(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      expect(await shellGeometry(page)).toEqual(before);
      // A second session can create real content again; persisted empty state must
      // not disable New or leave stale windows behind.
      await openWindow(page, "Chart", "NQ");
      await expectContent(page, "Chart", "NQ");
      await expect(windows(page)).toHaveCount(1);
    });
  }

  test(`${colorScheme}: demo windows preserve corrupt-storage recovery and survive Start empty`, async ({
    page,
  }) => {
    const malformed = "{broken-t22-workspace";

    await page.emulateMedia({ colorScheme });

    await page.addInitScript(({ key, malformed }) => localStorage.setItem(key, malformed), {
      key: WORKSPACE_STORAGE_KEY,
      malformed,
    });

    await page.goto("/");

    const heading = page.getByRole("heading", {
      name: "Unable to restore your workspace",
      exact: true,
    });
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    const startEmpty = page.getByRole("button", { name: "Start empty", exact: true });

    await expect(heading).toBeVisible();

    for (const { kind, symbol } of samples) {
      await openWindow(page, kind, symbol);
      await expectContent(page, kind, symbol);
      await expect(heading).toBeVisible();
      await expect(retry).toBeVisible();
      await expect(startEmpty).toBeVisible();

      expect(await page.evaluate((key) => localStorage.getItem(key), WORKSPACE_STORAGE_KEY)).toBe(
        malformed,
      );

      await expectShell(page);
    }

    await startEmpty.click();
    await expect(heading).toBeHidden();
    for (const { kind, symbol } of samples) await expectContent(page, kind, symbol);
    await expect(windows(page)).toHaveCount(3);
    await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
    await expectShell(page);
  });
}

test("instrument changes update only the selected window's demo content", async ({ page }) => {
  await page.goto("/");
  await expectEmpty(page);
  for (const { kind, symbol } of samples) await openWindow(page, kind, symbol);

  const current = samples.map(({ kind, symbol }) => ({ kind, symbol: String(symbol) }));

  for (const [index, nextSymbol] of ["YM", "CL", "ES"].entries()) {
    const sample = current[index];
    const targetWindow = windowFor(page, sample.kind, sample.symbol);

    await targetWindow.focus();
    await targetWindow.getByRole("button", { name: "Change instrument", exact: true }).click();

    await selectInstrument(
      page,
      page.getByRole("dialog", { name: new RegExp(sample.kind) }),
      nextSymbol,
    );

    await expect(windowFor(page, sample.kind, sample.symbol)).toHaveCount(0);
    sample.symbol = nextSymbol;
    for (const { kind, symbol } of current) await expectContent(page, kind, symbol);
    await expect(windows(page)).toHaveCount(3);
  }
});

test("unavailable storage keeps its warning while all three demo windows remain usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage unavailable", "SecurityError");
      },
    });
  });

  await page.goto("/");
  await expectEmpty(page);

  const warning = page.getByText(
    /(?:not|won.t|cannot|can.t|unable to).*(?:sav|persist)|(?:sav|persist).*(?:unavailable|disabled)/i,
  );

  await expect(warning).toBeVisible();

  for (const { kind, symbol } of samples) {
    await openWindow(page, kind, symbol);
    await expectContent(page, kind, symbol);
    await expect(warning).toBeVisible();
    await expectShell(page);
  }

  await expect(windows(page)).toHaveCount(3);
  for (const { kind, symbol } of samples) await expectContent(page, kind, symbol);
});

import { expect, test, type Locator, type Page } from "@playwright/test";

import { WORKSPACE_STORAGE_KEY } from "@/app/constants/storage";

const emptyTitle = "Your workspace is empty";
const emptyInstruction = "Use New to open a Chart, Level II, or T & S window.";
const newButton = (page: Page) =>
  page
    .getByRole("banner", { includeHidden: true })
    .getByRole("button", { name: "New", exact: true, includeHidden: true });
const windowRegions = (page: Page) =>
  page
    .getByRole("main", { includeHidden: true })
    .getByRole("region", { name: /^(?:Chart|Level II|T & S) \S+$/, includeHidden: true });

async function expectShell(page: Page) {
  await expect(newButton(page)).toBeVisible();

  const banner = page.getByRole("banner", { includeHidden: true });

  await expect(
    banner.getByRole("button", { name: /Switch to (light|dark) theme/, includeHidden: true }),
  ).toBeVisible();

  await expect(banner.locator('img[src*="logo"]:visible')).toBeVisible();
  await expect(banner.locator('img[src*="brand"]:visible')).toBeVisible();

  await expect(
    page.getByRole("main", { includeHidden: true }).locator('img[src*="logo-full"]:visible'),
  ).toBeVisible();
}

async function expectEmpty(page: Page) {
  await expect(page.getByText(emptyTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(emptyInstruction, { exact: true })).toBeVisible();
  await expect(windowRegions(page)).toHaveCount(0);
  await expectShell(page);
}

async function openSearch(page: Page, kind: "Chart" | "Level II" | "T & S") {
  await newButton(page).click();
  await expect(newButton(page)).toHaveAttribute("aria-haspopup", "menu");

  const menu = page.getByRole("menu");

  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["Chart", "Level II", "T & S"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await menu.getByRole("menuitem", { name: kind, exact: true }).click();

  const dialog = page.getByRole("dialog", { name: new RegExp(kind) });

  await expect(dialog).toBeVisible();

  const input = dialog.getByRole("searchbox", { name: "Search instruments" });

  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);

  return dialog;
}

async function chooseInstrument(dialog: Locator, symbol: string, keyboard = false) {
  await dialog.getByRole("searchbox", { name: "Search instruments" }).fill(symbol);

  const result = dialog.getByRole("button", { name: new RegExp(`\\b${symbol}\\b`) });

  await expect(result).toBeVisible();
  if (keyboard) {
    const controls = await dialog.locator("button, input, [tabindex]:not([tabindex='-1'])").count();

    for (let step = 0; step < controls + 2; step += 1) {
      if (await result.evaluate((element) => element === document.activeElement)) break;
      await dialog.page().keyboard.press("Tab");

      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }

    await expect(result).toBeFocused();
    await dialog.page().keyboard.press("Enter");
  } else await result.click();
  await expect(dialog).toBeHidden();
}

async function windowGeometry(region: Locator) {
  return region.evaluate((element) => {
    const main = element.closest('main, [role="main"]');

    if (!main) throw new Error("A terminal window must belong to the workspace");

    const box = element.getBoundingClientRect();
    const origin = main.getBoundingClientRect();
    let scrollLeft = 0;
    let scrollTop = 0;

    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      scrollLeft += ancestor.scrollLeft;
      scrollTop += ancestor.scrollTop;
      if (ancestor === main) break;
    }

    return {
      x: box.left - origin.left + scrollLeft,
      y: box.top - origin.top + scrollTop,
      width: box.width,
      height: box.height,
    };
  });
}

function expectWindowOverlap(boxes: { x: number; y: number; width: number; height: number }[]) {
  for (const box of boxes) {
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  }

  const overlapAreas = boxes.flatMap((box, index) =>
    boxes.slice(index + 1).map((other) => {
      const width = Math.max(
        0,
        Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x),
      );
      const height = Math.max(
        0,
        Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y),
      );

      return width * height;
    }),
  );

  expect(
    Math.max(...overlapAreas),
    "free windows must have a nonzero overlapping area",
  ).toBeGreaterThan(0);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`${colorScheme}: New creates each kind immediately after selection and preserves the shell`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expectEmpty(page);

    let count = 0;

    for (const [kind, symbol, keyboard] of [
      ["Chart", "ES", false],
      ["Level II", "NQ", true],
      ["T & S", "GC", false],
    ] as const) {
      const dialog = await openSearch(page, kind);

      await expect(windowRegions(page)).toHaveCount(count);
      if (count === 0) await expect(page.getByText(emptyTitle, { exact: true })).toBeVisible();
      await chooseInstrument(dialog, symbol, keyboard);
      count += 1;

      const opened = page.getByRole("region", { name: `${kind} ${symbol}`, exact: true });

      await expect(opened).toBeVisible();
      await expect(opened).toContainText(symbol);

      await expect(
        opened.getByRole("button", { name: "Change instrument", exact: true }),
      ).toBeVisible();

      await expect(opened).toBeFocused();
      await expect(windowRegions(page)).toHaveCount(count);
      await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
      await expect(page.getByText(emptyInstruction, { exact: true })).toBeHidden();
      await expectShell(page);
    }

    expect(await page.locator("body").innerText()).not.toMatch(/[А-Яа-яЁё]/);
  });

  test(`${colorScheme}: a session window is usable before and after Start empty while storage is corrupted`, async ({
    page,
  }) => {
    const malformed = "{broken-t21-workspace";

    await page.emulateMedia({ colorScheme });

    await page.addInitScript(
      ({ key, malformed }) => {
        localStorage.setItem(key, malformed);

        const writes: string[] = [];

        Object.defineProperty(window, "__t21CorruptedWorkspaceWrites", { value: writes });

        const setItem = Storage.prototype.setItem;

        Storage.prototype.setItem = function (name, value) {
          if (this === localStorage && name === key) writes.push(value);

          return setItem.call(this, name, value);
        };
      },
      { key: WORKSPACE_STORAGE_KEY, malformed },
    );

    await page.goto("/");

    const recoveryHeading = page.getByRole("heading", {
      name: "Unable to restore your workspace",
      exact: true,
    });
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    const startEmpty = page.getByRole("button", { name: "Start empty", exact: true });

    await expect(recoveryHeading).toBeVisible();
    await expect(retry).toBeVisible();
    await expect(startEmpty).toBeVisible();
    await expect(windowRegions(page)).toHaveCount(0);

    await chooseInstrument(await openSearch(page, "Chart"), "ES");

    const opened = page.getByRole("region", { name: "Chart ES", exact: true });

    // Creation must already be observable before the recovery action is taken.
    await expect(opened).toBeVisible();
    await expect(opened).toBeFocused();

    await expect(
      opened.getByRole("button", { name: "Change instrument", exact: true }),
    ).toBeVisible();

    await expect(windowRegions(page)).toHaveCount(1);
    await expect(recoveryHeading).toBeVisible();
    await expect(retry).toBeVisible();
    await expect(startEmpty).toBeVisible();
    await expectShell(page);

    const beforeRecovery = await page.evaluate(
      (key) => ({
        raw: localStorage.getItem(key),
        writes: Reflect.get(window, "__t21CorruptedWorkspaceWrites") as string[],
      }),
      WORKSPACE_STORAGE_KEY,
    );

    expect(beforeRecovery.raw).toBe(malformed);
    expect(beforeRecovery.writes).toEqual([]);

    await startEmpty.click();
    await expect(recoveryHeading).toBeHidden();
    await expect(retry).toBeHidden();
    await expect(startEmpty).toBeHidden();
    await expect(opened).toBeVisible();
    await expect(windowRegions(page)).toHaveCount(1);
    await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
    await expect(page.getByText(emptyInstruction, { exact: true })).toBeHidden();
    await expectShell(page);

    await expect
      .poll(async () => {
        const raw = await page.evaluate((key) => localStorage.getItem(key), WORKSPACE_STORAGE_KEY);

        return raw === null || raw === malformed ? null : JSON.parse(raw);
      })
      .toMatchObject({
        version: 1,
        activeWorkspaceId: expect.any(String),
        workspaces: [{ id: expect.any(String), windows: [] }],
      });
  });

  test(`${colorScheme}: free windows overlap and keep their workspace coordinates from desktop to mobile`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expectEmpty(page);

    const windows = [
      { kind: "Chart", symbol: "ES" },
      { kind: "Level II", symbol: "NQ" },
      { kind: "T & S", symbol: "GC" },
    ] as const;

    for (const { kind, symbol } of windows) {
      await chooseInstrument(await openSearch(page, kind), symbol);

      await expect(
        page.getByRole("region", { name: `${kind} ${symbol}`, exact: true }),
      ).toBeFocused();
    }

    await expect(windowRegions(page)).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const regions = windows.map(({ kind, symbol }) =>
      page.getByRole("region", { name: `${kind} ${symbol}`, exact: true }),
    );

    for (const region of regions) await expect(region).toBeVisible();

    const desktop = await Promise.all(regions.map(windowGeometry));

    expectWindowOverlap(desktop);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(windowRegions(page)).toHaveCount(3);
    for (const region of regions) await expect(region).toBeVisible();

    await expect(async () => {
      const mobile = await Promise.all(regions.map(windowGeometry));

      expectWindowOverlap(mobile);

      for (const [index, box] of mobile.entries()) {
        const name = `${windows[index].kind} ${windows[index].symbol}`;

        expect(
          Math.abs(box.x - desktop[index].x),
          `${name}: workspace x coordinate`,
        ).toBeLessThanOrEqual(1);

        expect(
          Math.abs(box.y - desktop[index].y),
          `${name}: workspace y coordinate`,
        ).toBeLessThanOrEqual(1);
      }
    }).toPass({ timeout: 5000 });

    const selector = page
      .getByRole("region", { name: "T & S GC", exact: true })
      .getByRole("button", { name: "Change instrument", exact: true });

    await selector.scrollIntoViewIfNeeded();
    await expect(selector).toBeInViewport();
    await selector.click();

    const search = page.getByRole("dialog", { name: /T & S/ });

    await expect(search.getByRole("searchbox", { name: "Search instruments" })).toHaveValue("");
    await expect(search.getByRole("searchbox", { name: "Search instruments" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
    await expect(newButton(page)).toBeFocused();
    await expect(windowRegions(page)).toHaveCount(3);
    await expectShell(page);
  });
}

test("search traps focus, handles No results, and both cancellation actions leave the workspace empty", async ({
  page,
}) => {
  await page.goto("/");
  await expectEmpty(page);

  for (const closing of ["Escape", "Close"] as const) {
    const dialog = await openSearch(page, "Chart");
    const input = dialog.getByRole("searchbox", { name: "Search instruments" });

    await input.fill("no-such-instrument-xyz");
    await expect(dialog.getByRole("status")).toHaveText("No results");
    await expect(input).toHaveValue("no-such-instrument-xyz");
    await expectEmpty(page);

    const controls = await dialog.locator("button, input, [tabindex]:not([tabindex='-1'])").count();

    for (const direction of ["Tab", "Shift+Tab"]) {
      for (let step = 0; step < controls + 2; step += 1) {
        await page.keyboard.press(direction);

        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
    }

    if (closing === "Escape") await page.keyboard.press("Escape");
    else await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(newButton(page)).toBeFocused();
    await expectEmpty(page);
  }
});

test("the title selector changes only its own window and creates no extra window", async ({
  page,
}) => {
  await page.goto("/");
  await expectEmpty(page);
  await chooseInstrument(await openSearch(page, "Chart"), "ES");
  await chooseInstrument(await openSearch(page, "Level II"), "ES");

  const chart = page.getByRole("region", { name: "Chart ES", exact: true });
  const other = page.getByRole("region", { name: "Level II ES", exact: true });

  await chart.getByRole("button", { name: "Change instrument", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: /Chart/ });

  await expect(dialog.getByRole("searchbox", { name: "Search instruments" })).toHaveValue("");
  await expect(dialog.getByRole("searchbox", { name: "Search instruments" })).toBeFocused();
  await chooseInstrument(dialog, "NQ", true);

  const changed = page.getByRole("region", { name: "Chart NQ", exact: true });

  await expect(changed).toBeVisible();
  await expect(changed).toContainText("NQ");
  await expect(changed).toBeFocused();
  await expect(other).toBeVisible();
  await expect(other).toContainText("ES");
  await expect(windowRegions(page)).toHaveCount(2);
  await expectShell(page);
});

test("window creation and instrument changes keep the T1 storage envelope and reload starts empty", async ({
  page,
}) => {
  const seed = JSON.stringify({
    version: 1,
    activeWorkspaceId: "t21-workspace",
    workspaces: [{ id: "t21-workspace", windows: [] }],
  });

  await page.addInitScript(
    ({ key, seed }) => {
      if (!sessionStorage.getItem("t21-seeded")) {
        localStorage.setItem(key, seed);
        sessionStorage.setItem("t21-seeded", "true");
      }

      const writes: string[] = [];

      Object.defineProperty(window, "__t21WorkspaceWrites", { value: writes });

      const setItem = Storage.prototype.setItem;

      Storage.prototype.setItem = function (name, value) {
        if (this === localStorage && name === key) writes.push(value);

        return setItem.call(this, name, value);
      };
    },
    { key: WORKSPACE_STORAGE_KEY, seed },
  );

  await page.goto("/");
  await expectEmpty(page);

  const assertUnchanged = async () => {
    const snapshot = await page.evaluate(
      (key) => ({
        raw: localStorage.getItem(key),
        writes: Reflect.get(window, "__t21WorkspaceWrites") as string[],
      }),
      WORKSPACE_STORAGE_KEY,
    );

    expect(JSON.parse(snapshot.raw!)).toEqual(JSON.parse(seed));
    for (const write of snapshot.writes) expect(JSON.parse(write)).toEqual(JSON.parse(seed));
  };

  await chooseInstrument(await openSearch(page, "Chart"), "ES");
  await assertUnchanged();

  await page
    .getByRole("region", { name: "Chart ES", exact: true })
    .getByRole("button", { name: "Change instrument", exact: true })
    .click();

  await chooseInstrument(page.getByRole("dialog", { name: /Chart/ }), "NQ");
  await assertUnchanged();
  await page.reload();
  await expectEmpty(page);
  await assertUnchanged();
});

import { expect, test, type Page, type Route } from "@playwright/test";

const workspaceKey = "z-trader-workspace-v1";
const clientScripts = /\/_next\/static\/.*\.js(?:\?.*)?$/;
const probeKey = "__workspaceStorageProbe";
const emptyTitle = "Your workspace is empty";
const emptyInstruction = "Use New to open a Chart, Level II, or T & S window.";
const brandAssets = /(?:logo(?:-full)?|brand)(?:-dark)?\.png(?:[?&#].*)?$/;
const themeButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /Switch to (dark|light) theme/ });

async function expectEmptyWorkspace(page: Page) {
  const main = page.getByRole("main");

  await expect(main.getByText(emptyTitle, { exact: true })).toBeVisible();
  await expect(main.getByText(emptyInstruction, { exact: true })).toBeVisible();
  await expect(main.getByRole("button")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(/[А-Яа-яЁё]/);
}

type Failure = "none" | "getter" | "read" | "write";
type Probe = {
  reads: number;
  writes: string[];
  shellAtRead: boolean[];
  raw: () => string | null;
};

// Observe the public storage API; test reads bypass the probe and cannot satisfy it.
async function observeStorage(page: Page, seed: string | null = null, failure: Failure = "none") {
  await page.addInitScript(
    ({ key, probeKey, seed, failure }) => {
      const storage = window.localStorage;
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      const seedMarker = "workspace-test-seeded";

      if (seed !== null && !sessionStorage.getItem(seedMarker)) {
        setItem.call(storage, key, seed);
        sessionStorage.setItem(seedMarker, "true");
      }

      const visible = (element: Element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);

        return (
          box.width > 0 &&
          box.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      };

      const shellVisible = () => {
        const banner = document.querySelector('header, [role="banner"]');
        const main = document.querySelector('main, [role="main"]');

        return (
          !!banner &&
          visible(banner) &&
          !!main &&
          visible(main) &&
          [...banner.querySelectorAll('img[src*="logo"]')].some(visible) &&
          [...banner.querySelectorAll('img[src*="brand"]')].some(visible) &&
          [...main.querySelectorAll('img[src*="logo-full"]')].some(visible)
        );
      };

      const probe: Probe = {
        reads: 0,
        writes: [],
        shellAtRead: [],
        raw: () => getItem.call(storage, key),
      };

      Object.defineProperty(window, probeKey, { value: probe });

      Storage.prototype.getItem = function (name) {
        if (this === storage && name === key) {
          probe.reads += 1;
          probe.shellAtRead.push(shellVisible());
          if (failure === "read") throw new DOMException("Workspace read denied", "SecurityError");
        }

        return getItem.call(this, name);
      };

      Storage.prototype.setItem = function (name, value) {
        if (this === storage && name === key) {
          probe.writes.push(value);
          if (failure === "write")
            throw new DOMException("Workspace storage full", "QuotaExceededError");
        }

        return setItem.call(this, name, value);
      };

      if (failure === "getter") {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() {
            throw new DOMException("Storage unavailable", "SecurityError");
          },
        });
      }
    },
    { key: workspaceKey, probeKey, seed, failure },
  );
}

async function storageSnapshot(page: Page) {
  return page.evaluate((key) => {
    const probe = Reflect.get(window, key) as Probe;

    return {
      reads: probe.reads,
      writes: probe.writes,
      shellAtRead: probe.shellAtRead,
      raw: probe.raw(),
    };
  }, probeKey);
}

async function readWorkspace(page: Page) {
  const { raw } = await storageSnapshot(page);

  return raw === null ? null : JSON.parse(raw);
}

async function expectShellSurvives(page: Page) {
  const banner = page.getByRole("banner");

  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await expect(banner.getByRole("button", { name: /Switch to (dark|light) theme/ })).toBeVisible();
  for (const image of [
    banner.locator('img[src*="logo"]:visible'),
    banner.locator('img[src*="brand"]:visible'),
    page.getByRole("main").locator('img[src*="logo-full"]:visible'),
  ])
    await expect(image).toBeVisible();
  await expect(page.getByText(/restoring workspace|loading workspace/i)).toHaveCount(0);
}

async function expectWorkspaceRead(page: Page) {
  await expect.poll(async () => (await storageSnapshot(page)).reads).toBeGreaterThan(0);

  expect(
    (await storageSnapshot(page)).shellAtRead.every(Boolean),
    "shell remains visible when workspace is read",
  ).toBe(true);
}

async function expectHydratedShell(page: Page) {
  // An observable shell action also establishes that the client can handle input.
  const current = await page.locator("html").getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";

  await expect(async () => {
    await page
      .getByRole("banner")
      .getByRole("button", { name: `Switch to ${next} theme`, exact: true })
      .click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", next, { timeout: 500 });
  }).toPass({ timeout: 10000 });

  await expectShellSurvives(page);
}

test("first visit creates one versioned empty workspace and reload preserves its id", async ({
  page,
}) => {
  await observeStorage(page);

  let saved: unknown;

  for (const visit of ["first load", "reload"]) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;

    const holdScripts = async (route: Route) => {
      held += 1;
      await gate;
      await route.continue();
    };

    await page.route(clientScripts, holdScripts);

    try {
      if (visit === "first load") await page.goto("/", { waitUntil: "commit" });
      else await page.reload({ waitUntil: "commit" });
      await expect.poll(() => held).toBeGreaterThan(0);
      await expectShellSurvives(page);
      await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
      await expect(page.getByText(emptyInstruction, { exact: true })).toBeHidden();
      expect((await storageSnapshot(page)).reads).toBe(0);
      expect(await readWorkspace(page)).toEqual(visit === "first load" ? null : saved);

      release();
      await expectWorkspaceRead(page);
      await expectEmptyWorkspace(page);

      await expect
        .poll(() => readWorkspace(page))
        .toMatchObject({
          version: 1,
          activeWorkspaceId: expect.any(String),
          workspaces: [{ id: expect.any(String), windows: [] }],
        });

      const record = await readWorkspace(page);

      expect(record.workspaces).toHaveLength(1);
      expect(record.activeWorkspaceId.trim()).not.toBe("");
      expect(record.workspaces[0].id).toBe(record.activeWorkspaceId);
      if (visit === "reload") expect(record).toEqual(saved);
      saved = record;
      await expectHydratedShell(page);
      await expectEmptyWorkspace(page);
      expect(await readWorkspace(page)).toEqual(saved);
    } finally {
      release();
      await page.unroute(clientScripts, holdScripts);
    }
  }
});

test("malformed workspace preserves the record until Start empty", async ({ page }) => {
  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(error.message));

  const malformed = "{broken-json";

  await observeStorage(page, malformed);
  await page.goto("/");
  await expectWorkspaceRead(page);
  await expectHydratedShell(page);

  const explanation = page
    .getByRole("main")
    .getByText(
      /workspace.*(?:corrupt|damag|invalid|could not|cannot|unable|couldn't|can't)|(?:corrupt|damag|invalid).*workspace|(?:could not|cannot|unable to|couldn't|can't).*(?:read|load|restor).*workspace/i,
    )
    .first();
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  const startEmpty = page.getByRole("button", { name: "Start empty", exact: true });

  await expect(explanation).toBeVisible();
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await expect(startEmpty).toBeVisible();
  await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
  await expect(page.getByText(emptyInstruction, { exact: true })).toBeHidden();
  expect(await page.locator("body").innerText()).not.toMatch(/[А-Яа-яЁё]/);
  expect((await storageSnapshot(page)).raw).toBe(malformed);
  expect((await storageSnapshot(page)).writes).toEqual([]);

  const readsBeforeRetry = (await storageSnapshot(page)).reads;

  await retry.click();
  await expect(retry).toBeDisabled();
  await expectShellSurvives(page);

  await expect(
    page.getByRole("banner").getByRole("button", { name: "New", exact: true }),
  ).toBeEnabled();

  await expect(themeButton(page)).toBeEnabled();

  await expect
    .poll(async () => (await storageSnapshot(page)).reads)
    .toBeGreaterThan(readsBeforeRetry);

  await expect(retry).toBeEnabled();
  await expect(retry).not.toHaveAttribute("aria-busy", "true");
  await expect(explanation).toBeVisible();
  await expect(startEmpty).toBeVisible();
  await expectShellSurvives(page);
  expect((await storageSnapshot(page)).raw).toBe(malformed);
  expect((await storageSnapshot(page)).writes).toEqual([]);

  await startEmpty.click();
  await expectEmptyWorkspace(page);
  await expectShellSurvives(page);
  await expect(retry).toBeHidden();
  await expect(startEmpty).toBeHidden();
  await expect(explanation).toBeHidden();

  await expect
    .poll(() => readWorkspace(page))
    .toMatchObject({
      version: 1,
      activeWorkspaceId: expect.any(String),
      workspaces: [{ id: expect.any(String), windows: [] }],
    });

  const saved = await readWorkspace(page);

  expect(saved.activeWorkspaceId.trim()).not.toBe("");
  expect(saved.workspaces).toHaveLength(1);
  expect(saved.workspaces[0].id).toBe(saved.activeWorkspaceId);
  await page.reload();
  await expectEmptyWorkspace(page);
  await expectShellSurvives(page);
  expect(await readWorkspace(page)).toEqual(saved);
  expect(errors).toEqual([]);
});

test("Retry reads a repaired workspace without replacing it while the error is shown", async ({
  page,
}) => {
  const malformed = "{broken-json";
  const repaired = JSON.stringify({
    version: 1,
    activeWorkspaceId: "externally-repaired-workspace",
    workspaces: [{ id: "externally-repaired-workspace", windows: [] }],
  });

  await observeStorage(page, malformed);
  await page.goto("/");
  await expectWorkspaceRead(page);

  const retry = page.getByRole("button", { name: "Retry", exact: true });
  const startEmpty = page.getByRole("button", { name: "Start empty", exact: true });

  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await expect(startEmpty).toBeVisible();
  await expectShellSurvives(page);
  await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
  expect((await storageSnapshot(page)).raw).toBe(malformed);
  expect((await storageSnapshot(page)).writes).toEqual([]);

  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: workspaceKey,
    raw: repaired,
  });

  const readsBeforeRetry = (await storageSnapshot(page)).reads;

  await retry.click();
  await expect(retry).toBeDisabled();
  await expectShellSurvives(page);

  await expect(
    page.getByRole("banner").getByRole("button", { name: "New", exact: true }),
  ).toBeEnabled();

  await expect(themeButton(page)).toBeEnabled();

  await expect
    .poll(async () => (await storageSnapshot(page)).reads)
    .toBeGreaterThan(readsBeforeRetry);

  await expectEmptyWorkspace(page);
  await expectShellSurvives(page);
  await expect(retry).toBeHidden();
  await expect(startEmpty).toBeHidden();

  const snapshot = await storageSnapshot(page);

  expect(snapshot.raw).toBe(repaired);
  for (const raw of snapshot.writes) expect(raw).toBe(repaired);
  await page.reload();
  await expectEmptyWorkspace(page);
  await expectShellSurvives(page);
  expect((await storageSnapshot(page)).raw).toBe(repaired);
});

test("unavailable workspace storage leaves instruction usable and warns about saving", async ({
  page,
}) => {
  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(error.message));
  await observeStorage(page, null, "getter");

  for (const visit of ["first load", "reload"]) {
    if (visit === "first load") await page.goto("/");
    else await page.reload();
    await expectHydratedShell(page);
    await expectEmptyWorkspace(page);

    const warning = page.getByText(
      /(?:not|won.t|cannot|can.t|unable to).*(?:sav|persist)|(?:sav|persist).*(?:unavailable|disabled)/i,
    );

    await expect(warning).toBeVisible();

    const newButton = page.getByRole("banner").getByRole("button", { name: "New", exact: true });

    await newButton.click();

    const menu = page.getByRole("menu");

    await expect(menu.getByRole("menuitem")).toHaveText(["Chart", "Level II", "T & S"]);
    await menu.getByRole("menuitem", { name: "Chart", exact: true }).click();

    const dialog = page.getByRole("dialog");

    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(/Chart/);
    await expect(dialog.getByRole("searchbox", { name: "Search instruments" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(newButton).toBeFocused();
    await expect(warning).toBeVisible();
    await expectEmptyWorkspace(page);
    await expectShellSurvives(page);
    expect((await storageSnapshot(page)).raw).toBeNull();
    expect(errors).toEqual([]);
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`${colorScheme}: empty instruction uses Geist and inline emphasis without extra controls`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expectEmptyWorkspace(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    const title = page.getByRole("main").getByText(emptyTitle, { exact: true });
    const instruction = page.getByRole("main").getByText(emptyInstruction, { exact: true });
    const titleStyle = await title.evaluate((element) => {
      const style = getComputedStyle(element);

      return { font: style.fontFamily, weight: style.fontWeight, color: style.color };
    });

    expect(titleStyle.font).toMatch(/geist/i);
    expect(titleStyle.weight).toBe("400");

    // Inspect rendered text runs, allowing span/strong or other semantic markup.
    const runs = await instruction.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const result: {
        text: string;
        font: string;
        weight: string;
        color: string;
        plain: boolean;
      }[] = [];
      let node: Node | null;

      while ((node = walker.nextNode())) {
        if (!node.textContent) continue;

        const owner = node.parentElement!;
        const style = getComputedStyle(owner);
        let plain = true;

        for (
          let ancestor: Element | null = owner;
          ancestor && element.contains(ancestor);
          ancestor = ancestor.parentElement
        ) {
          const decoration = getComputedStyle(ancestor);

          plain &&=
            decoration.fontStyle === "normal" &&
            decoration.textDecorationLine === "none" &&
            [
              decoration.borderTopWidth,
              decoration.borderRightWidth,
              decoration.borderBottomWidth,
              decoration.borderLeftWidth,
            ].every((width) => Number.parseFloat(width) === 0);
        }

        result.push({
          text: node.textContent,
          font: style.fontFamily,
          weight: style.fontWeight,
          color: style.color,
          plain,
        });
      }

      return result;
    });
    const text = runs.map((run) => run.text).join("");
    const emphasis = ["New", "Chart", "Level II", "T & S"].map((word) => {
      const start = text.indexOf(word);

      expect(start).toBeGreaterThanOrEqual(0);

      return { start, end: start + word.length };
    });
    let offset = 0;
    const accentColors = new Set<string>();
    const regularColors = new Set<string>();

    for (const run of runs) {
      expect(run.font).toMatch(/geist/i);
      expect(run.plain, `plain inline text: ${run.text}`).toBe(true);

      for (const [index, character] of [...run.text].entries()) {
        if (!character.trim()) continue;

        const accent = emphasis.some(
          ({ start, end }) => offset + index >= start && offset + index < end,
        );

        expect(run.weight, `weight for ${run.text}`).toBe(accent ? "600" : "400");
        (accent ? accentColors : regularColors).add(run.color);
      }

      offset += run.text.length;
    }

    expect(accentColors.size).toBe(1);
    expect([...regularColors]).toEqual([titleStyle.color]);
    expect([...accentColors][0]).not.toBe(titleStyle.color);

    await expect(
      instruction.locator("button, a, input, select, textarea, [role=button]"),
    ).toHaveCount(0);

    await expect(page.getByRole("banner").getByRole("button")).toHaveCount(2);
  });

  test(`${colorScheme}: failed brand images leave instruction and New usable`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.route(brandAssets, (route) => route.abort());
    await page.goto("/");
    await expectEmptyWorkspace(page);

    const newButton = page.getByRole("button", { name: "New", exact: true });

    await newButton.click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Chart", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await expect(
      page.getByRole("dialog").getByRole("searchbox", { name: "Search instruments" }),
    ).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(newButton).toBeFocused();
    await themeButton(page).click();
    await expectShellSurvives(page);
    await expectEmptyWorkspace(page);
  });
}

test("New opens instrument search, traps focus and cancels without changing workspace storage", async ({
  page,
}) => {
  await observeStorage(page);
  await page.goto("/");
  await expectWorkspaceRead(page);
  await expectEmptyWorkspace(page);

  const baseline = await storageSnapshot(page);

  expect(baseline.raw).not.toBeNull();

  const expectWorkspaceUnchanged = async () => {
    const snapshot = await storageSnapshot(page);

    expect(snapshot.raw).toBe(baseline.raw);
    // Idempotent persistence is allowed; even a temporary different record is not.
    for (const raw of snapshot.writes.slice(baseline.writes.length)) expect(raw).toBe(baseline.raw);
  };

  const newButton = page.getByRole("banner").getByRole("button", { name: "New", exact: true });

  await expect(newButton).toBeEnabled();

  const explanation = page.getByRole("dialog");

  for (const closing of ["Escape", "Close"] as const) {
    await newButton.focus();
    await newButton.press("Enter");

    const menu = page.getByRole("menu");

    await expect(menu.getByRole("menuitem")).toHaveText(["Chart", "Level II", "T & S"]);
    await menu.getByRole("menuitem", { name: "Chart", exact: true }).focus();
    await menu.getByRole("menuitem", { name: "Chart", exact: true }).press("Enter");
    await expect(explanation).toBeVisible();
    await expect(explanation).toHaveAccessibleName(/Chart/);

    const search = explanation.getByRole("searchbox", { name: "Search instruments" });

    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(explanation.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
    await search.fill("no-such-instrument-xyz");
    await expect(explanation.getByRole("status")).toHaveText("No results");
    expect(await explanation.innerText()).not.toMatch(/[А-Яа-яЁё]/);

    await expect
      .poll(() => explanation.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);

    const controls = await explanation
      .locator("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])")
      .count();

    for (const direction of ["Tab", "Shift+Tab"]) {
      // Traverse past a complete cycle in both directions, including a single-control dialog.
      for (let step = 0; step < controls + 2; step += 1) {
        await page.keyboard.press(direction);

        expect(
          await explanation.evaluate((element) => element.contains(document.activeElement)),
        ).toBe(true);
      }
    }

    await expectWorkspaceUnchanged();
    if (closing === "Escape") await page.keyboard.press("Escape");
    else await explanation.getByRole("button", { name: "Close", exact: true }).click();
    await expect(explanation).toBeHidden();
    await expect(newButton).toBeFocused();
    await expectShellSurvives(page);
    await expectEmptyWorkspace(page);
    await expectWorkspaceUnchanged();
  }

  await themeButton(page).click();
  await expectShellSurvives(page);
  await expectEmptyWorkspace(page);
  await expectWorkspaceUnchanged();
  await page.reload();
  await expectEmptyWorkspace(page);
  await expect(explanation).toBeHidden();
  expect((await storageSnapshot(page)).raw).toBe(baseline.raw);
});

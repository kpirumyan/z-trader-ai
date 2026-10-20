import { expect, test, type Page, type Route } from "@playwright/test";

const workspaceKey = "z-trader-workspace-v1";
const clientScripts = /\/_next\/static\/.*\.js(?:\?.*)?$/;
const probeKey = "__workspaceStorageProbe";
type Failure = "none" | "getter" | "read" | "write";
type Probe = {
  reads: number;
  writes: string[];
  shellAtRead: boolean[];
  raw: () => string | null;
};

// Observe the public storage API; test reads bypass the probe and cannot satisfy it.
async function observeStorage(page: Page, seed: string | null = null, failure: Failure = "none") {
  await page.addInitScript(({ key, probeKey, seed, failure }) => {
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
      return box.width > 0 && box.height > 0
        && style.display !== "none" && style.visibility !== "hidden";
    };
    const shellVisible = () => {
      const banner = document.querySelector('header, [role="banner"]');
      const main = document.querySelector('main, [role="main"]');
      return !!banner && visible(banner) && !!main && visible(main)
        && [...banner.querySelectorAll('img[src*="logo"]')].some(visible)
        && [...banner.querySelectorAll('img[src*="brand"]')].some(visible)
        && [...main.querySelectorAll('img[src*="logo-full"]')].some(visible);
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
        if (failure === "write") throw new DOMException("Workspace storage full", "QuotaExceededError");
      }
      return setItem.call(this, name, value);
    };
    if (failure === "getter") {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() { throw new DOMException("Storage unavailable", "SecurityError"); },
      });
    }
  }, { key: workspaceKey, probeKey, seed, failure });
}

async function storageSnapshot(page: Page) {
  return page.evaluate((key) => {
    const probe = Reflect.get(window, key) as Probe;
    return { reads: probe.reads, writes: probe.writes, shellAtRead: probe.shellAtRead, raw: probe.raw() };
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
  ]) await expect(image).toBeVisible();
  await expect(page.getByText(/restoring workspace|loading workspace/i)).toHaveCount(0);
}

async function expectWorkspaceRead(page: Page) {
  await expect.poll(async () => (await storageSnapshot(page)).reads).toBeGreaterThan(0);
  expect((await storageSnapshot(page)).shellAtRead.every(Boolean), "shell remains visible when workspace is read").toBe(true);
}

async function expectHydratedShell(page: Page) {
  // An observable shell action also establishes that the client can handle input.
  const current = await page.locator("html").getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  await expect(async () => {
    await page.getByRole("banner").getByRole("button", { name: `Switch to ${next} theme`, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", next, { timeout: 500 });
  }).toPass({ timeout: 10000 });
  await expectShellSurvives(page);
}

test("first visit creates one versioned empty workspace and reload preserves its id", async ({ page }) => {
  await observeStorage(page);
  let saved: unknown;
  for (const visit of ["first load", "reload"]) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
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
      expect((await storageSnapshot(page)).reads).toBe(0);
      expect(await readWorkspace(page)).toEqual(visit === "first load" ? null : saved);

      release();
      await expectWorkspaceRead(page);
      await expect.poll(() => readWorkspace(page)).toMatchObject({
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
      expect(await readWorkspace(page)).toEqual(saved);
    } finally {
      release();
      await page.unroute(clientScripts, holdScripts);
    }
  }
});

test("a saved empty workspace is read without replacing its stable id", async ({ page }) => {
  const saved = { version: 1, activeWorkspaceId: "saved-empty-workspace", workspaces: [{ id: "saved-empty-workspace", windows: [] }] };
  await observeStorage(page, JSON.stringify(saved));
  for (const visit of ["first load", "reload"]) {
    if (visit === "first load") await page.goto("/");
    else await page.reload();
    await expectWorkspaceRead(page);
    await expectHydratedShell(page);
    expect(await readWorkspace(page)).toEqual(saved);
  }
});

for (const sample of [
  { name: "malformed JSON", raw: "{broken-json" },
  { name: "invalid envelope", raw: JSON.stringify({ version: 1, activeWorkspaceId: "missing", workspaces: [] }) },
  { name: "unsupported version", raw: JSON.stringify({ version: 2, activeWorkspaceId: "future", workspaces: [{ id: "future", windows: [] }] }) },
]) {
  test(`${sample.name} is preserved without crashing the shell on load and reload`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await observeStorage(page, sample.raw);
    for (const visit of ["first load", "reload"]) {
      if (visit === "first load") await page.goto("/");
      else await page.reload();
      await expectWorkspaceRead(page);
      await expectHydratedShell(page);
      const snapshot = await storageSnapshot(page);
      expect(snapshot.raw).toBe(sample.raw);
      expect(snapshot.writes, "corrupt records must not be overwritten, even temporarily").toEqual([]);
      expect(errors).toEqual([]);
    }
  });
}

for (const failure of ["getter", "read", "write"] as const) {
  test(`unavailable storage (${failure}) keeps the hydrated shell on load and reload`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await observeStorage(page, null, failure);
    for (const visit of ["first load", "reload"]) {
      if (visit === "first load") await page.goto("/");
      else await page.reload();
      if (failure !== "getter") await expectWorkspaceRead(page);
      if (failure === "write") {
        await expect.poll(async () => (await storageSnapshot(page)).writes.length).toBeGreaterThan(0);
      }
      await expectHydratedShell(page);
      expect((await storageSnapshot(page)).raw).toBeNull();
      expect(errors).toEqual([]);
    }
  });
}

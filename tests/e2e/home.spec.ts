import { expect, test, type Locator, type Page } from "@playwright/test";

const workspaceKey = "z-trader-workspace-v1";
const themeKey = "z-trader-theme-v1";
const emptyTitle = "Your workspace is empty";
const emptyInstruction = "Use New to open a Chart, Level II, or T & S window.";
const externalScripts = /\/_next\/static\/.*\.js(?:\?.*)?$/;
const brandAssets = /(?:logo(?:-full)?(?:-dark)?|brand(?:-dark)?)\.png/;
const themeButton = (page: Page) => page.getByRole("button", { name: /theme/i });

async function expectEmptyWorkspace(page: Page) {
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await expect(themeButton(page)).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText(emptyTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(emptyInstruction, { exact: true })).toBeVisible();
}

async function expectVisibleBrandShell(page: Page) {
  const banner = page.getByRole("banner");
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await expect(themeButton(page)).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();

  const images = [
    banner.locator('img[src*="logo"]:visible'),
    banner.locator('img[src*="brand"]:visible'),
    page.getByRole("main").locator('img[src*="logo-full"]:visible'),
  ];
  for (const image of images) {
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  }
}

async function settledBox(locator: Locator) {
  await expect(locator).toBeVisible();
  return locator.boundingBox().then((box) => {
    expect(box).not.toBeNull();
    return box!;
  });
}

function expectSameBox(before: { x: number; y: number; width: number; height: number }, after: typeof before) {
  for (const edge of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(after[edge] - before[edge]), `${edge} changed`).toBeLessThanOrEqual(1);
  }
}

async function readWorkspace(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, workspaceKey);
}

async function visibleImageBottom(image: Locator) {
  return image.evaluate((element) => {
    const img = element as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) throw new Error("Logo image is not decoded");
    context.drawImage(img, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let lastVisibleRow = -1;
    for (let y = canvas.height - 1; y >= 0 && lastVisibleRow < 0; y -= 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (rgba[(y * canvas.width + x) * 4 + 3] > 8) {
          lastVisibleRow = y;
          break;
        }
      }
    }
    if (lastVisibleRow < 0) throw new Error("Logo image has no visible pixels");

    const box = img.getBoundingClientRect();
    const style = getComputedStyle(img);
    const containScale = Math.min(box.width / canvas.width, box.height / canvas.height);
    const coverScale = Math.max(box.width / canvas.width, box.height / canvas.height);
    const scaleY = style.objectFit === "contain"
      ? containScale
      : style.objectFit === "cover"
        ? coverScale
        : style.objectFit === "none"
          ? 1
          : style.objectFit === "scale-down"
            ? Math.min(1, containScale)
            : box.height / canvas.height;
    const renderedHeight = canvas.height * scaleY;
    const positionY = style.objectPosition.split(/\s+/)[1] ?? "50%";
    const offsetY = positionY.endsWith("%")
      ? (box.height - renderedHeight) * Number.parseFloat(positionY) / 100
      : positionY === "top"
        ? 0
        : positionY === "bottom"
          ? box.height - renderedHeight
          : positionY === "center"
            ? (box.height - renderedHeight) / 2
            : Number.parseFloat(positionY);
    return Math.min(box.bottom, box.top + offsetY + (lastVisibleRow + 1) * scaleY);
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("first visit shows the approved English empty workspace and saves a versioned workspace", async ({ page }) => {
  await page.goto("/");
  await expectEmptyWorkspace(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("banner").getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toMatch(/[А-Яа-яЁё]/);

  await expect.poll(() => readWorkspace(page)).toMatchObject({
    version: 1,
    activeWorkspaceId: expect.any(String),
    workspaces: [{ id: expect.any(String), windows: [] }],
  });
  const saved = await readWorkspace(page);
  expect(saved.workspaces).toHaveLength(1);
  expect(saved.activeWorkspaceId).toBe(saved.workspaces[0].id);
  expect(saved.activeWorkspaceId).not.toBe("");

  await page.reload();
  await expectEmptyWorkspace(page);
  await expect.poll(() => readWorkspace(page)).toEqual(saved);
});

for (const { colorScheme, icon, brand, full } of [
  { colorScheme: "light", icon: "logo.png", brand: "brand.png", full: "logo-full.png" },
  { colorScheme: "dark", icon: "logo-dark.png", brand: "brand-dark.png", full: "logo-full-dark.png" },
] as const) {
  test(`${colorScheme} shell and empty instruction do not wait for brand images`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    let releaseImages!: () => void;
    const imageGate = new Promise<void>((resolve) => { releaseImages = resolve; });
    const heldAssets = new Set<string>();
    await page.route(brandAssets, async (route) => {
      heldAssets.add(route.request().url());
      await imageGate;
      await route.continue();
    });

    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expectVisibleBrandShell(page);
      await expect.poll(() => heldAssets.size).toBeGreaterThanOrEqual(3);
      await expect.poll(() => readWorkspace(page)).not.toBeNull();
      await expect(page.getByText(emptyTitle, { exact: true })).toBeVisible();
      await expect(page.getByText(emptyInstruction, { exact: true })).toBeVisible();
    } finally {
      releaseImages();
    }

    await expectEmptyWorkspace(page);
    const banner = page.getByRole("banner");
    const logo = banner.locator(`img[src*="${icon}"]`);
    const brandImage = banner.locator(`img[src*="${brand}"]`);
    const fullLogo = page.getByRole("main").locator(`img[src*="${full}"]`);
    for (const image of [logo, brandImage, fullLogo]) {
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }

    const logoBox = await logo.boundingBox();
    const brandBox = await brandImage.boundingBox();
    const fullBox = await fullLogo.boundingBox();
    const titleBox = await page.getByText(emptyTitle, { exact: true }).boundingBox();
    const instructionBox = await page.getByText(emptyInstruction, { exact: true }).boundingBox();
    expect(logoBox).not.toBeNull();
    expect(brandBox).not.toBeNull();
    expect(fullBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(instructionBox).not.toBeNull();
    expect(logoBox!.width).toBeGreaterThan(20);
    expect(logoBox!.height).toBeGreaterThan(20);
    expect(brandBox!.width).toBeGreaterThan(60);
    expect(brandBox!.height).toBeGreaterThan(15);
    expect(fullBox!.width).toBeGreaterThan(200);
    expect(fullBox!.height).toBeGreaterThan(80);
    expect(await visibleImageBottom(fullLogo)).toBeLessThan(titleBox!.y);
    expect(titleBox!.y + titleBox!.height).toBeLessThan(instructionBox!.y);
  });
}

test("first visit and reload show the shell without a visible waiting line before storage is read", async ({ page }) => {
  let blockedScripts = 0;
  await page.route(externalScripts, (route) => {
    blockedScripts += 1;
    return route.abort();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect.poll(() => blockedScripts).toBeGreaterThan(0);
  await expectVisibleBrandShell(page);
  await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
  await expect(page.getByText(emptyInstruction, { exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: emptyTitle })).toHaveCount(0);
  await expect(page.getByText(/restor|load/i)).toBeHidden();

  await page.unroute(externalScripts);
  await page.reload();
  await expectEmptyWorkspace(page);
  await expect.poll(() => readWorkspace(page)).not.toBeNull();

  blockedScripts = 0;
  await page.route(externalScripts, (route) => {
    blockedScripts += 1;
    return route.abort();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => blockedScripts).toBeGreaterThan(0);
  await expectVisibleBrandShell(page);
  await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
  await expect(page.getByText(emptyInstruction, { exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: emptyTitle })).toHaveCount(0);
  await expect(page.getByText(/restor|load/i)).toBeHidden();

  await page.unroute(externalScripts);
  await page.reload();
  await expectEmptyWorkspace(page);
});

for (const colorScheme of ["light", "dark"] as const) {
  for (const { viewport, width, height } of [
    { viewport: "desktop", width: 1440, height: 900 },
    { viewport: "narrow", width: 320, height: 812 },
  ] as const) {
    for (const visit of ["first visit", "reload"] as const) {
      test(`${colorScheme} ${viewport} ${visit} keeps logo and instruction positions through hydration and image loading`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme });
        if (visit === "reload") {
          await page.goto("/");
          await expectEmptyWorkspace(page);
        }

        let releaseScripts!: () => void;
        let releaseImages!: () => void;
        const scriptGate = new Promise<void>((resolve) => { releaseScripts = resolve; });
        const imageGate = new Promise<void>((resolve) => { releaseImages = resolve; });
        let heldScripts = 0;
        let heldImages = 0;
        await page.route(externalScripts, async (route) => {
          heldScripts += 1;
          await scriptGate;
          await route.continue();
        });
        await page.route(brandAssets, async (route) => {
          heldImages += 1;
          await imageGate;
          await route.continue();
        });

        const fullLogo = page.getByRole("main").locator('img[src*="logo-full"]:visible');
        const title = page.getByText(emptyTitle, { exact: true });
        const instruction = page.getByText(emptyInstruction, { exact: true });
        try {
          if (visit === "reload") await page.reload({ waitUntil: "commit" });
          else await page.goto("/", { waitUntil: "commit" });
          await expect.poll(() => heldScripts).toBeGreaterThan(0);
          await expect.poll(() => heldImages).toBeGreaterThan(0);
          await expectVisibleBrandShell(page);
          await expect(title).toBeHidden();
          await expect(instruction).toBeHidden();
          await expect(page.getByRole("heading", { name: emptyTitle })).toHaveCount(0);
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          const initialLogo = await settledBox(fullLogo);

          releaseScripts();
          await expectEmptyWorkspace(page);
          await expect.poll(() => readWorkspace(page)).not.toBeNull();
          const hydratedLogo = await settledBox(fullLogo);
          const hydratedTitle = await settledBox(title);
          const hydratedInstruction = await settledBox(instruction);
          expectSameBox(initialLogo, hydratedLogo);

          if (viewport === "narrow") {
            const lineCount = await instruction.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const lineTops: number[] = [];
              for (const rect of range.getClientRects()) {
                if (!lineTops.some((top) => Math.abs(top - rect.top) <= 1)) lineTops.push(rect.top);
              }
              return lineTops.length;
            });
            expect(lineCount).toBeGreaterThan(1);
          }

          releaseImages();
          await expect.poll(() => fullLogo.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await page.evaluate(() => new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }));
          expectSameBox(initialLogo, await settledBox(fullLogo));
          expectSameBox(hydratedTitle, await settledBox(title));
          expectSameBox(hydratedInstruction, await settledBox(instruction));
        } finally {
          releaseScripts();
          releaseImages();
        }
      });
    }
  }
}

test("failed brand images do not block the workspace or controls", async ({ page }) => {
  await page.route(brandAssets, (route) => route.abort());
  await page.goto("/");

  await expectVisibleBrandShell(page);
  await expectEmptyWorkspace(page);
  const newButton = page.getByRole("button", { name: "New", exact: true });
  await newButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await themeButton(page).click();
  await expectVisibleBrandShell(page);
  await expectEmptyWorkspace(page);
});

test("follows system theme, then keeps a manual choice before hydration on reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expectEmptyWorkspace(page);
  expect(await page.evaluate((key) => localStorage.getItem(key), themeKey)).toBeNull();
  const systemDark = await page.screenshot({ animations: "disabled", clip: { x: 12, y: 100, width: 16, height: 16 } });

  await themeButton(page).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), themeKey)).toBe("light");
  const chosenLight = await page.screenshot({ animations: "disabled", clip: { x: 12, y: 100, width: 16, height: 16 } });
  expect(chosenLight.equals(systemDark)).toBe(false);

  await page.route(externalScripts, (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  const beforeHydration = await page.screenshot({ animations: "disabled", clip: { x: 12, y: 100, width: 16, height: 16 } });
  expect(beforeHydration.equals(chosenLight)).toBe(true);

  await page.unroute(externalScripts);
  await page.reload();
  await expectEmptyWorkspace(page);
  expect(await page.screenshot({ animations: "disabled", clip: { x: 12, y: 100, width: 16, height: 16 } })).toEqual(chosenLight);
});

test("malformed new workspace offers recovery and preserves the record until Start empty", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => localStorage.setItem(key, "{broken-json"), workspaceKey);
  await page.reload();

  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start empty" })).toBeVisible();
  await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), workspaceKey)).toBe("{broken-json");

  await page.getByRole("button", { name: "Start empty" }).click();
  await expectEmptyWorkspace(page);
  await expect.poll(() => readWorkspace(page)).toMatchObject({ version: 1, workspaces: [{ windows: [] }] });
});

test("Retry reads a repaired workspace without replacing it while the error is shown", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => readWorkspace(page)).toMatchObject({
    version: 1,
    activeWorkspaceId: expect.any(String),
    workspaces: [{ id: expect.any(String), windows: [] }],
  });
  const validRecord = await page.evaluate((key) => localStorage.getItem(key), workspaceKey);
  expect(validRecord).not.toBeNull();
  await page.evaluate((key) => localStorage.setItem(key, "{broken-json"), workspaceKey);
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), workspaceKey)).toBe("{broken-json");

  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: workspaceKey, raw: validRecord! });
  await page.getByRole("button", { name: "Retry" }).click();
  await expectEmptyWorkspace(page);
  expect(await page.evaluate((key) => localStorage.getItem(key), workspaceKey)).toBe(validRecord);
});

test("continues without storage and warns that changes will not be saved", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("Storage unavailable"); };
    Storage.prototype.setItem = () => { throw new Error("Storage unavailable"); };
  });
  await page.goto("/");

  await expectEmptyWorkspace(page);
  await expect(page.getByText(/(?:not|won.t).*sav/i)).toBeVisible();
  await themeButton(page).click();
  await expectEmptyWorkspace(page);
});

test("New explains the next stage accessibly and returns keyboard focus when closed", async ({ page }) => {
  await page.goto("/");
  await expectEmptyWorkspace(page);
  const newButton = page.getByRole("button", { name: "New", exact: true });
  await newButton.focus();
  await page.keyboard.press("Enter");

  const explanation = page.getByRole("dialog");
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText(/window/i);
  await expect(explanation).toContainText(/next/i);
  await page.keyboard.press("Escape");
  await expect(explanation).toHaveCount(0);
  await expect(newButton).toBeFocused();
  await expectEmptyWorkspace(page);
});

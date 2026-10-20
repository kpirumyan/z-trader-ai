import { expect, test, type Locator, type Page } from "@playwright/test";

// Moved from tests/e2e/home.spec.ts. Activation follows the contracts in README.md.
const workspaceKey = "z-trader-workspace-v1";
const emptyTitle = "Your workspace is empty";
const emptyInstruction = "Use New to open a Chart, Level II, or T & S window.";
const externalScripts = /\/_next\/static\/.*\.js(?:\?.*)?$/;
const brandAssets = /(?:logo(?:-full)?|brand)(?:-dark)?\.png(?:[?&#].*)?$/;
const fontAssets = /\.(?:woff2?|ttf|otf)(?:\?.*)?$/;
const themeButton = (page: Page) => page.getByRole("button", { name: /Switch to (dark|light) theme/ });

async function expectEmptyWorkspace(page: Page) {
  await expect(page.getByText(emptyTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(emptyInstruction, { exact: true })).toBeVisible();
}

async function readWorkspace(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, workspaceKey);
}

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result!;
}

function expectSameBox(before: Awaited<ReturnType<typeof box>>, after: typeof before) {
  for (const edge of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(after[edge] - before[edge]), `${edge} changed`).toBeLessThanOrEqual(0.5);
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("first visit and reload show the empty workspace instruction", async ({ page }) => {
  await page.goto("/");
  await expectEmptyWorkspace(page);
  expect(await page.locator("body").innerText()).not.toMatch(/[А-Яа-яЁё]/);
  await page.reload();
  await expectEmptyWorkspace(page);
});

test("workspace instruction appears only after client state is available on first load and reload", async ({ page }) => {
  for (const visit of ["first load", "reload"]) {
    await page.route(externalScripts, (route) => route.abort());
    if (visit === "first load") await page.goto("/", { waitUntil: "domcontentloaded" });
    else await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
    await expect(page.getByText(emptyInstruction, { exact: true })).toBeHidden();
    await expect(page.getByRole("heading", { name: emptyTitle })).toHaveCount(0);
    await expect(page.getByText(/restor|load/i)).toBeHidden();
    await page.unroute(externalScripts);
    await page.reload();
    await expectEmptyWorkspace(page);
    await expect.poll(() => readWorkspace(page)).not.toBeNull();
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [1440, 320]) {
    for (const visit of ["first load", "reload"] as const) {
      test(`${colorScheme} ${width}px ${visit}: instruction stays below the logo and stable through PNG and font loading`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        if (visit === "reload") {
          await page.goto("/");
          await expectEmptyWorkspace(page);
        }
        let releaseImages!: () => void;
        let releaseFonts!: () => void;
        let heldFonts = 0;
        const imageGate = new Promise<void>((resolve) => { releaseImages = resolve; });
        const fontGate = new Promise<void>((resolve) => { releaseFonts = resolve; });
        await page.route(brandAssets, async (route) => { await imageGate; await route.continue(); });
        await page.route(fontAssets, async (route) => {
          heldFonts += 1;
          await fontGate;
          await route.continue();
        });
        const title = page.getByText(emptyTitle, { exact: true });
        const instruction = page.getByText(emptyInstruction, { exact: true });
        try {
          if (visit === "reload") await page.reload({ waitUntil: "domcontentloaded" });
          else await page.goto("/", { waitUntil: "domcontentloaded" });
          // Client workspace must become usable while PNG and font requests are still held.
          await expectEmptyWorkspace(page);
          await expect.poll(() => readWorkspace(page)).not.toBeNull();
          await expect.poll(() => heldFonts).toBeGreaterThan(0);
          const initialTitle = await box(title);
          const initialInstruction = await box(instruction);
          expect(initialTitle.y + initialTitle.height).toBeLessThan(initialInstruction.y);
          if (width === 320) {
            const lineCount = await instruction.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const tops: number[] = [];
              for (const rect of range.getClientRects()) {
                if (!tops.some((top) => Math.abs(top - rect.top) <= 1)) tops.push(rect.top);
              }
              return tops.length;
            });
            expect(lineCount).toBeGreaterThan(1);
          }
          releaseImages();
          const logo = page.getByRole("main").locator('img[src*="logo-full"]:visible');
          await logo.evaluate((element) => (element as HTMLImageElement).decode());
          const artworkBottom = await logo.evaluate((element) => {
            const image = element as HTMLImageElement;
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let last = -1;
            for (let y = canvas.height - 1; y >= 0 && last < 0; y -= 1) {
              for (let x = 0; x < canvas.width; x += 1) {
                if (rgba[(y * canvas.width + x) * 4 + 3] > 8) { last = y; break; }
              }
            }
            if (last < 0) throw new Error("Full logo has no visible artwork");
            const bounds = image.getBoundingClientRect();
            const style = getComputedStyle(image);
            const contain = Math.min(bounds.width / canvas.width, bounds.height / canvas.height);
            const cover = Math.max(bounds.width / canvas.width, bounds.height / canvas.height);
            const scale = style.objectFit === "cover" ? cover
              : style.objectFit === "contain" ? contain
                : style.objectFit === "scale-down" ? Math.min(1, contain)
                  : style.objectFit === "none" ? 1 : bounds.height / canvas.height;
            const space = bounds.height - canvas.height * scale;
            const position = style.objectPosition.split(/\s+/)[1] ?? "50%";
            const offset = position.endsWith("%") ? space * Number.parseFloat(position) / 100 : Number.parseFloat(position);
            let bottom = Math.min(bounds.bottom, bounds.top + offset + (last + 1) * scale);
            for (let ancestor = image.parentElement; ancestor; ancestor = ancestor.parentElement) {
              if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(ancestor).overflowY)) {
                bottom = Math.min(bottom, ancestor.getBoundingClientRect().bottom);
              }
            }
            return bottom;
          });
          expect(artworkBottom).toBeLessThan(initialTitle.y);
          expectSameBox(initialTitle, await box(title));
          expectSameBox(initialInstruction, await box(instruction));
          releaseFonts();
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await page.evaluate(() => new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }));
          expectSameBox(initialTitle, await box(title));
          expectSameBox(initialInstruction, await box(instruction));
        } finally {
          releaseImages();
          releaseFonts();
          await page.unrouteAll({ behavior: "wait" });
        }
      });
    }
  }
}

test("failed brand images do not block workspace instruction or New explanation", async ({ page }) => {
  await page.route(brandAssets, (route) => route.abort());
  await page.goto("/");
  await expectEmptyWorkspace(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expectEmptyWorkspace(page);
});

test("malformed workspace preserves the record until Start empty", async ({ page }) => {
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
    version: 1, activeWorkspaceId: expect.any(String),
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

test("unavailable workspace storage leaves instruction usable and warns about saving", async ({ page }) => {
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

test("New explains the next stage and returns keyboard focus when closed", async ({ page }) => {
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

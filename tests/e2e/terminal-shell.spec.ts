import { inflateSync } from "node:zlib";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

type Theme = "light" | "dark";
type Box = { x: number; y: number; width: number; height: number };
const themeKey = "z-trader-theme-v1";
const chunks = /\/_next\/static\/.*\.js(?:\?.*)?$/;
const pngs = /(?:logo(?:-full)?|brand)(?:-dark)?\.png(?:[?&#].*)?$/;
const fonts = /\.(?:woff2?|ttf|otf)(?:\?.*)?$/;
const opposite = (theme: Theme): Theme => theme === "light" ? "dark" : "light";
const themeButton = (page: Page, theme: Theme) => page.getByRole("banner")
  .getByRole("button", { name: `Switch to ${opposite(theme)} theme`, exact: true });

test.use({ viewport: { width: 1440, height: 900 } });

function images(page: Page, theme: Theme) {
  const suffix = theme === "dark" ? "-dark" : "";
  return [
    page.getByRole("banner").locator(`img[src*="logo${suffix}.png"]:visible`),
    page.getByRole("banner").locator(`img[src*="brand${suffix}.png"]:visible`),
    page.getByRole("main").locator(`img[src*="logo-full${suffix}.png"]:visible`),
  ];
}

async function frames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function seedTheme(page: Page, saved: string | null, unavailable: boolean | "read" = false) {
  await page.addInitScript(({ key, value, unavailable }) => {
    if (unavailable === true) {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() { throw new DOMException("Storage unavailable", "SecurityError"); },
      });
    } else if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
    if (unavailable === "read") {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name) {
        if (name === key) throw new DOMException("Read denied", "SecurityError");
        return original.call(this, name);
      };
    }

    // Observe the earliest frame containing the public main region; do not wait for fonts.
    const sample = () => {
      const main = document.querySelector('main, [role="main"]');
      if (!main || !main.getBoundingClientRect().height) {
        requestAnimationFrame(sample);
        return;
      }
      let canvas = "transparent";
      for (let element: Element | null = main; element; element = element.parentElement) {
        const color = getComputedStyle(element).backgroundColor;
        if (color !== "transparent" && color !== "rgba(0, 0, 0, 0)") {
          canvas = color;
          break;
        }
      }
      Object.defineProperty(window, "__shellFirstFrame", {
        value: { theme: document.documentElement.dataset.theme, canvas },
      });
    };
    requestAnimationFrame(sample);
  }, { key: themeKey, value: saved, unavailable });
}

async function expectShell(page: Page, theme: Theme, decoded = true) {
  const banner = page.getByRole("banner");
  const main = page.getByRole("main");
  await expect(banner).toHaveCount(1);
  await expect(main).toHaveCount(1);
  await expect(banner).toBeVisible();
  await expect(main).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(banner.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await expect(themeButton(page, theme)).toBeVisible();
  await expect(themeButton(page, theme)).not.toHaveAttribute("title");
  expect((await banner.boundingBox())!.height).toBe(32);
  expect(await banner.innerText()).not.toMatch(/[А-Яа-яЁё]/);

  const selected = images(page, theme);
  await expect(banner.locator('img[src*="logo"]:visible')).toHaveCount(1);
  await expect(banner.locator('img[src*="brand"]:visible')).toHaveCount(1);
  await expect(main.locator('img[src*="logo-full"]:visible')).toHaveCount(1);
  for (const image of selected) {
    await expect(image).toHaveCount(1);
    await expect(image).toBeVisible();
    const opacity = await image.evaluate((element) => {
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) {
        opacity *= Number(getComputedStyle(node).opacity);
      }
      return opacity;
    });
    expect(opacity).toBeGreaterThan(0);
    if (image === selected[2]) expect(opacity).toBeLessThan(1);
    if (decoded) await expectDecoded(image);
  }
}

async function expectDecoded(image: Locator) {
  await image.evaluate((element) => (element as HTMLImageElement).decode());
  const dimensions = await image.evaluate((element) => {
    const image = element as HTMLImageElement;
    const box = image.getBoundingClientRect();
    return {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      width: box.width,
      height: box.height,
      fit: getComputedStyle(image).objectFit,
      visibleArtwork: (() => {
        const style = getComputedStyle(image);
        let left = Math.max(0, box.left);
        let top = Math.max(0, box.top);
        let right = Math.min(innerWidth, box.right);
        let bottom = Math.min(innerHeight, box.bottom);
        for (let ancestor = image.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const clip = ancestor.getBoundingClientRect();
          const clipping = getComputedStyle(ancestor);
          if (/(hidden|clip|scroll|auto)/.test(clipping.overflowX)) {
            left = Math.max(left, clip.left);
            right = Math.min(right, clip.right);
          }
          if (/(hidden|clip|scroll|auto)/.test(clipping.overflowY)) {
            top = Math.max(top, clip.top);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
        const contain = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
        const cover = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight);
        const scale = style.objectFit === "cover" ? cover
          : style.objectFit === "contain" ? contain
            : style.objectFit === "scale-down" ? Math.min(1, contain) : 1;
        const renderedWidth = style.objectFit === "fill" ? box.width : image.naturalWidth * scale;
        const renderedHeight = style.objectFit === "fill" ? box.height : image.naturalHeight * scale;
        const position = style.objectPosition.split(/\s+/);
        const offset = (value: string, space: number) => value.endsWith("%")
          ? space * Number.parseFloat(value) / 100 : Number.parseFloat(value);
        const originX = box.left + offset(position[0], box.width - renderedWidth);
        const originY = box.top + offset(position[1] ?? "50%", box.height - renderedHeight);
        const canvas = document.createElement("canvas");
        const sampleScale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * sampleScale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * sampleScale));
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            const px = originX + (x + 0.5) / canvas.width * renderedWidth;
            const py = originY + (y + 0.5) / canvas.height * renderedHeight;
            if (rgba[(y * canvas.width + x) * 4 + 3] > 8
              && px >= left && px < right && py >= top && py < bottom) return true;
          }
        }
        return false;
      })(),
    };
  });
  expect(dimensions.naturalWidth).toBeGreaterThan(0);
  expect(dimensions.naturalHeight).toBeGreaterThan(0);
  expect(dimensions.visibleArtwork, "nontransparent artwork survives cropping inside the viewport").toBe(true);
  if (dimensions.fit === "fill") {
    expect(dimensions.width / dimensions.height)
      .toBeCloseTo(dimensions.naturalWidth / dimensions.naturalHeight, 1);
  }
}

async function shellBoxes(page: Page, theme: Theme): Promise<Box[]> {
  const targets = [
    page.getByRole("banner"), page.getByRole("main"),
    page.getByRole("banner").getByRole("button", { name: "New", exact: true }),
    themeButton(page, theme), ...images(page, theme),
  ];
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  return Promise.all(targets.map(async (target, index) => {
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    if (index < 4) {
      expect(box!.x).toBeGreaterThanOrEqual(-0.5);
      expect(box!.y).toBeGreaterThanOrEqual(-0.5);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5);
    }
    return box!;
  }));
}

function expectStable(before: Box[], after: Box[]) {
  const names = ["banner", "main", "New", "theme control", "logo", "brand", "full logo"];
  for (const [index, initial] of before.entries()) {
    for (const edge of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(after[index][edge] - initial[edge]), `${names[index]} ${edge}`)
        .toBeLessThanOrEqual(0.5);
    }
  }
}

function gate() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  let held = 0;
  const handler = async (route: Route) => {
    held += 1;
    await ready;
    await route.continue();
  };
  return { release, handler, held: () => held };
}

async function switchTheme(page: Page, current: Theme) {
  await expect(async () => {
    await themeButton(page, current).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", opposite(current), { timeout: 500 });
  }).toPass({ timeout: 10000 });
  await expectShell(page, opposite(current));
}

async function expectPaintedCanvas(page: Page, theme: Theme) {
  const viewport = page.viewportSize()!;
  // One pixel at the bottom left of the empty canvas, outside the centered watermark.
  const png = await page.screenshot({ clip: { x: 0, y: viewport.height - 1, width: 1, height: 1 } });
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(1);
  expect(png.readUInt32BE(20)).toBe(1);
  expect(png[24]).toBe(8);
  expect([2, 6]).toContain(png[25]);
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      data.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  // For the first pixel of the first row every PNG filter predictor is zero.
  const pixel = [...inflateSync(Buffer.concat(data)).subarray(1, 4)];
  expect(pixel).toEqual(theme === "dark" ? [14, 14, 14] : [255, 255, 255]);
}

test("GET / returns the English shell in HTML even with all JavaScript disabled", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("text/html");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "New", exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: /Switch to (dark|light) theme/ })).toBeVisible();
    for (const target of [
      page.getByRole("banner").locator('img[src*="logo"]:visible'),
      page.getByRole("banner").locator('img[src*="brand"]:visible'),
      page.getByRole("main").locator('img[src*="logo-full"]:visible'),
    ]) {
      await expect(target).toHaveCount(1);
      await expect(target).toBeVisible();
    }
    expect(await page.locator('head script:not([src]):not([async]):not([defer]):not([type="module"]):not([type="application/ld+json"])').count())
      .toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

for (const system of ["light", "dark"] as const) {
  for (const sample of [
    { name: "missing choice", saved: null, unavailable: false, expected: system },
    { name: "invalid choice", saved: "sepia", unavailable: false, expected: system },
    { name: "empty choice", saved: "", unavailable: false, expected: system },
    { name: "JSON string is not a theme", saved: '"dark"', unavailable: false, expected: system },
    { name: "saved choice overrides system", saved: opposite(system), unavailable: false, expected: opposite(system) },
    { name: "unavailable storage", saved: null, unavailable: true, expected: system },
    { name: "theme read throws", saved: opposite(system), unavailable: "read" as const, expected: system },
  ]) {
    test(`${system} system: ${sample.name} paints the matching shell before hydration on first load and reload`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: system });
      await seedTheme(page, sample.saved, sample.unavailable);
      let blocked = 0;
      await page.route(chunks, (route) => { blocked += 1; return route.abort(); });
      for (const visit of ["first load", "reload"]) {
        const response = visit === "first load"
          ? await page.goto("/", { waitUntil: "domcontentloaded" })
          : await page.reload({ waitUntil: "domcontentloaded" });
        expect(response?.status()).toBe(200);
        await expect.poll(() => blocked).toBeGreaterThan(0);
        await expectShell(page, sample.expected);
        await expect.poll(() => page.evaluate(() => Reflect.get(window, "__shellFirstFrame")))
          .toEqual({
            theme: sample.expected,
            canvas: sample.expected === "dark" ? "rgb(14, 14, 14)" : "rgb(255, 255, 255)",
          });
        await expectPaintedCanvas(page, sample.expected);
        if (sample.name === "missing choice" && visit === "first load") {
          await page.screenshot({ path: test.info().outputPath(`${system}-before-hydration.png`) });
        }
      }
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 320]) {
    for (const visit of ["first load", "reload"] as const) {
      test(`${theme} ${width}px ${visit}: PNG, fonts and hydration preserve shell geometry`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        await seedTheme(page, null);
        if (visit === "reload") {
          await page.goto("/");
          await expectShell(page, theme);
        }
        const scripts = gate();
        const pictures = gate();
        const typography = gate();
        await page.route(chunks, scripts.handler);
        await page.route(pngs, pictures.handler);
        await page.route(fonts, typography.handler);
        try {
          const response = visit === "first load"
            ? await page.goto("/", { waitUntil: "commit" })
            : await page.reload({ waitUntil: "commit" });
          expect(response?.status()).toBe(200);
          await expect.poll(scripts.held).toBeGreaterThan(0);
          await expect.poll(pictures.held).toBeGreaterThan(0);
          await expectShell(page, theme, false);
          await expect.poll(typography.held).toBeGreaterThan(0);
          await frames(page);
          const initial = await shellBoxes(page, theme);
          for (const image of images(page, theme)) {
            expect(await image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(0);
          }

          pictures.release();
          for (const image of images(page, theme)) await expectDecoded(image);
          await frames(page);
          expectStable(initial, await shellBoxes(page, theme));

          typography.release();
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await frames(page);
          expectStable(initial, await shellBoxes(page, theme));

          scripts.release();
          await switchTheme(page, theme);
          await switchTheme(page, opposite(theme));
          await frames(page);
          await expectShell(page, theme);
          expectStable(initial, await shellBoxes(page, theme));
        } finally {
          scripts.release();
          pictures.release();
          typography.release();
          await page.unrouteAll({ behavior: "wait" });
        }
      });
    }
  }
}

test("theme control saves the choice, keeps it before hydration on reload, and has no tooltip", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expectShell(page, "dark");
  await themeButton(page, "dark").hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await switchTheme(page, "dark");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), themeKey)).toBe("light");
  await page.route(chunks, (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectShell(page, "light");
  await expectPaintedCanvas(page, "light");
  await page.unroute(chunks);
  await page.reload();
  await expectShell(page, "light");
  await page.screenshot({ path: test.info().outputPath("light-after-hydration.png") });
  await themeButton(page, "light").focus();
  await themeButton(page, "light").press("Enter");
  await expectShell(page, "dark");
  await themeButton(page, "dark").hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("dark-after-hydration.png") });
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), themeKey)).toBe("dark");
});

test("storage write failure leaves the shell and theme control usable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, themeKey);
  await page.goto("/");
  await expectShell(page, "light");
  await switchTheme(page, "light");
  await switchTheme(page, "dark");
  expect(await page.evaluate((key) => localStorage.getItem(key), themeKey)).toBeNull();
});

test("unavailable storage preserves the hydrated shell and session theme switching", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await seedTheme(page, null, true);
  await page.goto("/");
  await expectShell(page, "dark");
  await switchTheme(page, "dark");
  await switchTheme(page, "light");
});

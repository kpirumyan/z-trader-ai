import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

import { THEME_STORAGE_KEY, type Theme } from "@/src/shared/theme";

type Box = { x: number; y: number; width: number; height: number };

const chunks = /\/_next\/static\/.*\.js(?:\?.*)?$/;
const pngs = /(?:logo(?:-full)?|brand)(?:-dark)?\.png(?:[?&#].*)?$/;
const fonts = /\.(?:woff2?|ttf|otf)(?:\?.*)?$/;
const emptyTitle = "Your workspace is empty";
const emptyInstruction = "Use New to open a Chart, Level II, or T & S window.";
const opposite = (theme: Theme): Theme => (theme === "light" ? "dark" : "light");
const themeButton = (page: Page, theme: Theme) =>
  page
    .getByRole("banner")
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
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function seedTheme(page: Page, saved: string | null, unavailable = false) {
  await page.addInitScript(
    ({ key, value, unavailable }) => {
      if (unavailable) {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          get() {
            throw new DOMException("Storage unavailable", "SecurityError");
          },
        });
      } else if (value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
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
    },
    { key: THEME_STORAGE_KEY, value: saved, unavailable },
  );
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
  await expect(image).toBeVisible();
  await image.evaluate((element) => (element as HTMLImageElement).decode());

  const dimensions = await image.evaluate((element) => {
    const imageElement = element as HTMLImageElement;

    return {
      naturalWidth: imageElement.naturalWidth,
      naturalHeight: imageElement.naturalHeight,
    };
  });

  expect(dimensions.naturalWidth).toBeGreaterThan(0);
  expect(dimensions.naturalHeight).toBeGreaterThan(0);
}

async function shellBoxes(page: Page, theme: Theme): Promise<Box[]> {
  const targets = [
    page.getByRole("banner"),
    page.getByRole("main"),
    page.getByRole("banner").getByRole("button", { name: "New", exact: true }),
    themeButton(page, theme),
    ...images(page, theme),
  ];
  const viewport = page.viewportSize()!;

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  );

  return Promise.all(
    targets.map(async (target, index) => {
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
    }),
  );
}

function expectStable(before: Box[], after: Box[]) {
  const names = ["banner", "main", "New", "theme control", "logo", "brand", "full logo"];

  for (const [index, initial] of before.entries()) {
    for (const edge of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs(after[index][edge] - initial[edge]),
        `${names[index]} ${edge}`,
      ).toBeLessThanOrEqual(0.5);
    }
  }
}

async function instructionBoxes(page: Page): Promise<Box[]> {
  const targets = [emptyTitle, emptyInstruction].map((text) =>
    page.getByText(text, { exact: true }),
  );

  return Promise.all(
    targets.map(async (target) => {
      await expect(target).toBeVisible();

      const bounds = await target.boundingBox();

      expect(bounds).not.toBeNull();

      const viewport = page.viewportSize()!;

      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);

      return bounds!;
    }),
  );
}

function expectInstructionStable(before: Box[], after: Box[]) {
  for (const [index, initial] of before.entries()) {
    for (const edge of ["x", "y", "width", "height"] as const) {
      expect(
        Math.abs(after[index][edge] - initial[edge]),
        `instruction ${index} ${edge}`,
      ).toBeLessThanOrEqual(0.5);
    }
  }
}

async function instructionFontState(page: Page, load = false) {
  return page.getByText(emptyInstruction, { exact: true }).evaluate(async (element, load) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const queries: { family: string; font: string; text: string }[] = [];
    let node: Node | null;

    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;

      const style = getComputedStyle(node.parentElement!);
      const family = style.fontFamily
        .split(",")[0]
        .trim()
        .replace(/^['"]|['"]$/g, "");

      queries.push({
        family,
        font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${JSON.stringify(family)}`,
        text: node.textContent,
      });
    }

    return Promise.all(
      queries.map(async ({ family, font, text }) => {
        const faces = load
          ? await document.fonts.load(font, text)
          : [...document.fonts].filter(
              (face) => face.family.replace(/^['"]|['"]$/g, "") === family,
            );

        return {
          family,
          font,
          text,
          ready: document.fonts.check(font, text),
          faces: faces.map((face) => ({
            family: face.family.replace(/^['"]|['"]$/g, ""),
            status: face.status,
          })),
        };
      }),
    );
  }, load);
}

function gate() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
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

    await expect(page.locator("html")).toHaveAttribute("data-theme", opposite(current), {
      timeout: 500,
    });
  }).toPass({ timeout: 10000 });

  await expectShell(page, opposite(current));
}

test.describe("Terminal shell SSR / No-JS fallback", () => {
  test("GET / returns the English shell in HTML even with all JavaScript disabled", async ({
    browser,
    baseURL,
  }) => {
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

      await expect(
        page.getByRole("banner").getByRole("button", { name: "New", exact: true }),
      ).toBeVisible();

      await expect(
        page.getByRole("banner").getByRole("button", { name: /Switch to (dark|light) theme/ }),
      ).toBeVisible();

      for (const target of [
        page.getByRole("banner").locator('img[src*="logo"]:visible'),
        page.getByRole("banner").locator('img[src*="brand"]:visible'),
        page.getByRole("main").locator('img[src*="logo-full"]:visible'),
      ]) {
        await expect(target).toHaveCount(1);
        await expect(target).toBeVisible();
      }

      expect(
        await page
          .locator(
            'head script:not([src]):not([async]):not([defer]):not([type="module"]):not([type="application/ld+json"])',
          )
          .count(),
      ).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});

test.describe("Pre-hydration theme painting & storage fallback", () => {
  const cases: {
    title: string;
    saved: string | null;
    unavailable: boolean;
    expected: Theme;
    screenshot?: string;
  }[] = [
    {
      title:
        "missing choice in storage paints default dark shell before hydration on first load and reload",
      saved: null,
      unavailable: false,
      expected: "dark",
      screenshot: "dark-before-hydration.png",
    },
    {
      title: "saved light theme paints matching shell before hydration on first load and reload",
      saved: "light",
      unavailable: false,
      expected: "light",
    },
    {
      title:
        "unavailable storage falls back to dark shell before hydration on first load and reload",
      saved: null,
      unavailable: true,
      expected: "dark",
    },
    {
      title:
        "corrupted value in storage falls back to dark shell before hydration on first load and reload",
      saved: "corrupted-value-xyz",
      unavailable: false,
      expected: "dark",
    },
  ];

  for (const sample of cases) {
    test(sample.title, async ({ page }) => {
      await seedTheme(page, sample.saved, sample.unavailable);

      let blocked = 0;

      await page.route(chunks, (route) => {
        blocked += 1;

        return route.abort();
      });

      for (const visit of ["first load", "reload"]) {
        const response =
          visit === "first load"
            ? await page.goto("/", { waitUntil: "domcontentloaded" })
            : await page.reload({ waitUntil: "domcontentloaded" });

        expect(response?.status()).toBe(200);
        await expect.poll(() => blocked).toBeGreaterThan(0);
        await expectShell(page, sample.expected);

        await expect
          .poll(() => page.evaluate(() => Reflect.get(window, "__shellFirstFrame")))
          .toEqual({
            theme: sample.expected,
            canvas: sample.expected === "dark" ? "rgb(14, 14, 14)" : "rgb(255, 255, 255)",
          });

        await expect(page.getByRole("main")).toHaveCSS(
          "background-color",
          sample.expected === "dark" ? "rgb(14, 14, 14)" : "rgb(255, 255, 255)",
        );

        if (sample.screenshot && visit === "first load") {
          await page.screenshot({ path: test.info().outputPath(sample.screenshot) });
        }
      }
    });
  }
});

test.describe("Client instruction, PNG and fonts geometry stability", () => {
  for (const width of [1440, 320]) {
    test(`${width}px: client instruction, PNG and fonts preserve shell and text geometry`, async ({
      page,
    }) => {
      const theme: Theme = "dark";

      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await seedTheme(page, null);

      const scripts = gate();
      const pictures = gate();
      const typography = gate();

      await page.route(chunks, scripts.handler);
      await page.route(pngs, pictures.handler);
      await page.route(fonts, typography.handler);

      try {
        const response = await page.goto("/", { waitUntil: "commit" });

        expect(response?.status()).toBe(200);
        await expect.poll(scripts.held).toBeGreaterThan(0);
        await expect.poll(pictures.held).toBeGreaterThan(0);
        await expectShell(page, theme, false);
        await expect.poll(typography.held).toBeGreaterThan(0);
        await frames(page);

        const initial = await shellBoxes(page, theme);

        await expect(page.getByText(emptyTitle, { exact: true })).toBeHidden();
        await expect(page.getByText(emptyInstruction, { exact: true })).toBeHidden();
        await expect(page.getByText(/restoring workspace|loading workspace/i)).toHaveCount(0);

        for (const image of images(page, theme)) {
          expect(
            await image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
          ).toBe(0);
        }

        scripts.release();

        const initialText = await instructionBoxes(page);

        await frames(page);

        const pendingGeist = await instructionFontState(page);

        expect(pendingGeist.length).toBeGreaterThan(0);

        for (const query of pendingGeist) {
          expect(query.family, `requested instruction font: ${query.font}`).toMatch(/geist/i);
          expect(query.ready, `instruction font must still be held: ${query.font}`).toBe(false);

          expect(
            query.faces.some((face) => face.status === "loading"),
            `pending Geist face: ${query.font}`,
          ).toBe(true);
        }

        expectStable(initial, await shellBoxes(page, theme));
        expect(initialText[0].y + initialText[0].height).toBeLessThan(initialText[1].y);

        pictures.release();
        for (const image of images(page, theme)) await expectDecoded(image);
        await frames(page);
        expectStable(initial, await shellBoxes(page, theme));
        expectInstructionStable(initialText, await instructionBoxes(page));

        const fullLogoBox = await images(page, theme)[2].boundingBox();

        expect(fullLogoBox).not.toBeNull();
        expect(fullLogoBox!.y).toBeLessThan(initialText[0].y);

        typography.release();

        const loadedGeist = await instructionFontState(page, true);

        expect(loadedGeist.map(({ family, font, text }) => ({ family, font, text }))).toEqual(
          pendingGeist.map(({ family, font, text }) => ({ family, font, text })),
        );

        for (const query of loadedGeist) {
          expect(query.ready, `Geist must now be available: ${query.font}`).toBe(true);
          expect(query.faces.length, `loaded faces for ${query.font}`).toBeGreaterThan(0);

          expect(
            query.faces.every((face) => face.family === query.family && face.status === "loaded"),
          ).toBe(true);
        }

        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await frames(page);
        expectStable(initial, await shellBoxes(page, theme));
        expectInstructionStable(initialText, await instructionBoxes(page));

        await switchTheme(page, theme);
        await switchTheme(page, opposite(theme));
        await frames(page);
        await expectShell(page, theme);
        expectStable(initial, await shellBoxes(page, theme));
        expectInstructionStable(initialText, await instructionBoxes(page));
        await expect(page.getByText(/restoring workspace|loading workspace/i)).toHaveCount(0);
      } finally {
        scripts.release();
        pictures.release();
        typography.release();
        await page.unrouteAll({ behavior: "wait" });
      }
    });
  }
});

test.describe("Theme control keyboard accessibility", () => {
  test("theme control toggles via keyboard (Enter and Space) and has no tooltip", async ({
    page,
  }) => {
    await page.goto("/");
    await expectShell(page, "dark");
    await themeButton(page, "dark").hover();
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    await themeButton(page, "dark").focus();
    await themeButton(page, "dark").press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY))
      .toBe("light");

    await expect(themeButton(page, "light")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY))
      .toBe("dark");

    await expect(themeButton(page, "dark")).toBeFocused();
  });
});

test.describe("Theme persistence across user actions and reload", () => {
  test("user toggles theme and selection persists across page reload without addInitScript", async ({
    page,
  }) => {
    await page.goto("/");
    await expectShell(page, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await themeButton(page, "dark").click();
    await expectShell(page, "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY))
      .toBe("light");

    await page.reload();

    await expectShell(page, "light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY))
      .toBe("light");

    await themeButton(page, "light").click();
    await expectShell(page, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY))
      .toBe("dark");

    await page.reload();

    await expectShell(page, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY))
      .toBe("dark");
  });
});

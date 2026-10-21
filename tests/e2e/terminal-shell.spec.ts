import { inflateSync } from "node:zlib";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

type Theme = "light" | "dark";
type Box = { x: number; y: number; width: number; height: number };
type TextLayout = { lines: string[]; clipped: string[] };

const themeKey = "z-trader-theme-v1";
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

async function seedTheme(page: Page, saved: string | null, unavailable: boolean | "read" = false) {
  await page.addInitScript(
    ({ key, value, unavailable }) => {
      if (unavailable === true) {
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
    },
    { key: themeKey, value: saved, unavailable },
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
        const scale =
          style.objectFit === "cover"
            ? cover
            : style.objectFit === "contain"
              ? contain
              : style.objectFit === "scale-down"
                ? Math.min(1, contain)
                : 1;
        const renderedWidth = style.objectFit === "fill" ? box.width : image.naturalWidth * scale;
        const renderedHeight =
          style.objectFit === "fill" ? box.height : image.naturalHeight * scale;
        const position = style.objectPosition.split(/\s+/);
        const offset = (value: string, space: number) =>
          value.endsWith("%") ? (space * Number.parseFloat(value)) / 100 : Number.parseFloat(value);
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
            const px = originX + ((x + 0.5) / canvas.width) * renderedWidth;
            const py = originY + ((y + 0.5) / canvas.height) * renderedHeight;

            if (
              rgba[(y * canvas.width + x) * 4 + 3] > 8 &&
              px >= left &&
              px < right &&
              py >= top &&
              py < bottom
            )
              return true;
          }
        }

        return false;
      })(),
    };
  });

  expect(dimensions.naturalWidth).toBeGreaterThan(0);
  expect(dimensions.naturalHeight).toBeGreaterThan(0);

  expect(
    dimensions.visibleArtwork,
    "nontransparent artwork survives cropping inside the viewport",
  ).toBe(true);

  if (dimensions.fit === "fill") {
    expect(dimensions.width / dimensions.height).toBeCloseTo(
      dimensions.naturalWidth / dimensions.naturalHeight,
      1,
    );
  }
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

async function instructionTextLayout(page: Page): Promise<TextLayout[]> {
  // Rects detect wrapping and clipping; individual glyph metrics may change as Geist loads.
  return Promise.all(
    [emptyTitle, emptyInstruction].map((text) =>
      page.getByText(text, { exact: true }).evaluate((element) => {
        const lines: { text: string; top: number; bottom: number }[] = [];
        const clipped: string[] = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node: Node | null;

        while ((node = walker.nextNode())) {
          const content = node.textContent ?? "";
          const owner = node.parentElement!;
          const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };

          for (let ancestor: Element | null = owner; ancestor; ancestor = ancestor.parentElement) {
            const bounds = ancestor.getBoundingClientRect();
            const style = getComputedStyle(ancestor);

            if (style.display === "inline" || style.display === "contents") continue;

            if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) {
              clip.left = Math.max(clip.left, bounds.left + ancestor.clientLeft);

              clip.right = Math.min(
                clip.right,
                bounds.left + ancestor.clientLeft + ancestor.clientWidth,
              );
            }

            if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) {
              clip.top = Math.max(clip.top, bounds.top + ancestor.clientTop);

              clip.bottom = Math.min(
                clip.bottom,
                bounds.top + ancestor.clientTop + ancestor.clientHeight,
              );
            }
          }

          for (let index = 0; index < content.length; index += 1) {
            const character = content[index];

            if (!character.trim()) continue;

            const range = document.createRange();

            range.setStart(node, index);
            range.setEnd(node, index + 1);

            const rects = [...range.getClientRects()].filter(
              (rect) => rect.width > 0 && rect.height > 0,
            );

            if (!rects.length) clipped.push(`${character}: no rendered rect`);

            for (const rect of rects) {
              if (
                rect.left < clip.left - 0.5 ||
                rect.top < clip.top - 0.5 ||
                rect.right > clip.right + 0.5 ||
                rect.bottom > clip.bottom + 0.5
              ) {
                clipped.push(`${character}: outside viewport or overflow clip`);
              }

              const line = lines.find(
                (line) =>
                  Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top) >
                  Math.min(line.bottom - line.top, rect.height) / 2,
              );

              if (!line) lines.push({ text: character, top: rect.top, bottom: rect.bottom });
              else {
                line.top = Math.min(line.top, rect.top);
                line.bottom = Math.max(line.bottom, rect.bottom);
                line.text += character;
              }
            }
          }
        }

        return { lines: lines.map((line) => line.text), clipped };
      }),
    ),
  );
}

function expectCompleteText(layout: TextLayout[]) {
  for (const [index, expected] of [emptyTitle, emptyInstruction].entries()) {
    expect(layout[index].clipped, `text ${index} must remain fully visible`).toEqual([]);
    expect(layout[index].lines.join("")).toBe(expected.replace(/\s/g, ""));
  }
}

function expectTextWrapping(before: TextLayout[], after: TextLayout[]) {
  expectCompleteText(after);

  for (const [index, initial] of before.entries()) {
    expect(after[index].lines, `text ${index}: unchanged wrapping`).toEqual(initial.lines);
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

async function visibleArtworkBottom(logo: Locator) {
  return logo.evaluate((element) => {
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
        if (rgba[(y * canvas.width + x) * 4 + 3] > 8) {
          last = y;
          break;
        }
      }
    }

    if (last < 0) throw new Error("Full logo has no visible artwork");

    const bounds = image.getBoundingClientRect();
    const style = getComputedStyle(image);
    const contain = Math.min(bounds.width / canvas.width, bounds.height / canvas.height);
    const cover = Math.max(bounds.width / canvas.width, bounds.height / canvas.height);
    const scale =
      style.objectFit === "cover"
        ? cover
        : style.objectFit === "contain"
          ? contain
          : style.objectFit === "scale-down"
            ? Math.min(1, contain)
            : style.objectFit === "none"
              ? 1
              : bounds.height / canvas.height;
    const space = bounds.height - canvas.height * scale;
    const position = style.objectPosition.split(/\s+/)[1] ?? "50%";
    const offset = position.endsWith("%")
      ? (space * Number.parseFloat(position)) / 100
      : Number.parseFloat(position);
    let bottom = Math.min(bounds.bottom, bounds.top + offset + (last + 1) * scale);

    for (let ancestor = image.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(ancestor).overflowY)) {
        bottom = Math.min(bottom, ancestor.getBoundingClientRect().bottom);
      }
    }

    return bottom;
  });
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

async function expectPaintedCanvas(page: Page, theme: Theme) {
  const viewport = page.viewportSize()!;
  // One pixel at the bottom left of the empty canvas, outside the centered watermark.
  const png = await page.screenshot({
    clip: { x: 0, y: viewport.height - 1, width: 1, height: 1 },
  });

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

for (const system of ["light", "dark"] as const) {
  for (const sample of [
    { name: "missing choice", saved: null, unavailable: false, expected: system },
    {
      name: "saved choice overrides system",
      saved: opposite(system),
      unavailable: false,
      expected: opposite(system),
    },
    { name: "unavailable storage", saved: null, unavailable: true, expected: system },
  ]) {
    test(`${system} system: ${sample.name} paints the matching shell before hydration on first load and reload`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: system });
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
      test(`${theme} ${width}px ${visit}: client instruction, PNG and fonts preserve shell and text geometry`, async ({
        page,
      }) => {
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
          const response =
            visit === "first load"
              ? await page.goto("/", { waitUntil: "commit" })
              : await page.reload({ waitUntil: "commit" });

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

          const initialLayout = await instructionTextLayout(page);

          expectCompleteText(initialLayout);
          expectStable(initial, await shellBoxes(page, theme));
          expect(initialText[0].y + initialText[0].height).toBeLessThan(initialText[1].y);

          if (width === 320) {
            expect(initialLayout[1].lines.length).toBeGreaterThan(1);
          }

          pictures.release();
          for (const image of images(page, theme)) await expectDecoded(image);
          await frames(page);
          expectStable(initial, await shellBoxes(page, theme));
          expectInstructionStable(initialText, await instructionBoxes(page));
          expectTextWrapping(initialLayout, await instructionTextLayout(page));
          expect(await visibleArtworkBottom(images(page, theme)[2])).toBeLessThan(initialText[0].y);

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
          expectTextWrapping(initialLayout, await instructionTextLayout(page));

          await switchTheme(page, theme);
          await switchTheme(page, opposite(theme));
          await frames(page);
          await expectShell(page, theme);
          expectStable(initial, await shellBoxes(page, theme));
          expectInstructionStable(initialText, await instructionBoxes(page));
          expectTextWrapping(initialLayout, await instructionTextLayout(page));
          await expect(page.getByText(/restoring workspace|loading workspace/i)).toHaveCount(0);
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

test("theme control saves the choice, keeps it before hydration on reload, and has no tooltip", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expectShell(page, "dark");
  await themeButton(page, "dark").hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await switchTheme(page, "dark");

  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), themeKey))
    .toBe("light");

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

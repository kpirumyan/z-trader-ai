import { expect, test } from "@playwright/test";

const themeBackground = {
  "Светлая": "rgb(241, 243, 245)",
  "Тёмная": "rgb(16, 20, 24)",
} as const;

const terminalBackground = (page: import("@playwright/test").Page) =>
  page.locator(".terminal").evaluate((element) => getComputedStyle(element).backgroundColor);

const blockClientJavaScript = (page: import("@playwright/test").Page) =>
  page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/, (route) => route.abort());

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

for (const { selected, other, systemTheme } of [
  { selected: "Тёмная", other: "Светлая", systemTheme: "light" },
  { selected: "Светлая", other: "Тёмная", systemTheme: "dark" },
] as const) {
  test(`preserves the selected ${selected} theme over the opposite system preference`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: systemTheme });
    await page.goto("/");
    await expect(page.getByText("Настройки сохранены локально", { exact: true })).toBeVisible();

    const selectedButton = page.getByRole("button", { name: selected, exact: true });
    const otherButton = page.getByRole("button", { name: other, exact: true });
    await otherButton.click();
    await expect(otherButton).toHaveAttribute("aria-pressed", "true");
    const previousSettings = await page.evaluate(() => localStorage.getItem("z-trader-stitch-v1"));

    await selectedButton.click();
    await expect(selectedButton).toHaveAttribute("aria-pressed", "true");
    await expect(otherButton).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("z-trader-stitch-v1")))
      .not.toBe(previousSettings);

    await page.reload();
    await expect(page.getByText("Настройки сохранены локально", { exact: true })).toBeVisible();
    await expect(selectedButton).toHaveAttribute("aria-pressed", "true");
    await expect(otherButton).toHaveAttribute("aria-pressed", "false");
  });
}

for (const { selected, systemTheme } of [
  { selected: "Светлая", systemTheme: "dark" },
  { selected: "Тёмная", systemTheme: "light" },
] as const) {
  test(`${selected} theme is visible before hydration on reload and in a new tab`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: systemTheme });
    await page.goto("/");
    await page.getByRole("button", { name: selected, exact: true }).click();
    await expect.poll(() => terminalBackground(page)).toBe(themeBackground[selected]);

    await page.reload();
    await expect(page.getByRole("button", { name: selected, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => terminalBackground(page)).toBe(themeBackground[selected]);

    const newTab = await context.newPage();
    await newTab.emulateMedia({ colorScheme: systemTheme });
    await newTab.goto("/");
    await expect(newTab.getByRole("button", { name: selected, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => terminalBackground(newTab)).toBe(themeBackground[selected]);

    await blockClientJavaScript(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await terminalBackground(page)).toBe(themeBackground[selected]);

    await blockClientJavaScript(newTab);
    await newTab.reload({ waitUntil: "domcontentloaded" });
    expect(await terminalBackground(newTab)).toBe(themeBackground[selected]);
  });
}

for (const { systemTheme, expectedBackground } of [
  { systemTheme: "light", expectedBackground: themeBackground["Светлая"] },
  { systemTheme: "dark", expectedBackground: themeBackground["Тёмная"] },
] as const) {
  test(`uses the ${systemTheme} system theme without a saved choice`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: systemTheme });
    await page.goto("/");
    await expect.poll(() => terminalBackground(page)).toBe(expectedBackground);
  });
}

test("recovers from malformed saved settings and keeps the terminal usable", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("z-trader-stitch-v1", "{invalid-json");
  });
  await page.goto("/");

  await expect(
    page.getByText("Не удалось восстановить настройки; открыт макет", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Демонстрационные данные · UTC", { exact: true })).toBeVisible();
  const search = page.getByRole("textbox", { name: "Поиск инструмента" });
  await search.fill("ES");
  await expect(search).toHaveValue("ES");

  const light = page.getByRole("button", { name: "Светлая", exact: true });
  const dark = page.getByRole("button", { name: "Тёмная", exact: true });
  await light.click();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await dark.click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(light).toHaveAttribute("aria-pressed", "false");
});

test("reports unavailable storage while allowing theme changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage unavailable for this test");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable for this test");
    };
  });
  await page.goto("/");
  await expect.poll(() => terminalBackground(page)).toBe(themeBackground["Светлая"]);

  const warning = page.getByText("Настройки не сохраняются на этом устройстве", { exact: true });
  await expect(warning).toBeVisible();
  const light = page.getByRole("button", { name: "Светлая", exact: true });
  const dark = page.getByRole("button", { name: "Тёмная", exact: true });

  await light.click();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(dark).toHaveAttribute("aria-pressed", "false");
  await dark.click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(light).toHaveAttribute("aria-pressed", "false");
  await expect(warning).toBeVisible();

  await blockClientJavaScript(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await terminalBackground(page)).toBe(themeBackground["Светлая"]);
});

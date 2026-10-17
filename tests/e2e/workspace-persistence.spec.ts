import { expect, test } from "@playwright/test";

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
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable for this test");
    };
  });
  await page.goto("/");

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
});

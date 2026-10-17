import { expect, test, type Page } from "@playwright/test";

const clientScripts = /\/_next\/static\/.*\.js(?:\?.*)?$/;

async function visibleLayout(page: Page) {
  return page.locator(".chart-window").evaluateAll((windows) =>
    windows.map((window) => {
      const box = window.getBoundingClientRect();
      return {
        label: window.getAttribute("aria-label"),
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        zIndex: getComputedStyle(window).zIndex,
      };
    }),
  );
}

for (const { selectedTheme, otherTheme, systemTheme } of [
  { selectedTheme: "Тёмная", otherTheme: "Светлая", systemTheme: "light" },
  { selectedTheme: "Светлая", otherTheme: "Тёмная", systemTheme: "dark" },
] as const) {
  test(`does not flash the default workspace or wrong ${otherTheme} theme on reload`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: systemTheme });
    await page.goto("/");
    await expect(page.getByText("Настройки сохранены локально", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: selectedTheme, exact: true }).click();
    await expect(page.getByRole("button", { name: selectedTheme, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("button", { name: "Каскадом", exact: true }).click();
    const cascade = await visibleLayout(page);
    await page.getByRole("button", { name: "Рядом", exact: true }).click();
    const savedLayout = await visibleLayout(page);
    expect(savedLayout.length).toBeGreaterThan(0);
    expect(savedLayout).not.toEqual(cascade);

    await page.route(clientScripts, (route) => route.abort());
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("Загрузка рабочего места…", { exact: true })).toBeVisible();
    await expect(page.locator(".chart-window:visible")).toHaveCount(0);

    const selectedButton = page.getByRole("button", { name: selectedTheme, exact: true });
    const otherButton = page.getByRole("button", { name: otherTheme, exact: true });
    if (await selectedButton.isVisible()) {
      await expect(selectedButton).toHaveAttribute("aria-pressed", "true");
    }
    if (await otherButton.isVisible()) {
      await expect(otherButton).toHaveAttribute("aria-pressed", "false");
    }

    await page.unroute(clientScripts);
    for (let reload = 0; reload < 2; reload += 1) {
      await page.reload();
      await expect(page.getByText("Настройки сохранены локально", { exact: true })).toBeVisible();
      await expect(selectedButton).toHaveAttribute("aria-pressed", "true");
      await expect(otherButton).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => visibleLayout(page)).toEqual(savedLayout);
    }
  });
}

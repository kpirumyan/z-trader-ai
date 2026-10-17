import { expect, test } from "@playwright/test";

test("opens the demo terminal", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("banner").getByText("Z-Trader", { exact: false })).toBeVisible();
  await expect(page.getByText("Демонстрационные данные · UTC")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Поиск инструмента" })).toBeVisible();
});

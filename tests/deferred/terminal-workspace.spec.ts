import { expect, test, type Page } from "@playwright/test";

// Recovery actions belong to the fourth T1.5 item; see README.md.
const workspaceKey = "z-trader-workspace-v1";
const emptyTitle = "Your workspace is empty";
const emptyInstruction = "Use New to open a Chart, Level II, or T & S window.";
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

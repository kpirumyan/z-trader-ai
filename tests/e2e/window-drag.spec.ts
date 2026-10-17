import { expect, test } from "@playwright/test";

test("keeps dragging an inactive window after it gains focus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByText("Настройки сохранены локально")).toBeVisible();

  const foreground = page.locator('.chart-window[aria-label="ES · 15м"]');
  const window = page.locator('.chart-window[aria-label="ES · 1ч"]');
  const title = window.locator(".window-title");

  await expect(foreground).toHaveClass(/active/);
  await expect(window).not.toHaveClass(/active/);
  const initial = await window.boundingBox();
  expect(initial).not.toBeNull();
  if (!initial) throw new Error("The background window has no bounding box");

  // Start on the exposed part of the background title, away from its buttons.
  const startX = initial.x + initial.width - 180;
  const startY = initial.y + 16;
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest(".chart-window")
          ?.getAttribute("aria-label"),
      { x: startX, y: startY },
    ),
  ).toBe("ES · 1ч");

  await title.evaluate((element) => {
    element.addEventListener(
      "pointerdown",
      (event) =>
        element.setAttribute(
          "data-test-pointer-id",
          String((event as PointerEvent).pointerId),
        ),
      { once: true },
    );
  });

  const position = async () => {
    const box = await window.boundingBox();
    return box && [Math.round(box.x), Math.round(box.y)];
  };

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  try {
    await expect(window).toHaveClass(/active/);
    const pointerId = Number(await title.getAttribute("data-test-pointer-id"));
    expect(pointerId).toBeGreaterThan(0);
    await page.mouse.move(startX - 1, startY, { steps: 1 });
    await expect
      .poll(() => title.evaluate((element, id) => element.hasPointerCapture(id), pointerId))
      .toBe(true);

    // A single large move crosses the old title and the other chart windows.
    await page.mouse.move(startX - 400, startY + 200, { steps: 1 });
    await expect
      .poll(position)
      .toEqual([Math.round(initial.x - 400), Math.round(initial.y + 200)]);

    await page.mouse.move(startX - 340, startY + 220, { steps: 1 });
    await expect
      .poll(position)
      .toEqual([Math.round(initial.x - 340), Math.round(initial.y + 220)]);
  } finally {
    await page.mouse.up();
  }

  const finalPosition = [
    Math.round(initial.x - 340),
    Math.round(initial.y + 220),
  ];
  await page.mouse.move(startX, startY);
  await expect.poll(position).toEqual(finalPosition);
});

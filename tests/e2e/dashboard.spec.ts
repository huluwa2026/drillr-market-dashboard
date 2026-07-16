import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { installApiFixtures } from "./fixtures";

const visualRegressionStyle = fileURLToPath(new URL("./visual-regression.css", import.meta.url));

async function expectNoPanelOverlap(locator: Locator) {
  const overlaps = await locator.evaluateAll((elements) => {
    const boxes = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { name: element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const collisions: string[] = [];
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const horizontal = Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left);
        const vertical = Math.min(boxes[a].bottom, boxes[b].bottom) - Math.max(boxes[a].top, boxes[b].top);
        if (horizontal > 1 && vertical > 1) collisions.push(`${boxes[a].name} <> ${boxes[b].name}`);
      }
    }
    return collisions;
  });
  expect(overlaps).toEqual([]);
}

async function expectSingleDesktopScreen(page: Page) {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(overflow.width).toBeLessThanOrEqual(1);
  expect(overflow.height).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await installApiFixtures(page);
});

test("focus cockpit stays dense, interactive and collision-free at 1440×900", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/?ticker=AAPL&view=focus");
  await expect(page.locator(".focus-layout")).toBeVisible();
  await expect(page.locator(".watch-strip")).toBeHidden();
  await expect(page.locator(".visual-data-panel")).toHaveCount(7);
  await expectSingleDesktopScreen(page);
  await expectNoPanelOverlap(page.locator(".price-panel,.focus-signal-panel,.focus-market-panel,.focus-intelligence-grid > section"));

  const chart = page.locator(".intraday-chart svg");
  await chart.hover({ position: { x: 310, y: 110 } });
  await expect(page.locator(".chart-tooltip")).toBeVisible();
  await expect(page.locator(".chart-tooltip")).toContainText("开");
  await expect(page.locator(".chart-crosshair.active")).toBeVisible();

  expect(consoleErrors).toEqual([]);
  await expect(page).toHaveScreenshot("focus-1440x900.png", {
    animations: "disabled",
    fullPage: true,
    stylePath: visualRegressionStyle,
  });
});

test("radar keeps the whole watchlist visible at 1920×1080", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?ticker=AAPL&view=radar");
  await expect(page.locator(".radar-layout")).toBeVisible();
  await expect(page.locator(".radar-stock-list > button")).toHaveCount(2);
  await expectSingleDesktopScreen(page);
  await expectNoPanelOverlap(page.locator(".radar-watchlist,.radar-signal-panel,.radar-cross-panel,.radar-coverage-panel"));
  await expect(page).toHaveScreenshot("radar-1920x1080.png", {
    animations: "disabled",
    fullPage: true,
    stylePath: visualRegressionStyle,
  });
});

test("reduced-motion preference disables live dashboard animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?ticker=AAPL&view=focus");
  await expect(page.locator(".focus-layout")).toBeVisible();
  const animated = page.locator(".terminal-health .connected i");
  await expect(animated).toHaveCSS("animation-name", "none");
});

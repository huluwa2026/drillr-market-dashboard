import { chromium } from "@playwright/test";

const origin = process.env.DRILLR_PREVIEW_URL ?? "http://localhost:3000";
const url = new URL("/", origin);
url.searchParams.set("ticker", process.env.DRILLR_PREVIEW_TICKER ?? "AAPL");
url.searchParams.set("view", "focus");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  reducedMotion: "reduce",
});

const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

async function assertSingleScreen() {
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  if (overflow.width > 1 || overflow.height > 1) {
    throw new Error(`Desktop preview overflowed by ${overflow.width}×${overflow.height}px`);
  }
}

async function assertNoOverlap(selector) {
  const collisions = await page.locator(selector).evaluateAll((elements) => {
    const boxes = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { name: element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const found = [];
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const horizontal = Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left);
        const vertical = Math.min(boxes[a].bottom, boxes[b].bottom) - Math.max(boxes[a].top, boxes[b].top);
        if (horizontal > 1 && vertical > 1) found.push(`${boxes[a].name} <> ${boxes[b].name}`);
      }
    }
    return found;
  });
  if (collisions.length) throw new Error(`Overlapping dashboard panels: ${collisions.join(" | ")}`);
}

try {
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.locator(".focus-layout").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector(".price-panel .practical-panel-head em")?.textContent?.includes("1M→5M"),
    undefined,
    { timeout: 30_000 },
  );
  await page.locator(".intraday-chart .chart-candle").first().waitFor({ state: "attached" });
  await page.waitForTimeout(800);

  await assertSingleScreen();
  await assertNoOverlap(".price-panel,.focus-signal-panel,.focus-market-panel,.focus-intelligence-grid > section");

  await page.screenshot({
    path: "public/og-real.png",
    fullPage: false,
  });

  await page.getByRole("button", { name: "自选雷达" }).click();
  await page.locator(".radar-layout").waitFor({ state: "visible" });
  await assertSingleScreen();
  await assertNoOverlap(".radar-watchlist,.radar-signal-panel,.radar-cross-panel,.radar-coverage-panel");
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log(`Captured ${url.href} to public/og-real.png`);
} finally {
  await browser.close();
}

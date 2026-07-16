import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships a single-screen watchlist radar and stock focus cockpit", async () => {
  const [page, component, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/drillr-dashboard.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(page, /<DrillrDashboard \/>/);
  assert.match(component, /type ViewMode = "focus" \| "radar"/);
  assert.match(component, /单股聚焦/);
  assert.match(component, /自选雷达/);
  assert.match(component, /selectTicker/);
  assert.match(component, /syncUrl/);
  assert.match(component, /WATCHLIST RADAR/);
  assert.match(component, /WHAT CHANGED/);
  assert.match(component, /最新交易日 K 线/);
  assert.match(component, /14 METRICS/);
  assert.match(component, /高密度自选扫描器/);
  assert.equal((component.match(/<VisualDataPanel /g) ?? []).length, 7);
  for (const domain of ["VALUATION SPECTRUM", "ECONOMIC QUALITY", "GROWTH VECTOR", "BALANCE & PAYOUT", "RETURN SURFACE", "TREND POSITION", "EXPECTATION MAP"]) {
    assert.ok(component.includes(`eyebrow="${domain}"`));
  }
  assert.match(component, /aggregateCandles\(sourcePoints, usingMinute \? 5 : 1\)/);
  assert.match(component, /data-chart-type="candlestick"/);
  assert.match(component, /candle-wick/);
  assert.match(component, /onPointerMove=\{selectFromPointer\}/);
  assert.match(component, /chart-tooltip/);
  assert.match(component, /chart-scrubber/);
  assert.doesNotMatch(component, /Math\.random|mockSnapshot|fallbackSnapshot/);

  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /\.focus-layout\s*\{/);
  assert.match(css, /\.radar-layout\s*\{/);
  assert.match(css, /grid-template-rows:\s*96px 264px minmax\(0,1fr\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(16,minmax\(0,1fr\)\)/);
  assert.match(css, /market-terminal\[data-view="focus"\] \.watch-strip \{ display: none/);
  assert.match(css, /\.terminal-workspace \{ grid-row: 3; \}/);
  assert.match(css, /\.terminal-statusbar \{ grid-row: 4; \}/);
  assert.match(css, /return-heatmap/);
  assert.match(css, /metric-bar-chart/);
  assert.match(component, /balance-ratio-groups/);
  assert.match(css, /\.balance-ratio-groups \{[^}]*grid-template-rows:\s*62% 38%/s);
  assert.doesNotMatch(css, /\.balance-visual-body > div \{/);
  assert.match(css, /quoteUpdateFlash/);
  assert.match(css, /chart-crosshair/);
  assert.match(css, /@media\s*\(max-width:\s*1024px\)/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("refreshes live quotes, intraday bars, and signals through guarded server APIs", async () => {
  const [component, liveRoute, intradayRoute, signalsRoute, gateway, dashboardRoute, stocksRoute, protection, database] = await Promise.all([
    readFile(new URL("app/drillr-dashboard.tsx", root), "utf8"),
    readFile(new URL("app/api/live/route.ts", root), "utf8"),
    readFile(new URL("app/api/intraday/route.ts", root), "utf8"),
    readFile(new URL("app/api/signals/route.ts", root), "utf8"),
    readFile(new URL("app/api/gateway.ts", root), "utf8"),
    readFile(new URL("app/api/dashboard/route.ts", root), "utf8"),
    readFile(new URL("app/api/stocks/route.ts", root), "utf8"),
    readFile(new URL("app/api/protection.ts", root), "utf8"),
    readFile(new URL("db/index.ts", root), "utf8"),
  ]);

  assert.match(component, /fetch\("\/api\/live"/);
  assert.match(component, /fetch\("\/api\/signals"/);
  assert.match(component, /\/api\/intraday\?ticker=/);
  assert.match(component, /30_000/);
  assert.match(component, /60_000/);
  assert.match(component, /document\.visibilityState === "visible"/);
  assert.match(component, /quoteMoves/);
  assert.match(component, /data-live-phase=\{livePulse\}/);
  assert.match(component, /data-signal-phase=\{signalPulse\}/);
  assert.match(component, /data-chart-phase=\{chartPulse\}/);
  assert.match(component, /chart-candle \$\{direction\} \$\{index === points\.length - 1 \? "latest"/);

  assert.match(liveRoute, /\/api\/v1\/quotes\/batch/);
  assert.match(liveRoute, /sourceCadenceSeconds:\s*180/);
  assert.match(liveRoute, /FROM index_price/);
  assert.match(intradayRoute, /time_frame=1min/);
  assert.match(intradayRoute, /price_volume_intraday/);
  assert.match(signalsRoute, /\/api\/v1\/signals/);
  assert.doesNotMatch(signalsRoute, /signal_list/);

  assert.match(gateway, /process\.env\.DRILLR_API_KEY/);
  assert.match(gateway, /Authorization:/);
  assert.match(gateway, /Bearer/);
  assert.match(gateway, /cache:\s*"no-store"/);
  assert.match(gateway, /DRILLR_DAILY_REQUEST_LIMIT/);
  assert.match(gateway, /DRILLR_DAILY_\$\{scope\.toUpperCase\(\)\}_LIMIT/);
  assert.match(gateway, /reserveGatewayDailyRequest/);
  assert.match(gateway, /getGatewayCircuit/);
  assert.match(gateway, /recordGatewayFailure/);
  assert.match(protection, /enforcePublicRateLimit/);
  assert.match(protection, /PUBLIC_API_RATE_LIMIT_PER_MINUTE/);
  assert.match(protection, /incrementApiRateLimits/);
  assert.match(protection, /withSharedApiCache/);
  assert.match(protection, /replace\(\/\\n\|\\r\/g, ""\)/);
  assert.match(protection, /coalesceRequest/);
  assert.match(database, /@upstash\/redis/);
  assert.match(database, /UPSTASH_REDIS_REST_URL/);
  assert.match(database, /KV_REST_API_URL/);
  assert.match(database, /acquireRefreshLock/);
  assert.match(database, /releaseRefreshLock/);
  assert.match(database, /refresh-lock/);
  assert.match(database, /redis\.eval/);
  assert.match(database, /__drillrLocalStore__/);
  assert.doesNotMatch(database, /cloudflare:workers|D1Database/);
  for (const route of [liveRoute, intradayRoute, signalsRoute]) {
    assert.match(route, /enforcePublicRateLimit/);
    assert.match(route, /withSharedApiCache/);
    assert.doesNotMatch(route, /detail:/);
  }
  assert.match(dashboardRoute, /getDashboardCache/);
  assert.match(dashboardRoute, /putDashboardCache/);
  assert.match(dashboardRoute, /acquireRefreshLock/);
  assert.match(dashboardRoute, /roic_ttm/);
  assert.match(dashboardRoute, /price_return_10y/);
  assert.match(dashboardRoute, /latest_revenue_surprise/);
  assert.match(dashboardRoute, /dashboard-v7-dense/);
  assert.match(stocksRoute, /enforcePublicRateLimit\(request, "stocks", 6\)/);
});

test("keeps local secrets ignored and publishes bilingual product metadata", async () => {
  const [packageText, readme, chineseReadme, envExample, gitignore, layout, page, component, notice, deployment, ci, codeql] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("README.zh-CN.md", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
    readFile(new URL(".gitignore", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/drillr-dashboard.tsx", root), "utf8"),
    readFile(new URL("NOTICE.md", root), "utf8"),
    readFile(new URL("DEPLOYMENT.md", root), "utf8"),
    readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
    readFile(new URL(".github/workflows/codeql.yml", root), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.name, "drillr-market-dashboard");
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.scripts.dev, "next dev");
  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.typecheck, "tsc --noEmit");
  assert.equal(packageJson.dependencies["@upstash/redis"], "^1.38.0");
  assert.equal(packageJson.devDependencies?.vinext, undefined);
  assert.doesNotMatch(packageText, /cloudflare|wrangler|vinext/i);
  assert.match(readme, /DRILLR_API_KEY/);
  assert.match(envExample, /^DRILLR_API_KEY=/m);
  assert.match(envExample, /^TRUSTED_IDENTITY_MODE=disabled$/m);
  assert.match(envExample, /^DRILLR_DAILY_REQUEST_LIMIT=/m);
  assert.match(envExample, /^DRILLR_DAILY_LIVE_LIMIT=3000$/m);
  assert.match(envExample, /^PUBLIC_API_RATE_LIMIT_PER_MINUTE=20$/m);
  assert.match(envExample, /^PUBLIC_API_INTRADAY_RATE_LIMIT_PER_MINUTE=10$/m);
  assert.match(envExample, /^PUBLIC_API_STOCKS_RATE_LIMIT_PER_MINUTE=6$/m);
  assert.match(envExample, /^UPSTASH_REDIS_REST_URL=$/m);
  assert.match(envExample, /^UPSTASH_REDIS_REST_TOKEN=$/m);
  assert.match(envExample, /^KV_REST_API_URL=$/m);
  assert.match(envExample, /^KV_REST_API_TOKEN=$/m);
  assert.match(gitignore, /\.env\*/);
  assert.match(readme, /public\/og-en\.png/);
  assert.match(chineseReadme, /public\/og-zh\.png/);
  assert.match(readme, /actions\/workflows\/ci\.yml\/badge\.svg/);
  assert.match(chineseReadme, /actions\/workflows\/codeql\.yml\/badge\.svg/);
  assert.match(layout, /Real-time watchlist cockpit/);
  assert.match(layout, /"en-US"/);
  assert.match(layout, /"zh-CN"/);
  assert.match(page, /实时自选股驾驶舱/);
  assert.match(component, /drillr-locale/);
  assert.match(component, /data-locale=\{locale\}/);
  assert.match(notice, /market data/i);
  assert.match(deployment, /Vercel deployment/);
  assert.match(deployment, /Required Vercel Firewall rule/);
  assert.match(deployment, /HMAC mode/);
  assert.match(ci, /name: Production build/);
  assert.match(ci, /name: Browser and visual tests/);
  assert.match(codeql, /languages: javascript-typescript/);
  await access(new URL("LICENSE", root));
  await access(new URL("CODE_OF_CONDUCT.md", root));
  await access(new URL("SUPPORT.md", root));
  await access(new URL("public/og-real.png", root));
  await access(new URL("public/og-en.png", root));
  await access(new URL("public/og-zh.png", root));
});

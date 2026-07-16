import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("renders a desktop one-screen dashboard with tablet and mobile flow", async () => {
  const [page, component, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/drillr-dashboard.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(page, /<DrillrDashboard \/>/);
  assert.match(component, /fetch\("\/api\/dashboard"/);
  assert.match(component, /Drillr Gateway/);
  assert.match(component, /真实日线/);
  assert.match(component, /盘前 \/ 盘后 \/ 隔夜/);
  assert.match(component, /所有权动态/);
  assert.match(component, /data-admin-open=\{adminOpen/);
  assert.doesNotMatch(component, /fallbackSnapshot|SNAPSHOTS|EVIDENCE_EVENTS|MARKET_INDEX|SIGNAL_PIPELINES/);
  assert.doesNotMatch(component, /requestAnimationFrame|cancelAnimationFrame|--mark-delay|--tile-delay/);

  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /grid-template-rows/);
  assert.match(css, /@media\s*\(max-width:\s*1024px\)/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /grid-template-columns:\s*repeat\(2/);
  const keyframes = [...css.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)].map((match) => match[1]).sort();
  assert.deepEqual(keyframes, ["coverageFlip", "gatewayOrbit", "signalOrbit"]);
  const activeAnimations = [...css.matchAll(/animation:\s*([^;]+)/g)].map((match) => match[1]).filter((value) => !value.startsWith("none"));
  assert.equal(activeAnimations.length, 3);
  for (const animation of activeAnimations) assert.match(animation, /infinite/);
  assert.doesNotMatch(css, /\.radial-value\s*\{[^}]*animation:/);
  assert.doesNotMatch(css, /\.stock-tile\s*\{[^}]*animation:/);
  assert.doesNotMatch(css, /\.ownership-bubbles\s*>\s*div\s*>\s*i\s*\{[^}]*animation:/);
  assert.doesNotMatch(css, /transition(?:-[a-z-]+)?\s*:/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(component, /signal-sweep|tile-beam/);
  assert.match(css, /\.cockpit-header::after\s*\{\s*display:\s*none/);
  assert.match(css, /\.universe-title i\s*\{\s*display:\s*none/);
  assert.match(css, /\.core-panel::after\s*\{\s*display:\s*none/);
  assert.match(component, /data-admin-open=\{adminOpen/);
  assert.doesNotMatch(css, /backdrop-filter\s*:/);
});

test("keeps gateway credentials server-side and caches real payloads", async () => {
  const [route, db, layout] = await Promise.all([
    readFile(new URL("app/api/dashboard/route.ts", root), "utf8"),
    readFile(new URL("db/index.ts", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
  ]);

  assert.match(route, /process\.env\.DRILLR_API_KEY/);
  assert.match(route, /\/api\/v1\/data\/run_sql/);
  assert.match(route, /\/api\/v1\/data\/signal_list/);
  assert.match(route, /\/api\/v1\/data\/list_tables/);
  assert.match(route, /getDashboardCache/);
  assert.match(route, /putDashboardCache/);
  assert.match(route, /真实数据源暂时不可用/);
  assert.doesNotMatch(route, /mock|Math\.random|fallback/i);

  assert.match(db, /CREATE TABLE IF NOT EXISTS dashboard_cache/);
  assert.match(db, /ON CONFLICT\(cache_key\) DO UPDATE/);
  assert.match(layout, /og-real\.png/);
  await access(new URL("public/og-real.png", root));
});

test("ships with sanitized open-source project metadata", async () => {
  const [packageText, readme, envExample, gitignore, viteConfig] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
    readFile(new URL(".gitignore", root), "utf8"),
    readFile(new URL("vite.config.ts", root), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.name, "drillr-market-dashboard");
  assert.equal(packageJson.license, "MIT");
  assert.match(readme, /DRILLR_API_KEY/);
  assert.match(envExample, /^DRILLR_API_KEY=/m);
  assert.match(gitignore, /!\.env\.example/);
  assert.doesNotMatch(viteConfig, /\.openai\/hosting\.json|project_id/);
  await access(new URL("LICENSE", root));
});

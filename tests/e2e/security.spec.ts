import { expect, test } from "@playwright/test";
import { enforcePublicRateLimit } from "../../app/api/protection";
import { isSameOriginMutation, verifyIdentitySignature } from "../../app/auth-policy";
import { reserveGatewayDailyRequest } from "../../db";

async function sign(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("accepts only fresh identities signed by the trusted proxy", async () => {
  const secret = "test-only-secret-with-at-least-thirty-two-bytes";
  const nowMs = Date.UTC(2026, 6, 16, 9, 30, 0);
  const timestampValue = String(nowMs / 1000);
  const email = "Admin@Example.com";
  const encodedFullName = "Market%20Admin";
  const signatureValue = await sign(
    secret,
    `${timestampValue}\n${email.toLowerCase()}\n${encodedFullName}`,
  );

  await expect(verifyIdentitySignature({ email, encodedFullName, timestampValue, signatureValue, secret, nowMs })).resolves.toBe(true);
  await expect(verifyIdentitySignature({ email, encodedFullName, timestampValue, signatureValue, secret: `${secret}x`, nowMs })).resolves.toBe(false);
  await expect(verifyIdentitySignature({ email, encodedFullName, timestampValue, signatureValue, secret, nowMs: nowMs + 6 * 60_000 })).resolves.toBe(false);
});

test("rejects cross-site stock mutations", () => {
  expect(isSameOriginMutation(new Request("https://dashboard.example/api/stocks", { headers: { origin: "https://dashboard.example", "sec-fetch-site": "same-origin" } }))).toBe(true);
  expect(isSameOriginMutation(new Request("https://dashboard.example/api/stocks", { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }))).toBe(false);
});

test("enforces route-specific and global public API limits", async () => {
  const routeSubject = `198.51.100.${Date.now()}-${Math.random()}`;
  const routeRequest = new Request("https://dashboard.example/api/intraday", {
    headers: { "x-vercel-forwarded-for": routeSubject },
  });
  for (let count = 0; count < 10; count += 1) {
    await expect(enforcePublicRateLimit(routeRequest, "intraday", 10)).resolves.toBeNull();
  }
  const routeLimited = await enforcePublicRateLimit(routeRequest, "intraday", 10);
  expect(routeLimited?.status).toBe(429);
  expect(routeLimited?.headers.get("X-RateLimit-Scope")).toBe("intraday");

  const globalSubject = `203.0.113.${Date.now()}-${Math.random()}`;
  const globalRequest = new Request("https://dashboard.example/api/probe", {
    headers: { "x-vercel-forwarded-for": globalSubject },
  });
  for (let count = 0; count < 20; count += 1) {
    await expect(enforcePublicRateLimit(globalRequest, `probe-${count}`, 100)).resolves.toBeNull();
  }
  const globallyLimited = await enforcePublicRateLimit(globalRequest, "probe-final", 100);
  expect(globallyLimited?.status).toBe(429);
  expect(globallyLimited?.headers.get("X-RateLimit-Scope")).toBe("global");
});

test("reserves global and scoped gateway budgets atomically", async () => {
  const dayKey = `test-${Date.now()}-${Math.random()}`;
  await expect(reserveGatewayDailyRequest(dayKey, "live", 2, 1)).resolves.toMatchObject({
    allowed: true,
    totalUsed: 1,
    scopeUsed: 1,
  });
  await expect(reserveGatewayDailyRequest(dayKey, "live", 2, 1)).resolves.toMatchObject({
    allowed: false,
    totalUsed: 1,
    scopeUsed: 1,
  });
  await expect(reserveGatewayDailyRequest(dayKey, "signals", 2, 1)).resolves.toMatchObject({
    allowed: true,
    totalUsed: 2,
    scopeUsed: 1,
  });
  await expect(reserveGatewayDailyRequest(dayKey, "intraday", 2, 1)).resolves.toMatchObject({
    allowed: false,
    totalUsed: 2,
    scopeUsed: 0,
  });
});

test("local development storage persists watchlist mutations for the running server", async ({ request }, testInfo) => {
  const origin = new URL(testInfo.project.use.baseURL ?? "http://localhost:4173").origin;
  const initial = await request.get("/api/stocks");
  expect(initial.ok()).toBe(true);
  const initialStocks = (await initial.json() as { stocks: Array<{ ticker: string }> }).stocks;

  const added = await request.post("/api/stocks", {
    headers: { origin, "sec-fetch-site": "same-origin" },
    data: { ticker: "MSFT", name: "Microsoft" },
  });
  expect(added.status()).toBe(201);
  await expect.poll(async () => {
    const response = await request.get("/api/stocks");
    return (await response.json() as { stocks: Array<{ ticker: string }> }).stocks.some((stock) => stock.ticker === "MSFT");
  }).toBe(true);

  const removed = await request.delete("/api/stocks?ticker=MSFT", {
    headers: { origin, "sec-fetch-site": "same-origin" },
  });
  expect(removed.ok()).toBe(true);
  expect((await removed.json() as { stocks: Array<{ ticker: string }> }).stocks).toHaveLength(initialStocks.length);
});

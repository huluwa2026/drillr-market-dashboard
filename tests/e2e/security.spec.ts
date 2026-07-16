import { expect, test } from "@playwright/test";
import { isSameOriginMutation, verifyIdentitySignature } from "../../app/auth-policy";

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

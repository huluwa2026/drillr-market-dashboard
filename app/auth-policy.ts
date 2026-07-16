export async function verifyIdentitySignature({
  email,
  encodedFullName,
  timestampValue,
  signatureValue,
  secret,
  nowMs = Date.now(),
}: {
  email: string;
  encodedFullName: string;
  timestampValue: string | null;
  signatureValue: string | null;
  secret: string | undefined;
  nowMs?: number;
}) {
  const timestamp = Number(timestampValue);
  if (
    !secret ||
    secret.length < 32 ||
    !Number.isFinite(timestamp) ||
    Math.abs(nowMs - timestamp * 1000) > 5 * 60_000 ||
    !signatureValue ||
    !/^[a-f0-9]{64}$/i.test(signatureValue)
  ) {
    return false;
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = new Uint8Array(
    signatureValue.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  );
  const message = `${timestampValue}\n${email.trim().toLowerCase()}\n${encodedFullName}`;
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(message));
}

export function isSameOriginMutation(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

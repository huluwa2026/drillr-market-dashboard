import {
  getApiResponseCache,
  incrementApiRateLimit,
  putApiResponseCache,
} from "../../db";

type CachedResult<T> = {
  value: T;
  state: "fresh" | "refreshed" | "stale";
};

const inflight = new Map<string, Promise<unknown>>();

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clientAddress(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    (process.env.NODE_ENV === "production" ? "unknown" : "local")
  );
}

async function hmacSubject(value: string) {
  const secret = process.env.RATE_LIMIT_SALT ?? process.env.DRILLR_API_KEY ?? "drillr-local-rate-limit";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function enforcePublicRateLimit(
  request: Request,
  route: string,
  fallbackLimit: number,
) {
  const limit = positiveInteger(process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE, fallbackLimit);
  const now = Date.now();
  const windowMs = 60_000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const subject = await hmacSubject(clientAddress(request));
  const count = await incrementApiRateLimit(`${route}:${subject}`, windowStart);
  if (count <= limit) return null;

  const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
  return Response.json(
    { ok: false, error: "请求过于频繁，请稍后再试。" },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": String(retryAfter),
      },
    },
  );
}

export async function coalesceRequest<T>(key: string, loader: () => Promise<T>) {
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const next = loader();
  inflight.set(key, next);
  try {
    return await next;
  } finally {
    if (inflight.get(key) === next) inflight.delete(key);
  }
}

export async function withSharedApiCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  staleTtlMs = 5 * 60_000,
): Promise<CachedResult<T>> {
  const cached = await getApiResponseCache(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { value: JSON.parse(cached.payload) as T, state: "fresh" };
  }

  try {
    const value = await coalesceRequest(key, async () => {
      const refreshed = await loader();
      await putApiResponseCache(key, JSON.stringify(refreshed), Date.now() + ttlMs);
      return refreshed;
    });
    return { value, state: "refreshed" };
  } catch (error) {
    if (cached && now - cached.expiresAt <= staleTtlMs) {
      console.warn(`[drillr-api] serving stale cache for ${key}`, error);
      return { value: JSON.parse(cached.payload) as T, state: "stale" };
    }
    throw error;
  }
}

export function protectedJson<T extends object>(
  payload: T,
  cacheState: CachedResult<T>["state"],
) {
  return Response.json(
    cacheState === "stale" ? { ...payload, stale: true } : payload,
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Drillr-Cache": cacheState,
      },
    },
  );
}

export function serviceUnavailable(scope: string, publicMessage: string, error: unknown) {
  console.error(`[drillr-api] ${scope} unavailable`, error);
  return Response.json(
    { ok: false, error: publicMessage },
    {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

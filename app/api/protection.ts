import {
  acquireRefreshLock,
  getApiResponseCache,
  incrementApiRateLimits,
  putApiResponseCache,
  releaseRefreshLock,
} from "../../db";
import { sanitizeLogValue } from "../../lib/logging";

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
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() ??
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
  const globalLimit = positiveInteger(process.env.PUBLIC_API_RATE_LIMIT_PER_MINUTE, 20);
  const routeVariable = `PUBLIC_API_${route.toUpperCase().replaceAll("-", "_")}_RATE_LIMIT_PER_MINUTE`;
  const routeLimit = positiveInteger(process.env[routeVariable], fallbackLimit);
  const now = Date.now();
  const windowMs = 60_000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const subject = await hmacSubject(clientAddress(request));
  const { globalCount, routeCount } = await incrementApiRateLimits(
    `all:${subject}`,
    `${route}:${subject}`,
    windowStart,
  );
  if (globalCount <= globalLimit && routeCount <= routeLimit) return null;

  const retryAfter = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
  const limitedScope = globalCount > globalLimit ? "global" : route;
  return Response.json(
    { ok: false, error: "请求过于频繁，请稍后再试。" },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Scope": limitedScope,
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

  return coalesceRequest(`api-refresh:${key}`, async () => {
    const latest = await getApiResponseCache(key);
    const checkedAt = Date.now();
    if (latest && latest.expiresAt > checkedAt) {
      return { value: JSON.parse(latest.payload) as T, state: "fresh" };
    }

    const lockKey = `api:${key}`;
    const lockToken = await acquireRefreshLock(lockKey);
    if (!lockToken) {
      if (latest && checkedAt - latest.expiresAt <= staleTtlMs) {
        return { value: JSON.parse(latest.payload) as T, state: "stale" };
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const peerRefresh = await getApiResponseCache(key);
        if (peerRefresh && peerRefresh.expiresAt > Date.now()) {
          return { value: JSON.parse(peerRefresh.payload) as T, state: "fresh" };
        }
      }
      throw new Error(`Shared refresh already in progress for ${key}`);
    }

    try {
      const refreshed = await loader();
      await putApiResponseCache(key, JSON.stringify(refreshed), Date.now() + ttlMs);
      return { value: refreshed, state: "refreshed" };
    } catch (error) {
      if (latest && checkedAt - latest.expiresAt <= staleTtlMs) {
        console.warn(
          "[drillr-api] serving stale cache for %s: %s",
          sanitizeLogValue(key),
          sanitizeLogValue(error),
        );
        return { value: JSON.parse(latest.payload) as T, state: "stale" };
      }
      throw error;
    } finally {
      await releaseRefreshLock(lockKey, lockToken);
    }
  });
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
  console.error(
    "[drillr-api] %s unavailable: %s",
    sanitizeLogValue(scope),
    sanitizeLogValue(error),
  );
  return Response.json(
    { ok: false, error: publicMessage },
    {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

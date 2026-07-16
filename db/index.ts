import { Redis } from "@upstash/redis";
import { sanitizeLogValue } from "../lib/logging";

const DEFAULT_STOCKS = [
  { ticker: "NVDA", name: "英伟达", market: "NASDAQ", sortOrder: 10 },
  { ticker: "GOOGL", name: "谷歌", market: "NASDAQ", sortOrder: 20 },
  { ticker: "TSLA", name: "特斯拉", market: "NASDAQ", sortOrder: 30 },
  { ticker: "AAPL", name: "苹果", market: "NASDAQ", sortOrder: 40 },
] as const;

const KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? "drillr-market-dashboard:v1";
const WATCHLIST_KEY = `${KEY_PREFIX}:watchlist`;
const CIRCUIT_KEY = `${KEY_PREFIX}:gateway-circuit`;

export type DashboardStock = {
  ticker: string;
  name: string;
  market: string;
  sortOrder: number;
};

type DashboardCacheEntry = { payload: string; updatedAt: number };
type ApiCacheEntry = DashboardCacheEntry & { expiresAt: number };
type RateLimitEntry = { windowStart: number; requestCount: number; updatedAt: number };
type CircuitEntry = { consecutiveFailures: number; openUntil: number; updatedAt: number };
type LocalStore = {
  stocks: DashboardStock[];
  dashboardCache: Map<string, DashboardCacheEntry>;
  apiCache: Map<string, ApiCacheEntry>;
  rateLimits: Map<string, RateLimitEntry>;
  dailyUsage: Map<string, number>;
  circuit: CircuitEntry;
};

declare global {
  var __drillrLocalStore__: LocalStore | undefined;
}

let sharedRedis: Redis | null | undefined;

function key(scope: string, identifier: string) {
  return `${KEY_PREFIX}:${scope}:${identifier}`;
}

function redisClient() {
  if (sharedRedis !== undefined) return sharedRedis;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    sharedRedis = new Redis({ url, token });
    return sharedRedis;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Upstash Redis credentials are required in production (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)",
    );
  }
  sharedRedis = null;
  return sharedRedis;
}

function localStore() {
  globalThis.__drillrLocalStore__ ??= {
    stocks: DEFAULT_STOCKS.map((stock) => ({ ...stock })),
    dashboardCache: new Map(),
    apiCache: new Map(),
    rateLimits: new Map(),
    dailyUsage: new Map(),
    circuit: { consecutiveFailures: 0, openUntil: 0, updatedAt: 0 },
  };
  return globalThis.__drillrLocalStore__;
}

function sortStocks(stocks: DashboardStock[]) {
  return [...stocks].sort((a, b) => a.sortOrder - b.sortOrder || a.ticker.localeCompare(b.ticker));
}

async function redisStocks(redis: Redis) {
  const existing = await redis.get<DashboardStock[]>(WATCHLIST_KEY);
  if (existing?.length) return sortStocks(existing);
  await redis.set(WATCHLIST_KEY, DEFAULT_STOCKS, { nx: true });
  return sortStocks((await redis.get<DashboardStock[]>(WATCHLIST_KEY)) ?? DEFAULT_STOCKS.map((stock) => ({ ...stock })));
}

export async function ensureDashboardSchema() {
  const redis = redisClient();
  if (redis) await redisStocks(redis);
  else localStore();
}

export async function listDashboardStocks(): Promise<DashboardStock[]> {
  const redis = redisClient();
  if (redis) return redisStocks(redis);
  return sortStocks(localStore().stocks).map((stock) => ({ ...stock }));
}

export async function upsertDashboardStock(ticker: string, name: string) {
  const redis = redisClient();
  const stocks = redis ? await redisStocks(redis) : localStore().stocks;
  const existing = stocks.find((stock) => stock.ticker === ticker);
  if (!existing && stocks.length >= 6) throw new Error("At most six stocks are allowed");

  const next = existing
    ? stocks.map((stock) => stock.ticker === ticker ? { ...stock, name } : stock)
    : [...stocks, { ticker, name, market: "NASDAQ", sortOrder: Math.max(0, ...stocks.map((stock) => stock.sortOrder)) + 10 }];
  const sorted = sortStocks(next);
  if (redis) await redis.set(WATCHLIST_KEY, sorted);
  else localStore().stocks = sorted;
  return sorted;
}

export async function deleteDashboardStock(ticker: string) {
  const redis = redisClient();
  const stocks = redis ? await redisStocks(redis) : localStore().stocks;
  if (stocks.length <= 1) throw new Error("At least one stock is required");
  const next = stocks.filter((stock) => stock.ticker !== ticker);
  if (redis) await redis.set(WATCHLIST_KEY, next);
  else localStore().stocks = next;
  return sortStocks(next);
}

export async function getDashboardCache(cacheKey: string) {
  const redis = redisClient();
  if (redis) return redis.get<DashboardCacheEntry>(key("dashboard-cache", cacheKey));
  return localStore().dashboardCache.get(cacheKey) ?? null;
}

export async function putDashboardCache(cacheKey: string, payload: string) {
  const entry = { payload, updatedAt: Date.now() };
  const redis = redisClient();
  if (redis) await redis.set(key("dashboard-cache", cacheKey), entry, { ex: 7 * 24 * 60 * 60 });
  else localStore().dashboardCache.set(cacheKey, entry);
}

export async function getApiResponseCache(cacheKey: string) {
  const redis = redisClient();
  if (redis) return redis.get<ApiCacheEntry>(key("api-cache", cacheKey));
  const entry = localStore().apiCache.get(cacheKey);
  if (!entry || Date.now() - entry.expiresAt > 24 * 60 * 60 * 1000) {
    localStore().apiCache.delete(cacheKey);
    return null;
  }
  return entry;
}

export async function putApiResponseCache(cacheKey: string, payload: string, expiresAt: number) {
  const now = Date.now();
  const entry = { payload, updatedAt: now, expiresAt };
  const redis = redisClient();
  if (redis) await redis.set(key("api-cache", cacheKey), entry, { px: Math.max(1, expiresAt - now + 24 * 60 * 60 * 1000) });
  else localStore().apiCache.set(cacheKey, entry);
}

export async function acquireRefreshLock(cacheKey: string, ttlMs = 30_000) {
  const redis = redisClient();
  if (redis) {
    const token = crypto.randomUUID();
    const acquired = await redis.set(key("refresh-lock", cacheKey), token, {
      nx: true,
      px: ttlMs,
    });
    return acquired === "OK" ? token : null;
  }
  return "local";
}

export async function releaseRefreshLock(cacheKey: string, token: string) {
  const redis = redisClient();
  if (!redis || token === "local") return;
  try {
    await redis.eval<string[], number>(
      `if redis.call("GET", KEYS[1]) == ARGV[1] then
         return redis.call("DEL", KEYS[1])
       end
       return 0`,
      [key("refresh-lock", cacheKey)],
      [token],
    );
  } catch (error) {
    // The token-checked lock expires automatically; a failed cleanup must not
    // discard an otherwise successful market-data refresh.
    console.warn(
      "[drillr-cache] refresh lock cleanup failed for %s: %s",
      sanitizeLogValue(cacheKey),
      sanitizeLogValue(error),
    );
  }
}

export async function incrementApiRateLimits(
  globalBucketKey: string,
  routeBucketKey: string,
  windowStart: number,
) {
  const redis = redisClient();
  if (redis) {
    const [globalCount, routeCount] = await redis.eval<[], [number, number]>(
      `local global_count = redis.call("INCR", KEYS[1])
       if global_count == 1 then redis.call("EXPIRE", KEYS[1], 120) end
       local route_count = redis.call("INCR", KEYS[2])
       if route_count == 1 then redis.call("EXPIRE", KEYS[2], 120) end
       return {global_count, route_count}`,
      [
        key("rate", `${globalBucketKey}:${windowStart}`),
        key("rate", `${routeBucketKey}:${windowStart}`),
      ],
      [],
    );
    return { globalCount: Number(globalCount), routeCount: Number(routeCount) };
  }

  const store = localStore();
  const now = Date.now();
  const increment = (bucketKey: string) => {
    const existing = store.rateLimits.get(bucketKey);
    const entry = existing?.windowStart === windowStart
      ? { windowStart, requestCount: existing.requestCount + 1, updatedAt: now }
      : { windowStart, requestCount: 1, updatedAt: now };
    store.rateLimits.set(bucketKey, entry);
    return entry.requestCount;
  };
  const globalCount = increment(globalBucketKey);
  const routeCount = increment(routeBucketKey);
  for (const [entryKey, value] of store.rateLimits) {
    if (value.updatedAt < now - 24 * 60 * 60 * 1000) store.rateLimits.delete(entryKey);
  }
  return { globalCount, routeCount };
}

export async function reserveGatewayDailyRequest(
  dayKey: string,
  scope: string,
  totalLimit: number,
  scopeLimit: number,
) {
  const redis = redisClient();
  if (redis) {
    const [allowed, totalUsed, scopeUsed] = await redis.eval<string[], [number, number, number]>(
      `local total = tonumber(redis.call("GET", KEYS[1]) or "0")
       local scoped = tonumber(redis.call("GET", KEYS[2]) or "0")
       if total >= tonumber(ARGV[1]) or scoped >= tonumber(ARGV[2]) then
         return {0, total, scoped}
       end
       total = redis.call("INCR", KEYS[1])
       scoped = redis.call("INCR", KEYS[2])
       if total == 1 then redis.call("EXPIRE", KEYS[1], 259200) end
       if scoped == 1 then redis.call("EXPIRE", KEYS[2], 259200) end
       return {1, total, scoped}`,
      [
        key("gateway-usage", dayKey),
        key("gateway-usage", `${dayKey}:${scope}`),
      ],
      [String(totalLimit), String(scopeLimit)],
    );
    return {
      allowed: Number(allowed) === 1,
      totalUsed: Number(totalUsed),
      scopeUsed: Number(scopeUsed),
    };
  }
  const store = localStore();
  const totalUsed = store.dailyUsage.get(dayKey) ?? 0;
  const scopeKey = `${dayKey}:${scope}`;
  const scopeUsed = store.dailyUsage.get(scopeKey) ?? 0;
  if (totalUsed >= totalLimit || scopeUsed >= scopeLimit) {
    return { allowed: false, totalUsed, scopeUsed };
  }
  store.dailyUsage.set(dayKey, totalUsed + 1);
  store.dailyUsage.set(scopeKey, scopeUsed + 1);
  return { allowed: true, totalUsed: totalUsed + 1, scopeUsed: scopeUsed + 1 };
}

export async function getGatewayCircuit() {
  const redis = redisClient();
  if (redis) {
    const entry = await redis.hgetall<Record<string, number | string>>(CIRCUIT_KEY);
    if (!entry || Object.keys(entry).length === 0) return null;
    return {
      consecutiveFailures: Number(entry.consecutiveFailures ?? 0),
      openUntil: Number(entry.openUntil ?? 0),
    };
  }
  const { consecutiveFailures, openUntil } = localStore().circuit;
  return { consecutiveFailures, openUntil };
}

export async function recordGatewaySuccess() {
  const entry = { consecutiveFailures: 0, openUntil: 0, updatedAt: Date.now() };
  const redis = redisClient();
  if (redis) await redis.hset(CIRCUIT_KEY, entry);
  else localStore().circuit = entry;
}

export async function recordGatewayFailure(failureThreshold: number, cooldownMs: number) {
  const now = Date.now();
  const redis = redisClient();
  if (redis) {
    const consecutiveFailures = await redis.hincrby(CIRCUIT_KEY, "consecutiveFailures", 1);
    const current = await redis.hget<number>(CIRCUIT_KEY, "openUntil") ?? 0;
    const openUntil = consecutiveFailures >= failureThreshold ? now + cooldownMs : Number(current);
    await redis.hset(CIRCUIT_KEY, { openUntil, updatedAt: now });
    return { consecutiveFailures, openUntil };
  }

  const previous = localStore().circuit;
  const consecutiveFailures = previous.consecutiveFailures + 1;
  const openUntil = consecutiveFailures >= failureThreshold ? now + cooldownMs : previous.openUntil;
  localStore().circuit = { consecutiveFailures, openUntil, updatedAt: now };
  return { consecutiveFailures, openUntil };
}

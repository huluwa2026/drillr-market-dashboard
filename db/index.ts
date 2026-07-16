import { env } from "cloudflare:workers";

const CREATE_STOCKS_TABLE = `
  CREATE TABLE IF NOT EXISTS dashboard_stocks (
    ticker TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    market TEXT NOT NULL DEFAULT 'NASDAQ',
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_SORT_INDEX = `
  CREATE INDEX IF NOT EXISTS dashboard_stocks_sort_idx
  ON dashboard_stocks (sort_order, ticker)
`;

const CREATE_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS dashboard_cache (
    cache_key TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const CREATE_CACHE_INDEX = `
  CREATE INDEX IF NOT EXISTS dashboard_cache_updated_idx
  ON dashboard_cache (updated_at)
`;

const CREATE_API_RESPONSE_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS api_response_cache (
    cache_key TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )
`;

const CREATE_API_RESPONSE_CACHE_INDEX = `
  CREATE INDEX IF NOT EXISTS api_response_cache_expiry_idx
  ON api_response_cache (expires_at)
`;

const CREATE_API_RATE_LIMIT_TABLE = `
  CREATE TABLE IF NOT EXISTS api_rate_limits (
    bucket_key TEXT PRIMARY KEY NOT NULL,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const CREATE_GATEWAY_USAGE_TABLE = `
  CREATE TABLE IF NOT EXISTS gateway_daily_usage (
    day_key TEXT PRIMARY KEY NOT NULL,
    request_count INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const CREATE_GATEWAY_CIRCUIT_TABLE = `
  CREATE TABLE IF NOT EXISTS gateway_circuit (
    state_key TEXT PRIMARY KEY NOT NULL,
    consecutive_failures INTEGER NOT NULL,
    open_until INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const DEFAULT_STOCKS = [
  ["NVDA", "英伟达", "NASDAQ", 10],
  ["GOOGL", "谷歌", "NASDAQ", 20],
  ["TSLA", "特斯拉", "NASDAQ", 30],
  ["AAPL", "苹果", "NASDAQ", 40],
] as const;

export type DashboardStock = {
  ticker: string;
  name: string;
  market: string;
  sortOrder: number;
};

function getD1() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function ensureDashboardSchema() {
  const db = getD1();
  await db.batch([
    db.prepare(CREATE_STOCKS_TABLE),
    db.prepare(CREATE_SORT_INDEX),
    db.prepare(CREATE_CACHE_TABLE),
    db.prepare(CREATE_CACHE_INDEX),
    db.prepare(CREATE_API_RESPONSE_CACHE_TABLE),
    db.prepare(CREATE_API_RESPONSE_CACHE_INDEX),
    db.prepare(CREATE_API_RATE_LIMIT_TABLE),
    db.prepare(CREATE_GATEWAY_USAGE_TABLE),
    db.prepare(CREATE_GATEWAY_CIRCUIT_TABLE),
  ]);
  await db.batch(
    DEFAULT_STOCKS.map(([ticker, name, market, sortOrder]) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO dashboard_stocks (ticker, name, market, sort_order) VALUES (?, ?, ?, ?)",
        )
        .bind(ticker, name, market, sortOrder),
    ),
  );
}

export async function listDashboardStocks(): Promise<DashboardStock[]> {
  await ensureDashboardSchema();
  const result = await getD1()
    .prepare(
      "SELECT ticker, name, market, sort_order AS sortOrder FROM dashboard_stocks ORDER BY sort_order ASC, ticker ASC",
    )
    .all<DashboardStock>();
  return result.results;
}

export async function upsertDashboardStock(ticker: string, name: string) {
  await ensureDashboardSchema();
  const existing = await getD1()
    .prepare("SELECT ticker FROM dashboard_stocks WHERE ticker = ?")
    .bind(ticker)
    .first<{ ticker: string }>();
  const count = await getD1()
    .prepare("SELECT COUNT(*) AS value FROM dashboard_stocks")
    .first<{ value: number }>();
  if (!existing && (count?.value ?? 0) >= 6) {
    throw new Error("At most six stocks are allowed");
  }
  const max = await getD1()
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM dashboard_stocks")
    .first<{ value: number }>();
  await getD1()
    .prepare(
      `INSERT INTO dashboard_stocks (ticker, name, market, sort_order)
       VALUES (?, ?, 'NASDAQ', ?)
       ON CONFLICT(ticker) DO UPDATE SET name = excluded.name, updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(ticker, name, (max?.value ?? 0) + 10)
    .run();
  return listDashboardStocks();
}

export async function deleteDashboardStock(ticker: string) {
  await ensureDashboardSchema();
  const count = await getD1()
    .prepare("SELECT COUNT(*) AS value FROM dashboard_stocks")
    .first<{ value: number }>();
  if ((count?.value ?? 0) <= 1) throw new Error("At least one stock is required");
  await getD1().prepare("DELETE FROM dashboard_stocks WHERE ticker = ?").bind(ticker).run();
  return listDashboardStocks();
}

export async function getDashboardCache(cacheKey: string) {
  await ensureDashboardSchema();
  return getD1()
    .prepare(
      "SELECT payload, updated_at AS updatedAt FROM dashboard_cache WHERE cache_key = ?",
    )
    .bind(cacheKey)
    .first<{ payload: string; updatedAt: number }>();
}

export async function putDashboardCache(cacheKey: string, payload: string) {
  await ensureDashboardSchema();
  await getD1()
    .prepare(
      `INSERT INTO dashboard_cache (cache_key, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE
       SET payload = excluded.payload, updated_at = excluded.updated_at`,
    )
    .bind(cacheKey, payload, Date.now())
    .run();
  await getD1()
    .prepare("DELETE FROM dashboard_cache WHERE updated_at < ?")
    .bind(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .run();
}

export async function getApiResponseCache(cacheKey: string) {
  await ensureDashboardSchema();
  return getD1()
    .prepare(
      "SELECT payload, updated_at AS updatedAt, expires_at AS expiresAt FROM api_response_cache WHERE cache_key = ?",
    )
    .bind(cacheKey)
    .first<{ payload: string; updatedAt: number; expiresAt: number }>();
}

export async function putApiResponseCache(
  cacheKey: string,
  payload: string,
  expiresAt: number,
) {
  await ensureDashboardSchema();
  const now = Date.now();
  await getD1()
    .prepare(
      `INSERT INTO api_response_cache (cache_key, payload, updated_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE
       SET payload = excluded.payload,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`,
    )
    .bind(cacheKey, payload, now, expiresAt)
    .run();
  await getD1()
    .prepare("DELETE FROM api_response_cache WHERE expires_at < ?")
    .bind(now - 24 * 60 * 60 * 1000)
    .run();
}

export async function incrementApiRateLimit(
  bucketKey: string,
  windowStart: number,
) {
  await ensureDashboardSchema();
  const now = Date.now();
  const result = await getD1()
    .prepare(
      `INSERT INTO api_rate_limits (bucket_key, window_start, request_count, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET
         window_start = excluded.window_start,
         request_count = CASE
           WHEN api_rate_limits.window_start = excluded.window_start
           THEN api_rate_limits.request_count + 1
           ELSE 1
         END,
         updated_at = excluded.updated_at
       RETURNING request_count AS requestCount`,
    )
    .bind(bucketKey, windowStart, now)
    .first<{ requestCount: number }>();
  await getD1()
    .prepare("DELETE FROM api_rate_limits WHERE updated_at < ?")
    .bind(now - 24 * 60 * 60 * 1000)
    .run();
  return result?.requestCount ?? 1;
}

export async function takeGatewayDailyRequest(dayKey: string) {
  await ensureDashboardSchema();
  const result = await getD1()
    .prepare(
      `INSERT INTO gateway_daily_usage (day_key, request_count, updated_at)
       VALUES (?, 1, ?)
       ON CONFLICT(day_key) DO UPDATE SET
         request_count = gateway_daily_usage.request_count + 1,
         updated_at = excluded.updated_at
       RETURNING request_count AS requestCount`,
    )
    .bind(dayKey, Date.now())
    .first<{ requestCount: number }>();
  return result?.requestCount ?? 1;
}

export async function getGatewayCircuit() {
  await ensureDashboardSchema();
  return getD1()
    .prepare(
      "SELECT consecutive_failures AS consecutiveFailures, open_until AS openUntil FROM gateway_circuit WHERE state_key = 'drillr'",
    )
    .first<{ consecutiveFailures: number; openUntil: number }>();
}

export async function recordGatewaySuccess() {
  await ensureDashboardSchema();
  await getD1()
    .prepare(
      `INSERT INTO gateway_circuit (state_key, consecutive_failures, open_until, updated_at)
       VALUES ('drillr', 0, 0, ?)
       ON CONFLICT(state_key) DO UPDATE SET
         consecutive_failures = 0,
         open_until = 0,
         updated_at = excluded.updated_at`,
    )
    .bind(Date.now())
    .run();
}

export async function recordGatewayFailure(
  failureThreshold: number,
  cooldownMs: number,
) {
  await ensureDashboardSchema();
  const now = Date.now();
  return getD1()
    .prepare(
      `INSERT INTO gateway_circuit (state_key, consecutive_failures, open_until, updated_at)
       VALUES ('drillr', 1, CASE WHEN ? <= 1 THEN ? ELSE 0 END, ?)
       ON CONFLICT(state_key) DO UPDATE SET
         consecutive_failures = gateway_circuit.consecutive_failures + 1,
         open_until = CASE
           WHEN gateway_circuit.consecutive_failures + 1 >= ? THEN ?
           ELSE gateway_circuit.open_until
         END,
         updated_at = excluded.updated_at
       RETURNING consecutive_failures AS consecutiveFailures, open_until AS openUntil`,
    )
    .bind(failureThreshold, now + cooldownMs, now, failureThreshold, now + cooldownMs)
    .first<{ consecutiveFailures: number; openUntil: number }>();
}

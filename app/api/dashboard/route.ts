import {
  getDashboardCache,
  listDashboardStocks,
  putDashboardCache,
} from "../../../db";
import type {
  AltCategory,
  AnalystConsensus,
  DashboardPayload,
  EarningsEvent,
  ExtendedQuote,
  HistoryBar,
  MarketIndex,
  OwnershipEvent,
  SchemaGroup,
  SignalEvent,
  Snapshot,
} from "../../dashboard-types";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30 * 60 * 1000;
const PARTIAL_CACHE_TTL_MS = 2 * 60 * 1000;
const ALT_LABELS: Record<string, string> = {
  "Energy & Power": "能源与电力",
  "Data Centers": "数据中心",
  Semiconductors: "半导体",
  "Compute Pricing": "算力价格",
  "Model Development": "模型发展",
  "Inference Economics": "推理经济",
  "Macro & Trade": "宏观与贸易",
  "Prediction Markets": "预测市场",
  "Critical Minerals": "关键矿产",
};

type SqlEnvelope = {
  data?: { columns?: string[]; rows?: unknown[][]; rowCount?: number };
  error?: { code?: string; message?: string };
};

type CatalogEnvelope = {
  data?: Array<{
    category: string;
    tables: Array<{ name: string; summary: string; columns: string[] }>;
  }>;
};

type SchemaEnvelope = {
  data?: { columns?: Array<{ column_name: string }> };
};

type SignalEnvelope = {
  data?: {
    items?: Array<{
      id: number;
      headline: string;
      summary: string | null;
      suggested_tickers?: string[];
      score?: number;
      trigger_sources?: Array<{ source_name?: string }>;
      earliest_trigger_event_time?: string;
      created_at?: string;
      tags?: { event_types?: string[] };
    }>;
  };
};

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function mapRows<T>(envelope: SqlEnvelope): T[] {
  const columns = envelope.data?.columns ?? [];
  const rows = envelope.data?.rows ?? [];
  return rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]])),
  ) as T[];
}

function parsePayloadRows<T>(envelope: SqlEnvelope, kind: string): T[] {
  return mapRows<{ kind: string; payload: string }>(envelope)
    .filter((row) => row.kind === kind)
    .map((row) => JSON.parse(row.payload) as T);
}

async function gatewayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.DRILLR_API_KEY;
  const baseUrl = (process.env.DRILLR_GATEWAY_URL ?? "https://gateway.drillr.ai").replace(/\/$/, "");
  if (!apiKey) throw new Error("DRILLR_API_KEY is not configured");

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const payload = (await response.json()) as T & { error?: { message?: string } | string };
  if (!response.ok) {
    const detail = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(detail || `Drillr Gateway returned ${response.status}`);
  }
  return payload;
}

async function runSql(sql: string) {
  const envelope = await gatewayJson<SqlEnvelope>("/api/v1/data/run_sql", {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
  if (!envelope.data?.rows) throw new Error(envelope.error?.message || "run_sql returned no rows");
  return envelope;
}

function buildSchemaGroups(columns: string[]): SchemaGroup[] {
  const definitions: Array<[string, RegExp]> = [
    ["公司身份", /^(ticker|company_|cik|industry|sector|country|exchange|trading_|ipo_|full_time_|website|ceo|isin|cusip|is_)/],
    ["估值矩阵", /^(price_current|market_capitalization|pe_|peg_|pb_|ps_|pcf_|enterprise_value|ev_)/],
    ["盈利质量", /(margin|roe_|roa_|roic_|asset_turnover|income_per_employee)/],
    ["成长序列", /(growth|cagr)/],
    ["现金与杠杆", /(cash_|debt_|interest_|current_ratio|quick_ratio|working_capital|liabilities|fcf_to_debt)/],
    ["股东回报", /^(dividend|payout|fcf_payout)/],
    ["价格与技术", /^(price_return|sma_|price_vs_sma|rsi_)/],
    ["知识与治理", /^(wiki_|business_info|transcript_count|accounting_standard|market$)/],
    ["盈利预期", /(eps_|revenue_|next_q_|surprise|beats|misses|inline)/],
  ];
  const assigned = new Set<string>();
  const groups = definitions.map(([label, matcher]) => {
    const fields = columns.filter((column) => !assigned.has(column) && matcher.test(column));
    fields.forEach((field) => assigned.add(field));
    return { label, count: fields.length, fields: fields.slice(0, 5) };
  });
  const other = columns.filter((column) => !assigned.has(column));
  if (other.length) groups.push({ label: "其他基础字段", count: other.length, fields: other.slice(0, 5) });
  return groups.filter((group) => group.count > 0);
}

function latest(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

async function fetchDashboard(): Promise<DashboardPayload> {
  const stockOptions = await listDashboardStocks();
  const tickers = stockOptions.map((stock) => stock.ticker);
  const tickerSql = tickers.map(sqlLiteral).join(",");
  const tickerCsv = encodeURIComponent(tickers.join(","));
  const pointsPerStock = Math.min(18, Math.max(12, Math.floor(96 / tickers.length)));
  const today = new Date().toISOString().slice(0, 10);
  const twoYearsAgo = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;

  const manifestSql = `
    SELECT kind, payload FROM (
      SELECT 1 AS ord, 'snapshot' AS kind, to_jsonb(s)::text AS payload FROM (
        SELECT ticker, company_name, sector, exchange, price_current, market_capitalization,
               pe_ratio_ttm, pe_ratio_fwd, gross_profit_margin_ttm, net_income_margin_ttm,
               revenue_growth_ttm, eps_growth_fwd, price_return_1d, price_return_5d,
               price_return_1m, price_return_3m, price_return_ytd, price_return_1y,
               rsi_14_day, sma_signal_50d, latest_eps_surprise, next_q_eps_estimate_avg
        FROM company_snapshot WHERE ticker IN (${tickerSql})
      ) s
      UNION ALL
      SELECT 2, 'analyst', to_jsonb(a)::text FROM (
        SELECT ticker, snapshot_date, total_analysts, consensus, pt_consensus, pt_high, pt_low,
               strong_buy_count, buy_count, hold_count, sell_count, strong_sell_count
        FROM analyst_ratings_consensus WHERE ticker IN (${tickerSql})
      ) a
      UNION ALL
      SELECT 3, 'extended', to_jsonb(x)::text FROM (
        SELECT ticker, pre_price, pre_change_rate, pre_volume, after_price, after_change_rate,
               after_volume, overnight_price, overnight_change_rate, overnight_volume, extended_updated_at
        FROM equity_extended_rt WHERE ticker IN (${tickerSql})
      ) x
      UNION ALL
      SELECT 4, 'index', to_jsonb(i)::text FROM (
        SELECT index_ticker, name, price, change, change_pct, volume, day_low, day_high,
               year_low, year_high, open, previous_close, last_updated FROM index_price
      ) i
    ) unified ORDER BY ord LIMIT 100`;

  const historySql = `
    SELECT ticker, period_end, open, high, low, close, volume FROM (
      SELECT ticker, period_end, open, high, low, close, volume,
             ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY period_end DESC) AS rn
      FROM price_volume_history
      WHERE ticker IN (${tickerSql}) AND time_frame = 'daily'
    ) ranked WHERE rn <= ${pointsPerStock}
    ORDER BY ticker, period_end DESC LIMIT 100`;

  const eventsSql = `
    SELECT kind, payload FROM (
      SELECT 1 AS ord, 'earnings' AS kind, to_jsonb(e)::text AS payload FROM (
        SELECT ticker, date, eps_estimated, eps_actual, revenue_estimated, revenue_actual, last_updated
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
          FROM earning_call_calendar
          WHERE ticker IN (${tickerSql}) AND date >= '${twoYearsAgo}'
        ) ranked WHERE rn <= 2
      ) e
      UNION ALL
      SELECT 2, 'ownership', to_jsonb(o)::text FROM (
        SELECT ticker, date, filing_date, source, activity_type, filing_type,
               filer_name, filer_title, shares, price_per_share, market_value
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY filing_date DESC NULLS LAST) AS rn
          FROM insider_and_institution_activities
          WHERE ticker IN (${tickerSql}) AND source IN ('insider','institution')
            AND filing_date >= '${twoYearsAgo}' AND filing_date <= '${today}'
        ) ranked WHERE rn <= 2
      ) o
    ) unified ORDER BY ord LIMIT 100`;

  const firstCatalog = encodeURIComponent(
    "Energy & Power,Data Centers,Semiconductors,Compute Pricing,Model Development",
  );
  const secondCatalog = encodeURIComponent(
    "Inference Economics,Macro & Trade,Prediction Markets,Critical Minerals",
  );

  const [manifest, historyEnvelope, events, signalsEnvelope, catalogA, catalogB, schemaEnvelope] =
    await Promise.all([
      runSql(manifestSql),
      runSql(historySql),
      runSql(eventsSql).catch(() => null),
      gatewayJson<SignalEnvelope>(
        `/api/v1/data/signal_list?tickers=${tickerCsv}&order_by=created_at&limit=20`,
      ),
      gatewayJson<CatalogEnvelope>(`/api/v1/data/list_tables?categories=${firstCatalog}`),
      gatewayJson<CatalogEnvelope>(`/api/v1/data/list_tables?categories=${secondCatalog}`),
      gatewayJson<SchemaEnvelope>(
        "/api/v1/data/get_table_schema?table_name=company_snapshot",
      ),
    ]);

  const snapshots = parsePayloadRows<Snapshot>(manifest, "snapshot");
  const analysts = parsePayloadRows<AnalystConsensus>(manifest, "analyst");
  const extended = parsePayloadRows<ExtendedQuote>(manifest, "extended");
  const indices = parsePayloadRows<MarketIndex>(manifest, "index");
  const history = mapRows<HistoryBar>(historyEnvelope).map((bar) => ({
    ...bar,
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume),
  }));
  const earnings = events ? parsePayloadRows<EarningsEvent>(events, "earnings") : [];
  const ownership = events ? parsePayloadRows<OwnershipEvent>(events, "ownership") : [];

  const signalItems = signalsEnvelope.data?.items ?? [];
  const signals: SignalEvent[] = signalItems.map((item) => ({
    id: item.id,
    headline: item.headline,
    summary: item.summary ? item.summary.slice(0, 240) : null,
    tickers: (item.suggested_tickers ?? []).filter((ticker) => tickers.includes(ticker)),
    score: Number(item.score ?? 0),
    sourceNames: (item.trigger_sources ?? [])
      .map((source) => source.source_name)
      .filter((name): name is string => Boolean(name))
      .slice(0, 2),
    eventTypes: item.tags?.event_types?.slice(0, 2) ?? [],
    createdAt: item.created_at ?? item.earliest_trigger_event_time ?? "",
    triggerAt: item.earliest_trigger_event_time ?? item.created_at ?? "",
  }));

  const rawCatalog = [...(catalogA.data ?? []), ...(catalogB.data ?? [])];
  const altCategories: AltCategory[] = rawCatalog.map((group) => ({
    category: group.category,
    label: ALT_LABELS[group.category] ?? group.category,
    count: group.tables.length,
    tables: group.tables.map((table) => ({ name: table.name, summary: table.summary })),
  }));
  const schemaColumns = (schemaEnvelope.data?.columns ?? []).map((column) => column.column_name);

  const stocks = stockOptions.map((stock) => ({
    ...stock,
    snapshot: snapshots.find((item) => item.ticker === stock.ticker) ?? null,
    history: history
      .filter((item) => item.ticker === stock.ticker)
      .sort((a, b) => a.period_end.localeCompare(b.period_end)),
    analyst: analysts.find((item) => item.ticker === stock.ticker) ?? null,
    extended: extended.find((item) => item.ticker === stock.ticker) ?? null,
    earnings: earnings
      .filter((item) => item.ticker === stock.ticker)
      .sort((a, b) => b.date.localeCompare(a.date)),
    ownership: ownership
      .filter((item) => item.ticker === stock.ticker)
      .sort((a, b) => (b.filing_date ?? "").localeCompare(a.filing_date ?? "")),
  }));

  return {
    ok: true,
    source: "Drillr Gateway",
    fetchedAt: new Date().toISOString(),
    cacheAgeSeconds: 0,
    stale: false,
    partial: events === null,
    stocks,
    indices,
    signals,
    capabilities: {
      structuredFieldCount: schemaColumns.length,
      schemaGroups: buildSchemaGroups(schemaColumns),
      altTableCount: altCategories.reduce((total, category) => total + category.count, 0),
      altCategories,
      signalCount: signals.length,
    },
    dataAsOf: {
      prices: latest(history.map((item) => item.period_end)),
      extended: latest(extended.map((item) => item.extended_updated_at)),
      signals: latest(signals.map((item) => item.createdAt)),
    },
  };
}

export async function GET() {
  const stockOptions = await listDashboardStocks();
  const cacheKey = `dashboard-v6:${stockOptions
    .map((stock) => `${stock.ticker}:${stock.name}`)
    .join("|")}`;
  const cached = await getDashboardCache(cacheKey);
  const ageMs = cached ? Date.now() - cached.updatedAt : Number.POSITIVE_INFINITY;
  const cachedPayload = cached ? JSON.parse(cached.payload) as DashboardPayload : null;
  const cacheTtl = cachedPayload?.partial ? PARTIAL_CACHE_TTL_MS : CACHE_TTL_MS;

  if (cachedPayload && ageMs < cacheTtl) {
    return Response.json({
      ...cachedPayload,
      cacheAgeSeconds: Math.max(0, Math.round(ageMs / 1000)),
    });
  }

  try {
    const payload = await fetchDashboard();
    await putDashboardCache(cacheKey, JSON.stringify(payload));
    return Response.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (cached) {
      return Response.json({
        ...cachedPayload!,
        stale: true,
        cacheAgeSeconds: Math.max(0, Math.round(ageMs / 1000)),
      });
    }
    return Response.json(
      {
        ok: false,
        error: "真实数据源暂时不可用",
        detail: error instanceof Error ? error.message : "Unknown gateway error",
      },
      { status: 503 },
    );
  }
}

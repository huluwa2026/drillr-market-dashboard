import type { Page } from "@playwright/test";

const fetchedAt = "2026-07-16T09:30:00.000Z";

function snapshot(ticker: string, name: string, price: number, sign = 1) {
  return {
    ticker,
    company_name: name,
    industry: "Consumer Electronics",
    sector: "Technology",
    country: "US",
    exchange: "NASDAQ",
    price_current: price,
    shares_outstanding: 15_400_000_000,
    market_capitalization: price * 15_400_000_000,
    enterprise_value: price * 15_450_000_000,
    pe_ratio_ttm: 31.4,
    pe_ratio_fwd: 28.8,
    pe_calendar_2026: 30.2,
    pe_calendar_2027: 27.1,
    pe_calendar_2028: 24.6,
    peg_ratio_ttm: 2.1,
    pb_ratio_ttm: 42.2,
    ps_ratio_ttm: 9.8,
    ps_ratio_fwd: 9.1,
    pcf_ratio_ttm: 29.4,
    ev_to_sales_ttm: 9.9,
    ev_to_ebitda_ttm: 24.1,
    ev_to_ebit_ttm: 27.5,
    gross_profit_margin_ttm: 46.9,
    ebit_margin_ttm: 31.8,
    ebitda_margin_ttm: 34.6,
    net_income_margin_ttm: 26.8,
    fcf_margin_ttm: 28.1,
    roe_ttm: 151.2,
    roa_ttm: 32.5,
    roic_ttm: 71.4,
    capex_to_sales_ttm: 2.6,
    asset_turnover_ttm: 1.15,
    cash_from_operations_ttm: 132_000_000_000,
    cash_per_share_ttm: 4.72,
    revenue_growth_ttm: 12.7 * sign,
    ebitda_growth_ttm: 15.2 * sign,
    ebit_growth_ttm: 16.1 * sign,
    eps_growth_ttm: 22.6 * sign,
    fcf_growth_ttm: 28.4 * sign,
    ocf_growth_ttm: 26.7 * sign,
    revenue_growth_fwd: 8.2 * sign,
    ebitda_growth_fwd: 9.4 * sign,
    eps_growth_fwd: 10.5 * sign,
    revenue_cagr_3y: 5.3 * sign,
    eps_cagr_3y: 7.8 * sign,
    fcf_cagr_3y: -2.4 * sign,
    revenue_cagr_5y: 8.9 * sign,
    eps_cagr_5y: 17.3 * sign,
    fcf_cagr_5y: 6.4 * sign,
    dividend_rate_ttm: 1.04,
    dividend_yield_ttm: 0.32,
    payout_ratio_ttm: 14.8,
    dividend_growth_1y: 4.1,
    dividend_cagr_3y: 4.4,
    dividend_cagr_5y: 5.1,
    debt_to_equity: 0.81,
    net_debt_to_equity: 0.43,
    debt_to_assets: 0.24,
    debt_to_ebitda: 0.56,
    net_debt_to_ebitda: 0.31,
    interest_coverage: 0,
    current_ratio: 1.08,
    quick_ratio: 1.02,
    price_return_1d: 4.01 * sign,
    price_return_5d: 1.7 * sign,
    price_return_1m: 6.4 * sign,
    price_return_3m: 18.3 * sign,
    price_return_6m: 22.1 * sign,
    price_return_ytd: 16.2 * sign,
    price_return_1y: 51.4 * sign,
    price_return_3y: 63.2 * sign,
    price_return_5y: 112.8 * sign,
    price_return_10y: 1175.4 * sign,
    sma_10_day: price * 0.98,
    price_vs_sma_10d: 1.8 * sign,
    sma_signal_10d: "BUY",
    sma_50_day: price * 0.94,
    price_vs_sma_50d: 5.2 * sign,
    sma_signal_50d: "BUY",
    sma_100_day: price * 0.89,
    price_vs_sma_100d: 12.1 * sign,
    sma_signal_100d: "BUY",
    sma_200_day: price * 0.86,
    price_vs_sma_200d: 15.4 * sign,
    sma_signal_200d: "BUY",
    rsi_14_day: sign > 0 ? 61.5 : 44.2,
    rsi_signal: "NEUTRAL",
    eps_beats_last_12q: 9,
    eps_misses_last_12q: 1,
    revenue_beats_last_12q: 8,
    revenue_misses_last_12q: 2,
    latest_eps_actual: 1.98,
    latest_eps_estimate: 1.92,
    latest_eps_surprise: 3.1,
    latest_revenue_actual: 111_800_000_000,
    latest_revenue_estimate: 109_900_000_000,
    latest_revenue_surprise: 1.7,
    avg_eps_surprise_last_4q: 5.6,
    avg_revenue_surprise_last_4q: 2.7,
    next_q_eps_estimate_avg: 2.05,
    next_q_revenue_estimate_avg: 116_400_000_000,
  };
}

function history(ticker: string, base: number) {
  return Array.from({ length: 18 }, (_, index) => {
    const close = base + index * 0.72 + Math.sin(index / 2) * 2.1;
    const periodEnd = new Date(Date.UTC(2026, 5, 20 + index)).toISOString().slice(0, 10);
    return {
      ticker,
      period_end: periodEnd,
      open: close - 0.8,
      high: close + 1.5,
      low: close - 1.7,
      close,
      volume: 38_000_000 + index * 440_000,
    };
  });
}

function stock(ticker: string, name: string, price: number, sign = 1) {
  return {
    ticker,
    name,
    market: "NASDAQ",
    sortOrder: ticker === "AAPL" ? 10 : 20,
    snapshot: snapshot(ticker, name, price, sign),
    history: history(ticker, price - 12),
    analyst: {
      ticker,
      snapshot_date: "2026-07-16",
      total_analysts: 24,
      consensus: "Buy",
      pt_consensus: price * 1.12,
      pt_high: price * 1.25,
      pt_low: price * 0.82,
      strong_buy_count: 4,
      buy_count: 13,
      hold_count: 6,
      sell_count: 1,
      strong_sell_count: 0,
    },
    extended: {
      ticker,
      pre_price: price * 1.002,
      pre_change_rate: 0.2 * sign,
      pre_volume: 120_000,
      after_price: price * 1.001,
      after_change_rate: 0.1 * sign,
      after_volume: 90_000,
      overnight_price: price * 1.0005,
      overnight_change_rate: 0.05 * sign,
      overnight_volume: 10_000,
      extended_updated_at: fetchedAt,
    },
    earnings: [
      { ticker, date: "2026-04-30", eps_estimated: 1.92, eps_actual: 1.98, revenue_estimated: 109_900_000_000, revenue_actual: 111_800_000_000, last_updated: fetchedAt },
      { ticker, date: "2026-01-30", eps_estimated: 1.76, eps_actual: 1.82, revenue_estimated: 101_000_000_000, revenue_actual: 103_200_000_000, last_updated: fetchedAt },
    ],
    ownership: [],
  };
}

const signals = Array.from({ length: 10 }, (_, index) => ({
  id: `signal-${index}`,
  headline: [
    "Apple expands on-device AI partnership across its next product cycle",
    "Supplier checks point to stronger premium-device demand into the quarter",
    "Analysts raise target range as services mix supports operating margins",
  ][index % 3],
  summary: "A directly relevant Drillr event summary kept to one compact dashboard line.",
  tickers: index % 2 ? ["AAPL"] : ["AAPL", "NVDA"],
  score: null,
  sourceNames: [],
  eventTypes: ["Technology"],
  createdAt: `2026-07-16T${String(13 - index).padStart(2, "0")}:30:00.000Z`,
  triggerAt: `2026-07-16T${String(13 - index).padStart(2, "0")}:30:00.000Z`,
}));

const indices = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX", "000001.SS"].map((ticker, index) => ({
  index_ticker: ticker,
  name: ticker,
  price: 7_520 + index * 980,
  change: 20 - index * 3,
  change_pct: index === 5 ? -1.8 : 0.3 + index * 0.12,
  volume: 2_000_000_000,
  day_low: 7_400,
  day_high: 7_600,
  year_low: 5_400,
  year_high: 7_700,
  open: 7_480,
  previous_close: 7_500,
  last_updated: fetchedAt,
}));

export const dashboardFixture = {
  ok: true,
  source: "Drillr Gateway",
  fetchedAt,
  cacheAgeSeconds: 0,
  stale: false,
  partial: false,
  stocks: [stock("AAPL", "Apple Inc.", 327.5), stock("NVDA", "NVIDIA Corp.", 212.5, -1)],
  indices,
  signals,
  capabilities: {
    structuredFieldCount: 159,
    schemaGroups: [
      { label: "公司身份", count: 18, fields: ["ticker", "company_name"] },
      { label: "估值矩阵", count: 22, fields: ["pe_ratio_ttm"] },
      { label: "盈利质量", count: 19, fields: ["roic_ttm"] },
      { label: "成长序列", count: 16, fields: ["eps_cagr_5y"] },
    ],
    altTableCount: 65,
    altCategories: [
      { category: "Semiconductors", label: "半导体", count: 14, tables: [] },
      { category: "Data Centers", label: "数据中心", count: 11, tables: [] },
      { category: "Macro & Trade", label: "宏观与贸易", count: 9, tables: [] },
    ],
    signalCount: signals.length,
  },
  dataAsOf: { prices: "2026-07-16", extended: fetchedAt, signals: fetchedAt },
};

export const liveFixture = {
  ok: true,
  source: "equity_price_rt",
  sourceCadenceSeconds: 180,
  fetchedAt,
  partial: false,
  quotes: [
    { symbol: "AAPL", name: "Apple Inc.", currency: "USD", price: 327.5, change: 12.64, changesPercentage: 4.01, volume: 44_400_000, marketCap: 5_040_000_000_000, pe: 31.4, eps: 10.43, preMarketPrice: 328.42, preMarketChangePercent: 0.28, postMarketPrice: 327.8, postMarketChangePercent: 0.09 },
    { symbol: "NVDA", name: "NVIDIA Corp.", currency: "USD", price: 212.5, change: -1.18, changesPercentage: -0.55, volume: 188_000_000, marketCap: 5_180_000_000_000, pe: 42.1, eps: 5.04, preMarketPrice: 213.1, preMarketChangePercent: 0.2, postMarketPrice: 211.9, postMarketChangePercent: -0.28 },
  ],
  indices,
};

export const intradayFixture = {
  ok: true,
  ticker: "AAPL",
  source: "price_volume_intraday",
  sourceCadenceSeconds: 60,
  fetchedAt,
  sessionDate: "2026-07-16",
  bars: Array.from({ length: 78 }, (_, index) => {
    const open = 317.4 + index * 0.13 + Math.sin(index / 5) * 1.1;
    const close = open + Math.sin(index / 2.7) * 0.5;
    return {
      date: `2026-07-16 ${String(9 + Math.floor((30 + index) / 60)).padStart(2, "0")}:${String((30 + index) % 60).padStart(2, "0")}:00`,
      open,
      high: Math.max(open, close) + 0.45,
      low: Math.min(open, close) - 0.38,
      close,
      volume: 420_000 + (index % 9) * 38_000,
    };
  }),
};

export async function installApiFixtures(page: Page) {
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: dashboardFixture }));
  await page.route("**/api/live", (route) => route.fulfill({ json: liveFixture }));
  await page.route("**/api/signals", (route) => route.fulfill({ json: { ok: true, source: "Drillr public signals", fetchedAt, signals } }));
  await page.route(/\/api\/intraday\?/, (route) => route.fulfill({ json: intradayFixture }));
}

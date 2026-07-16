export type StockOption = {
  ticker: string;
  name: string;
  market: string;
  sortOrder: number;
};

export type HistoryBar = {
  ticker: string;
  period_end: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Snapshot = {
  ticker: string;
  company_name: string;
  industry: string;
  sector: string;
  country: string;
  exchange: string;
  price_current: number;
  shares_outstanding: number | null;
  market_capitalization: number;
  enterprise_value: number | null;
  pe_ratio_ttm: number | null;
  pe_ratio_fwd: number | null;
  pe_calendar_2026: number | null;
  pe_calendar_2027: number | null;
  pe_calendar_2028: number | null;
  peg_ratio_ttm: number | null;
  pb_ratio_ttm: number | null;
  ps_ratio_ttm: number | null;
  ps_ratio_fwd: number | null;
  pcf_ratio_ttm: number | null;
  ev_to_sales_ttm: number | null;
  ev_to_ebitda_ttm: number | null;
  ev_to_ebit_ttm: number | null;
  gross_profit_margin_ttm: number | null;
  ebit_margin_ttm: number | null;
  ebitda_margin_ttm: number | null;
  net_income_margin_ttm: number | null;
  fcf_margin_ttm: number | null;
  roe_ttm: number | null;
  roa_ttm: number | null;
  roic_ttm: number | null;
  capex_to_sales_ttm: number | null;
  asset_turnover_ttm: number | null;
  cash_from_operations_ttm: number | null;
  cash_per_share_ttm: number | null;
  revenue_growth_ttm: number | null;
  ebitda_growth_ttm: number | null;
  ebit_growth_ttm: number | null;
  eps_growth_ttm: number | null;
  fcf_growth_ttm: number | null;
  ocf_growth_ttm: number | null;
  revenue_growth_fwd: number | null;
  ebitda_growth_fwd: number | null;
  eps_growth_fwd: number | null;
  revenue_cagr_3y: number | null;
  eps_cagr_3y: number | null;
  fcf_cagr_3y: number | null;
  revenue_cagr_5y: number | null;
  eps_cagr_5y: number | null;
  fcf_cagr_5y: number | null;
  dividend_rate_ttm: number | null;
  dividend_yield_ttm: number | null;
  payout_ratio_ttm: number | null;
  dividend_growth_1y: number | null;
  dividend_cagr_3y: number | null;
  dividend_cagr_5y: number | null;
  debt_to_equity: number | null;
  net_debt_to_equity: number | null;
  debt_to_assets: number | null;
  debt_to_ebitda: number | null;
  net_debt_to_ebitda: number | null;
  interest_coverage: number | null;
  current_ratio: number | null;
  quick_ratio: number | null;
  price_return_1d: number | null;
  price_return_5d: number | null;
  price_return_1m: number | null;
  price_return_3m: number | null;
  price_return_6m: number | null;
  price_return_ytd: number | null;
  price_return_1y: number | null;
  price_return_3y: number | null;
  price_return_5y: number | null;
  price_return_10y: number | null;
  sma_10_day: number | null;
  price_vs_sma_10d: number | null;
  sma_signal_10d: string | null;
  sma_50_day: number | null;
  price_vs_sma_50d: number | null;
  rsi_14_day: number | null;
  sma_signal_50d: string | null;
  sma_100_day: number | null;
  price_vs_sma_100d: number | null;
  sma_signal_100d: string | null;
  sma_200_day: number | null;
  price_vs_sma_200d: number | null;
  sma_signal_200d: string | null;
  rsi_signal: string | null;
  eps_beats_last_12q: number | null;
  eps_misses_last_12q: number | null;
  revenue_beats_last_12q: number | null;
  revenue_misses_last_12q: number | null;
  latest_eps_actual: number | null;
  latest_eps_estimate: number | null;
  latest_eps_surprise: number | null;
  latest_revenue_actual: number | null;
  latest_revenue_estimate: number | null;
  latest_revenue_surprise: number | null;
  avg_eps_surprise_last_4q: number | null;
  avg_revenue_surprise_last_4q: number | null;
  next_q_eps_estimate_avg: number | null;
  next_q_revenue_estimate_avg: number | null;
};

export type AnalystConsensus = {
  ticker: string;
  snapshot_date: string;
  total_analysts: number;
  consensus: string;
  pt_consensus: number | null;
  pt_high: number | null;
  pt_low: number | null;
  strong_buy_count: number;
  buy_count: number;
  hold_count: number;
  sell_count: number;
  strong_sell_count: number;
};

export type ExtendedQuote = {
  ticker: string;
  pre_price: number | null;
  pre_change_rate: number | null;
  pre_volume: number | null;
  after_price: number | null;
  after_change_rate: number | null;
  after_volume: number | null;
  overnight_price: number | null;
  overnight_change_rate: number | null;
  overnight_volume: number | null;
  extended_updated_at: string | null;
};

export type EarningsEvent = {
  ticker: string;
  date: string;
  eps_estimated: number | null;
  eps_actual: number | null;
  revenue_estimated: number | null;
  revenue_actual: number | null;
  last_updated: string | null;
};

export type OwnershipEvent = {
  ticker: string;
  date: string | null;
  filing_date: string | null;
  source: "insider" | "institution" | string;
  activity_type: string | null;
  filing_type: string | null;
  filer_name: string | null;
  filer_title: string | null;
  shares: number | null;
  price_per_share: number | null;
  market_value: number | null;
};

export type MarketIndex = {
  index_ticker: string;
  name: string;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  day_low: number;
  day_high: number;
  year_low: number;
  year_high: number;
  open: number;
  previous_close: number;
  last_updated: string;
};

export type SignalEvent = {
  id: string;
  headline: string;
  summary: string | null;
  tickers: string[];
  score: number | null;
  sourceNames: string[];
  eventTypes: string[];
  createdAt: string;
  triggerAt: string;
};

export type LiveQuote = {
  symbol: string;
  name?: string;
  currency: string;
  price: number;
  change: number;
  changesPercentage: number;
  volume: number;
  marketCap: number;
  pe: number;
  eps: number;
  divYield?: number;
  preMarketPrice?: number;
  preMarketChangePercent?: number;
  postMarketPrice?: number;
  postMarketChangePercent?: number;
};

export type LivePayload = {
  ok: true;
  source: "equity_price_rt";
  sourceCadenceSeconds: number;
  fetchedAt: string;
  partial: boolean;
  quotes: LiveQuote[];
  indices: MarketIndex[];
};

export type IntradayBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type IntradayPayload = {
  ok: true;
  ticker: string;
  source: "price_volume_intraday";
  sourceCadenceSeconds: number;
  fetchedAt: string;
  sessionDate: string | null;
  bars: IntradayBar[];
};

export type SignalsPayload = {
  ok: true;
  source: "Drillr public signals";
  fetchedAt: string;
  signals: SignalEvent[];
};

export type SchemaGroup = {
  label: string;
  count: number;
  fields: string[];
};

export type AltCategory = {
  category: string;
  label: string;
  count: number;
  tables: Array<{ name: string; summary: string }>;
};

export type StockData = StockOption & {
  snapshot: Snapshot | null;
  history: HistoryBar[];
  analyst: AnalystConsensus | null;
  extended: ExtendedQuote | null;
  earnings: EarningsEvent[];
  ownership: OwnershipEvent[];
};

export type DashboardPayload = {
  ok: true;
  source: "Drillr Gateway";
  fetchedAt: string;
  cacheAgeSeconds: number;
  stale: boolean;
  partial: boolean;
  stocks: StockData[];
  indices: MarketIndex[];
  signals: SignalEvent[];
  capabilities: {
    structuredFieldCount: number;
    schemaGroups: SchemaGroup[];
    altTableCount: number;
    altCategories: AltCategory[];
    signalCount: number;
  };
  dataAsOf: {
    prices: string | null;
    extended: string | null;
    signals: string | null;
  };
};

export type DashboardError = {
  ok: false;
  error: string;
  detail?: string;
};

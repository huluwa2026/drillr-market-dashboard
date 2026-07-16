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
  sector: string;
  exchange: string;
  price_current: number;
  market_capitalization: number;
  pe_ratio_ttm: number | null;
  pe_ratio_fwd: number | null;
  gross_profit_margin_ttm: number | null;
  net_income_margin_ttm: number | null;
  revenue_growth_ttm: number | null;
  eps_growth_fwd: number | null;
  price_return_1d: number | null;
  price_return_5d: number | null;
  price_return_1m: number | null;
  price_return_3m: number | null;
  price_return_ytd: number | null;
  price_return_1y: number | null;
  rsi_14_day: number | null;
  sma_signal_50d: string | null;
  latest_eps_surprise: number | null;
  next_q_eps_estimate_avg: number | null;
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
  id: number;
  headline: string;
  summary: string | null;
  tickers: string[];
  score: number;
  sourceNames: string[];
  eventTypes: string[];
  createdAt: string;
  triggerAt: string;
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

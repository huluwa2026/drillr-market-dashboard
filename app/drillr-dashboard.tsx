"use client";

import {
  createContext,
  type FormEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type {
  DashboardError,
  DashboardPayload,
  IntradayBar,
  IntradayPayload,
  LivePayload,
  LiveQuote,
  MarketIndex,
  SignalEvent,
  SignalsPayload,
  StockData,
  StockOption,
} from "./dashboard-types";

type ViewMode = "focus" | "radar";
type Locale = "en" | "zh";
type ApiError = { ok?: false; error?: string; detail?: string };

const LocaleContext = createContext<Locale>("en");

const SCHEMA_LABELS_EN: Record<string, string> = {
  "公司身份": "Company identity",
  "估值矩阵": "Valuation",
  "盈利质量": "Profitability",
  "成长序列": "Growth",
  "现金与杠杆": "Cash & leverage",
  "股东回报": "Shareholder returns",
  "价格与技术": "Price & technicals",
  "知识与治理": "Knowledge & governance",
  "盈利预期": "Earnings expectations",
  "其他基础字段": "Other fundamentals",
};

function useLocale() {
  return useContext(LocaleContext);
}

function localized(locale: Locale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

function localizedCompanyName(stock: StockData, locale: Locale, quote?: LiveQuote) {
  if (locale === "en") return quote?.name ?? stock.snapshot?.company_name ?? stock.name;
  return stock.name || quote?.name || stock.snapshot?.company_name || stock.ticker;
}

function finite(value: number | null | undefined) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function decimal(value: number | null | undefined, digits = 2) {
  const number = finite(value);
  return number == null ? "—" : number.toFixed(digits);
}

function money(value: number | null | undefined, digits = 2) {
  const number = finite(value);
  return number == null ? "—" : `$${number.toFixed(digits)}`;
}

function percent(value: number | null | undefined, digits = 2) {
  const number = finite(value);
  if (number == null) return "—";
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function compact(value: number | null | undefined) {
  const number = finite(value);
  if (number == null) return "—";
  if (Math.abs(number) >= 1e12) return `${(number / 1e12).toFixed(2)}T`;
  if (Math.abs(number) >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
  if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(1)}M`;
  if (Math.abs(number) >= 1e3) return `${(number / 1e3).toFixed(1)}K`;
  return number.toFixed(0);
}

function dateTime(value: string | null | undefined, locale: Locale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function shortDate(value: string | null | undefined) {
  return value ? value.slice(5, 10).replace("-", "/") : "—";
}

function valueTone(value: number | null | undefined) {
  const number = finite(value);
  if (number == null || number === 0) return "neutral";
  return number > 0 ? "positive" : "negative";
}

function targetUpside(stock: StockData, livePrice?: number) {
  const price = finite(livePrice) ?? finite(stock.snapshot?.price_current);
  const target = finite(stock.analyst?.pt_consensus);
  return price && target ? ((target - price) / price) * 100 : null;
}

function sessionLabel(locale: Locale) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const total = hour * 60 + minute;
  if (weekday === "Sat" || weekday === "Sun") return localized(locale, "休市", "CLOSED");
  if (total >= 570 && total < 960) return localized(locale, "交易中", "OPEN");
  if (total >= 240 && total < 570) return localized(locale, "盘前", "PRE-MKT");
  if (total >= 960 && total < 1200) return localized(locale, "盘后", "AFTER-HRS");
  return localized(locale, "休市", "CLOSED");
}

function LiveClock() {
  const locale = useLocale();
  const [clock, setClock] = useState("");

  useEffect(() => {
    const update = () => setClock(new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [locale]);

  return <span className="live-clock"><b>{sessionLabel(locale)}</b><em>{clock} CST</em></span>;
}

function RefreshStamp({ label, value, cadence }: { label: string; value?: string; cadence: string }) {
  const locale = useLocale();
  return <span className="refresh-stamp"><i />{label}<b>{value ? dateTime(value, locale) : localized(locale, "等待", "WAITING")}</b><em>{cadence}</em></span>;
}

function MiniSparkline({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return <span className="mini-empty">NO SERIES</span>;
  const width = 180;
  const height = 46;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.01);
  const points = values.map((value, index) => {
    const x = index / Math.max(values.length - 1, 1) * width;
    const y = height - 4 - ((value - min) / range) * (height - 8);
    return `${x},${y}`;
  }).join(" ");
  return <svg className={`mini-spark ${tone}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg>;
}

type CandlePoint = { date: string; open: number; close: number; high: number; low: number; volume: number };

function aggregateCandles(points: CandlePoint[], bucketSize: number) {
  if (bucketSize <= 1) return points;
  const result: CandlePoint[] = [];
  for (let index = 0; index < points.length; index += bucketSize) {
    const bucket = points.slice(index, index + bucketSize);
    if (!bucket.length) continue;
    result.push({
      date: bucket.at(-1)!.date,
      open: bucket[0].open,
      close: bucket.at(-1)!.close,
      high: Math.max(...bucket.map((point) => point.high)),
      low: Math.min(...bucket.map((point) => point.low)),
      volume: bucket.reduce((sum, point) => sum + point.volume, 0),
    });
  }
  return result;
}

function IntradayChart({ bars, fallback, ticker }: { bars: IntradayBar[]; fallback: StockData["history"]; ticker: string }) {
  const locale = useLocale();
  const usingMinute = bars.length > 1;
  const sourcePoints = usingMinute
    ? bars.map((bar) => ({ date: bar.date, open: bar.open, close: bar.close, high: bar.high, low: bar.low, volume: bar.volume }))
    : fallback.map((bar) => ({ date: bar.period_end, open: bar.open, close: bar.close, high: bar.high, low: bar.low, volume: bar.volume }));
  const points = aggregateCandles(sourcePoints, usingMinute ? 5 : 1);
  const [selectedIndex, setSelectedIndex] = useState(Math.max(points.length - 1, 0));
  const [pointerActive, setPointerActive] = useState(false);

  if (points.length < 2) return <div className="chart-empty">{localized(locale, "暂无可用价格序列", "No price series available")}</div>;

  const width = 960;
  const height = 248;
  const plotBottom = 188;
  const min = Math.min(...points.map((point) => point.low));
  const max = Math.max(...points.map((point) => point.high));
  const range = Math.max(max - min, 0.01);
  const maxVolume = Math.max(...points.map((point) => point.volume), 1);
  const xFor = (index: number) => 18 + index / Math.max(points.length - 1, 1) * (width - 36);
  const yFor = (value: number) => 18 + (1 - (value - min) / range) * (plotBottom - 36);
  const change = points.at(-1)!.close - points[0].open;
  const tone = valueTone(change);
  const currentY = yFor(points.at(-1)!.close);
  const volumeStep = (width - 36) / points.length;
  const candleWidth = clamp(volumeStep * .62, 2.5, 10);
  const activeIndex = pointerActive ? clamp(selectedIndex, 0, points.length - 1) : points.length - 1;
  const activePoint = points[activeIndex];
  const activeX = xFor(activeIndex);
  const activeY = yFor(activePoint.close);
  const activeChange = (activePoint.close - points[0].open) / points[0].open * 100;
  const tooltipEdge = activeIndex / (points.length - 1) < .18 ? "edge-start" : activeIndex / (points.length - 1) > .82 ? "edge-end" : "";
  const tooltipStyle = { left: `${activeX / width * 100}%` } as CSSProperties;

  function selectFromPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = clamp((event.clientX - rect.left) / rect.width * width, 18, width - 18);
    setSelectedIndex(Math.round((svgX - 18) / (width - 36) * (points.length - 1)));
  }

  return (
    <div className={`intraday-chart ${tone}`} data-chart-type="candlestick">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={localized(locale,
          `${ticker} ${usingMinute ? "五分钟" : "日线"} K 线，可移动鼠标查看每根 K 线的开高低收和成交量`,
          `${ticker} ${usingMinute ? "five-minute" : "daily"} candlesticks; move the pointer to inspect OHLC and volume`,
        )}
        onPointerEnter={(event) => { setPointerActive(true); selectFromPointer(event); }}
        onPointerMove={selectFromPointer}
        onPointerLeave={() => setPointerActive(false)}
      >
        {[0, 1, 2, 3].map((row) => {
          const y = 22 + row * 52;
          const label = max - row / 3 * range;
          return <g key={row}><line className="chart-grid" x1="18" x2={width - 18} y1={y} y2={y} /><text className="chart-y" x={width - 20} y={y - 5} textAnchor="end">{label.toFixed(2)}</text></g>;
        })}
        {points.map((point, index) => {
          const direction = point.close >= point.open ? "up" : "down";
          const bodyTop = yFor(Math.max(point.open, point.close));
          const bodyBottom = yFor(Math.min(point.open, point.close));
          const bodyHeight = Math.max(1.6, bodyBottom - bodyTop);
          const barHeight = Math.max(2, point.volume / maxVolume * 48);
          return <g className={`chart-candle ${direction} ${index === points.length - 1 ? "latest" : ""}`} key={point.date}>
            <rect className="candle-volume" x={xFor(index) - candleWidth / 2} y={height - barHeight} width={candleWidth} height={barHeight} />
            <line className="candle-wick" x1={xFor(index)} x2={xFor(index)} y1={yFor(point.high)} y2={yFor(point.low)} />
            <rect className="candle-body" x={xFor(index) - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} />
          </g>;
        })}
        <line className="current-line" x1="18" x2={width - 18} y1={currentY} y2={currentY} />
        <rect className="current-price-tag" x={width - 74} y={currentY - 10} width="56" height="18" rx="2" />
        <text className="current-price-text" x={width - 46} y={currentY + 3} textAnchor="middle">{points.at(-1)!.close.toFixed(2)}</text>
        <g className={`chart-crosshair ${pointerActive ? "active" : ""}`} aria-hidden="true">
          <line x1={activeX} x2={activeX} y1="18" y2={plotBottom} />
          <line x1="18" x2={width - 18} y1={activeY} y2={activeY} />
          <circle cx={activeX} cy={activeY} r="5" />
        </g>
      </svg>
      {pointerActive && <div className={`chart-tooltip ${tooltipEdge}`} style={tooltipStyle}>
        <div><b>{usingMinute ? activePoint.date.slice(11, 16) : shortDate(activePoint.date)}</b><em className={valueTone(activeChange)}>{percent(activeChange)}</em></div>
        <p><span>{localized(locale, "开", "O")} {money(activePoint.open)}</span><span>{localized(locale, "高", "H")} {money(activePoint.high)}</span><span>{localized(locale, "低", "L")} {money(activePoint.low)}</span><span>{localized(locale, "收", "C")} {money(activePoint.close)}</span></p>
        <small>{localized(locale, "成交量", "Volume")} {compact(activePoint.volume)}</small>
      </div>}
      <div className="chart-interaction-row">
        <div className="chart-axis"><span>{usingMinute ? points[0].date.slice(11, 16) : shortDate(points[0].date)}</span><b>{localized(locale, "拖动查看", "DRAG TO INSPECT")} · {usingMinute ? "5 MIN K" : "DAILY K"}</b><span>{usingMinute ? points.at(-1)!.date.slice(11, 16) : shortDate(points.at(-1)!.date)}</span></div>
        <input
          className="chart-scrubber"
          type="range"
          min="0"
          max={points.length - 1}
          value={activeIndex}
          onChange={(event) => { setPointerActive(true); setSelectedIndex(Number(event.target.value)); }}
          onBlur={() => setPointerActive(false)}
          aria-label={localized(locale, `${ticker} 价格序列时间点`, `${ticker} price-series time point`)}
        />
        <div className="chart-readout" aria-live="polite"><span>{usingMinute ? activePoint.date.slice(11, 16) : shortDate(activePoint.date)}</span><b>{money(activePoint.close)}</b><em className={valueTone(activeChange)}>{percent(activeChange)}</em><small>{compact(activePoint.volume)} VOL</small></div>
      </div>
    </div>
  );
}

function PanelHeader({ eyebrow, title, meta }: { eyebrow: string; title: string; meta?: string }) {
  return <header className="practical-panel-head"><div><span>{eyebrow}</span><h2>{title}</h2></div>{meta && <em>{meta}</em>}</header>;
}

function WatchStrip({
  stocks,
  quotes,
  selectedTicker,
  quoteMoves,
  onSelect,
  onManage,
}: {
  stocks: StockData[];
  quotes: Map<string, LiveQuote>;
  selectedTicker: string;
  quoteMoves: Record<string, number>;
  onSelect: (ticker: string) => void;
  onManage: () => void;
}) {
  const locale = useLocale();
  return (
    <nav className="watch-strip" aria-label={localized(locale, "自选股票快速切换", "Quick watchlist navigation")}>
      <div className="watch-label"><span>WATCHLIST</span><b>{stocks.length}/6</b></div>
      <div className="watch-items">
        {stocks.map((stock) => {
          const quote = quotes.get(stock.ticker);
          const change = quote?.changesPercentage ?? stock.snapshot?.price_return_1d;
          return <button type="button" className={selectedTicker === stock.ticker ? "active" : ""} data-moved={quoteMoves[stock.ticker] ? "true" : "false"} key={stock.ticker} onClick={() => onSelect(stock.ticker)}>
            <span><b>{stock.ticker}</b><small>{localizedCompanyName(stock, locale, quote)}</small></span>
            <strong>{money(quote?.price ?? stock.snapshot?.price_current)}</strong>
            <em className={valueTone(change)}>{percent(change)}</em>
            <i className={valueTone(quoteMoves[stock.ticker])}>{quoteMoves[stock.ticker] ? (quoteMoves[stock.ticker] > 0 ? "↗" : "↘") : "·"}</i>
          </button>;
        })}
      </div>
      <button type="button" className="manage-watch" onClick={onManage}><span>{localized(locale, "编辑自选", "MANAGE")}</span><b>＋</b></button>
    </nav>
  );
}

function FocusSummary({ stock, quote, signalCount, quoteMove, liveAt }: { stock: StockData; quote?: LiveQuote; signalCount: number; quoteMove?: number; liveAt?: string }) {
  const locale = useLocale();
  const price = quote?.price ?? stock.snapshot?.price_current;
  const dayMove = quote?.changesPercentage ?? stock.snapshot?.price_return_1d;
  const companyName = localizedCompanyName(stock, locale, quote);
  return (
    <section className="focus-summary practical-panel" data-moved={quoteMove ? "true" : "false"}>
      <div className="focus-identity">
        <span>SELECTED EQUITY</span>
        <div><h1>{stock.ticker}</h1><p>{companyName}</p></div>
        <small>{stock.snapshot?.exchange ?? stock.market} · {stock.snapshot?.sector ?? "—"}</small>
      </div>
      <div className="hero-price">
        <span>{localized(locale, "最新价", "LATEST PRICE")}</span>
        <strong>{money(price)}</strong>
        <div className={valueTone(dayMove)}><b>{percent(dayMove)}</b><em>{quote ? (quote.change >= 0 ? "+" : "") + money(quote.change) : localized(locale, "日内", "INTRADAY")}</em></div>
      </div>
      <div className="session-quotes">
        <div><span>{localized(locale, "盘前", "PRE-MKT")}</span><b>{money(quote?.preMarketPrice ?? stock.extended?.pre_price)}</b><em className={valueTone(quote?.preMarketChangePercent ?? stock.extended?.pre_change_rate)}>{percent(quote?.preMarketChangePercent ?? stock.extended?.pre_change_rate)}</em></div>
        <div><span>{localized(locale, "盘后", "AFTER-HRS")}</span><b>{money(quote?.postMarketPrice ?? stock.extended?.after_price)}</b><em className={valueTone(quote?.postMarketChangePercent ?? stock.extended?.after_change_rate)}>{percent(quote?.postMarketChangePercent ?? stock.extended?.after_change_rate)}</em></div>
        <div><span>{localized(locale, "隔夜", "OVERNIGHT")}</span><b>{money(stock.extended?.overnight_price)}</b><em className={valueTone(stock.extended?.overnight_change_rate)}>{percent(stock.extended?.overnight_change_rate)}</em></div>
      </div>
      <div className="focus-attention">
        <span>{localized(locale, "本轮刷新", "THIS REFRESH")}</span>
        <b className={valueTone(quoteMove)}>{quoteMove ? `${quoteMove > 0 ? "+" : ""}${quoteMove.toFixed(2)}` : localized(locale, "无价格变化", "NO PRICE CHANGE")}</b>
        <small>{dateTime(liveAt, locale)} · {localized(locale, `${signalCount} 条相关信号`, `${signalCount} RELATED SIGNALS`)}</small>
      </div>
    </section>
  );
}

function SignalList({ signals, limit = 6, emptyText }: { signals: SignalEvent[]; limit?: number; emptyText?: string }) {
  const locale = useLocale();
  if (!signals.length) return <div className="panel-empty">{emptyText ?? localized(locale, "暂时没有匹配的实时信号", "No matching live signals yet")}</div>;
  return <div className="practical-signal-list">{signals.slice(0, limit).map((signal) => <article key={signal.id}>
    <time>{dateTime(signal.triggerAt, locale)}</time>
    <div><span>{signal.tickers.slice(0, 2).join(" · ") || signal.eventTypes[0] || "MARKET"}</span><h3>{signal.headline}</h3>{signal.summary && <p>{signal.summary}</p>}</div>
    <i>›</i>
  </article>)}</div>;
}

function multiple(value: number | null | undefined, digits = 1) {
  const number = finite(value);
  return number == null ? "—" : `${number.toFixed(digits)}x`;
}

type ChartMetric = { label: string; value: string; raw: number | null | undefined; note?: string };

function VisualDataPanel({ className, eyebrow, title, meta, points, children }: { className: string; eyebrow: string; title: string; meta: string; points: number; children: ReactNode }) {
  return <section className={`visual-data-panel practical-panel ${className}`} data-density-points={points}>
    <PanelHeader eyebrow={eyebrow} title={title} meta={meta} />
    {children}
  </section>;
}

function MetricBars({ metrics, signed = false, columns = 1, scale }: { metrics: ChartMetric[]; signed?: boolean; columns?: number; scale?: number }) {
  const observedScale = Math.max(...metrics.map((metric) => Math.abs(finite(metric.raw) ?? 0)), .01);
  const chartScale = Math.max(scale ?? observedScale, .01);
  return <div className={`metric-bar-chart ${signed ? "signed" : "unsigned"}`} style={{ "--metric-columns": columns, "--metric-rows": Math.ceil(metrics.length / columns) } as CSSProperties} role="img" aria-label={metrics.map((metric) => `${metric.label} ${metric.value}`).join("；")}>
    {metrics.map((metric) => {
      const raw = finite(metric.raw);
      const magnitude = raw == null ? 0 : clamp(Math.abs(raw) / chartScale, 0, 1);
      const left = signed ? (raw != null && raw < 0 ? 50 - magnitude * 50 : 50) : 0;
      const width = signed ? magnitude * 50 : magnitude * 100;
      const style = { "--bar-left": `${left}%`, "--bar-width": `${width}%` } as CSSProperties;
      return <div className="metric-bar-row" key={metric.label} data-empty={raw == null ? "true" : "false"}>
        <span>{metric.label}{metric.note && <small>{metric.note}</small>}</span>
        <i className="metric-track" aria-hidden="true"><em className={signed ? valueTone(raw) : ""} style={style} /></i>
        <b className={signed ? valueTone(raw) : ""}>{metric.value}</b>
      </div>;
    })}
  </div>;
}

function ReturnHeatmap({ metrics }: { metrics: ChartMetric[] }) {
  const scale = Math.max(...metrics.map((metric) => Math.abs(finite(metric.raw) ?? 0)), 1);
  return <div className="return-heatmap" role="img" aria-label={metrics.map((metric) => `${metric.label} ${metric.value}`).join("；")}>
    {metrics.map((metric) => {
      const raw = finite(metric.raw);
      const intensity = raw == null ? 0 : clamp(Math.abs(raw) / scale, .08, 1);
      return <div key={metric.label} className={valueTone(raw)} style={{ "--heat": `${Math.round(14 + intensity * 62)}%` } as CSSProperties}><span>{metric.label}</span><b>{metric.value}</b></div>;
    })}
  </div>;
}

function TechnicalVisual({ metrics, rsi, shares }: { metrics: ChartMetric[]; rsi: number | null | undefined; shares: number | null | undefined }) {
  const locale = useLocale();
  const rsiValue = finite(rsi);
  return <div className="technical-visual">
    <MetricBars metrics={metrics} signed scale={35} />
    <div className="rsi-gauge" role="img" aria-label={localized(locale, `RSI 14 ${decimal(rsiValue, 1)}，区间零到一百`, `RSI 14 ${decimal(rsiValue, 1)}, zero-to-one-hundred range`)}>
      <div><span>RSI 14</span><b>{decimal(rsiValue, 1)}</b><em>{rsiValue == null ? "—" : rsiValue >= 70 ? localized(locale, "偏热", "HOT") : rsiValue <= 30 ? localized(locale, "偏冷", "COLD") : localized(locale, "中性", "NEUTRAL")}</em></div>
      <i><span>30</span><span>50</span><span>70</span><strong style={{ left: `${clamp(rsiValue ?? 50, 0, 100)}%` }} /></i>
    </div>
    <div className="shares-readout"><span>{localized(locale, "流通股本", "SHARES OUT")}</span><b>{compact(shares)}</b></div>
  </div>;
}

function ExpectationVisual({ stock, currentPrice }: { stock: StockData; currentPrice: number | null | undefined }) {
  const locale = useLocale();
  const analyst = stock.analyst;
  const snapshot = stock.snapshot;
  const ratingParts = [
    { label: localized(locale, "强买", "STRONG BUY"), value: analyst?.strong_buy_count ?? 0, tone: "strong-buy" },
    { label: localized(locale, "买入", "BUY"), value: analyst?.buy_count ?? 0, tone: "buy" },
    { label: localized(locale, "持有", "HOLD"), value: analyst?.hold_count ?? 0, tone: "hold" },
    { label: localized(locale, "卖出", "SELL"), value: (analyst?.sell_count ?? 0) + (analyst?.strong_sell_count ?? 0), tone: "sell" },
  ];
  const ratingTotal = Math.max(ratingParts.reduce((sum, part) => sum + part.value, 0), 1);
  const targetLow = finite(analyst?.pt_low);
  const targetHigh = finite(analyst?.pt_high);
  const targetConsensus = finite(analyst?.pt_consensus);
  const price = finite(currentPrice);
  const targetCandidates = [targetLow, targetHigh, targetConsensus, price].filter((value): value is number => value != null);
  const targetMin = targetCandidates.length ? Math.min(...targetCandidates) : 0;
  const targetMax = targetCandidates.length ? Math.max(...targetCandidates) : 1;
  const targetRange = Math.max(targetMax - targetMin, .01);
  const targetPosition = (value: number | null) => `${clamp(((value ?? targetMin) - targetMin) / targetRange, 0, 1) * 100}%`;
  const earnings = stock.earnings.filter((event) => event.eps_actual != null && event.eps_estimated != null).slice(0, 4).reverse();
  const earningsScale = Math.max(...earnings.flatMap((event) => [Math.abs(event.eps_actual ?? 0), Math.abs(event.eps_estimated ?? 0)]), 1);
  const surpriseMetrics: ChartMetric[] = [
    { label: localized(locale, "EPS 最新", "LATEST EPS"), value: percent(snapshot?.latest_eps_surprise, 1), raw: snapshot?.latest_eps_surprise },
    { label: localized(locale, "营收最新", "LATEST REV"), value: percent(snapshot?.latest_revenue_surprise, 1), raw: snapshot?.latest_revenue_surprise },
    { label: localized(locale, "EPS 4Q均", "EPS 4Q AVG"), value: percent(snapshot?.avg_eps_surprise_last_4q, 1), raw: snapshot?.avg_eps_surprise_last_4q },
    { label: localized(locale, "营收4Q均", "REV 4Q AVG"), value: percent(snapshot?.avg_revenue_surprise_last_4q, 1), raw: snapshot?.avg_revenue_surprise_last_4q },
  ];

  return <div className="expectation-visual">
    <div className="rating-visual">
      <header><span>{localized(locale, "分析师分布", "ANALYST MIX")}</span><b>{analyst?.consensus ?? "—"} · {localized(locale, `${analyst?.total_analysts ?? 0} 位`, `${analyst?.total_analysts ?? 0} ANALYSTS`)}</b></header>
      <div className="rating-stack" aria-label={ratingParts.map((part) => `${part.label}${part.value}`).join("，")}>{ratingParts.map((part) => <i key={part.label} className={part.tone} style={{ width: `${part.value / ratingTotal * 100}%` }} />)}</div>
      <footer>{ratingParts.map((part) => <span key={part.label}><i className={part.tone} />{part.label} {part.value}</span>)}</footer>
    </div>
    <div className="target-range-visual" role="img" aria-label={localized(locale, `当前价 ${money(price)}，目标价区间 ${money(targetLow)} 到 ${money(targetHigh)}，共识 ${money(targetConsensus)}`, `Current ${money(price)}; target range ${money(targetLow)} to ${money(targetHigh)}; consensus ${money(targetConsensus)}`)}>
      <header><span>{localized(locale, "目标价格带", "PRICE TARGET RANGE")}</span><b className={valueTone(targetUpside(stock, price ?? undefined))}>{percent(targetUpside(stock, price ?? undefined), 0)}</b></header>
      <div><i /><strong className="current" style={{ left: targetPosition(price) }}>{localized(locale, "现", "NOW")}</strong><strong className="consensus" style={{ left: targetPosition(targetConsensus) }}>{localized(locale, "中", "MID")}</strong></div>
      <footer><span>{money(targetLow, 0)}</span><b>{money(price, 0)} {localized(locale, "当前", "NOW")}</b><span>{money(targetHigh, 0)}</span></footer>
    </div>
    <div className="earnings-mini-chart" role="img" aria-label={earnings.map((event) => localized(locale, `${shortDate(event.date)} EPS 实际 ${decimal(event.eps_actual)}，预期 ${decimal(event.eps_estimated)}`, `${shortDate(event.date)} EPS actual ${decimal(event.eps_actual)}, estimate ${decimal(event.eps_estimated)}`)).join(locale === "zh" ? "；" : "; ")}>
      <header><span>{localized(locale, "最近季度 EPS", "RECENT QUARTERLY EPS")}</span><b>{localized(locale, "实际 / 预期", "ACTUAL / EST")}</b></header>
      <div style={{ "--earnings-count": Math.max(earnings.length, 1) } as CSSProperties}>{earnings.map((event) => <i key={event.date}><span><em style={{ height: `${Math.abs(event.eps_estimated ?? 0) / earningsScale * 100}%` }} /><strong style={{ height: `${Math.abs(event.eps_actual ?? 0) / earningsScale * 100}%` }} /></span><small>{shortDate(event.date)}</small></i>)}</div>
    </div>
    <MetricBars metrics={surpriseMetrics} signed columns={2} />
    <div className="next-estimates"><span>{localized(locale, "下季 EPS", "NEXT-Q EPS")} <b>{decimal(snapshot?.next_q_eps_estimate_avg)}</b></span><span>{localized(locale, "下季营收", "NEXT-Q REV")} <b>{compact(snapshot?.next_q_revenue_estimate_avg)}</b></span><span>12Q EPS <b>{decimal(snapshot?.eps_beats_last_12q, 0)}{localized(locale, "胜", "W")}/{decimal(snapshot?.eps_misses_last_12q, 0)}{localized(locale, "负", "L")}</b></span><span>12Q {localized(locale, "营收", "REV")} <b>{decimal(snapshot?.revenue_beats_last_12q, 0)}{localized(locale, "胜", "W")}/{decimal(snapshot?.revenue_misses_last_12q, 0)}{localized(locale, "负", "L")}</b></span></div>
  </div>;
}

function FocusView({
  dashboard,
  stock,
  quote,
  quotes,
  intraday,
  signals,
  indices,
  quoteMove,
  liveAt,
}: {
  dashboard: DashboardPayload;
  stock: StockData;
  quote?: LiveQuote;
  quotes: Map<string, LiveQuote>;
  intraday: IntradayPayload | null;
  signals: SignalEvent[];
  indices: MarketIndex[];
  quoteMove?: number;
  liveAt?: string;
}) {
  const locale = useLocale();
  const snapshot = stock.snapshot;
  const relevantSignals = signals.filter((signal) => signal.tickers.includes(stock.ticker));
  const focusSignals = [...relevantSignals, ...signals.filter((signal) => !relevantSignals.includes(signal))].slice(0, 8);
  const bars = intraday?.ticker === stock.ticker ? intraday.bars : [];
  const last = bars.at(-1);
  const first = bars[0];
  const sessionChange = last && first ? (last.close - first.open) / first.open * 100 : null;
  const high = bars.length ? Math.max(...bars.map((bar) => bar.high)) : null;
  const low = bars.length ? Math.min(...bars.map((bar) => bar.low)) : null;
  const volume = bars.reduce((sum, bar) => sum + bar.volume, 0);

  const capitalRows: ChartMetric[] = [
    { label: localized(locale, "市值", "MARKET CAP"), value: compact(quote?.marketCap ?? snapshot?.market_capitalization), raw: quote?.marketCap ?? snapshot?.market_capitalization, note: "USD" },
    { label: localized(locale, "企业价值", "ENTERPRISE VALUE"), value: compact(snapshot?.enterprise_value), raw: snapshot?.enterprise_value, note: "EV" },
  ];
  const valuationRows: ChartMetric[] = [
    { label: "PE TTM", value: multiple(quote?.pe ?? snapshot?.pe_ratio_ttm), raw: quote?.pe ?? snapshot?.pe_ratio_ttm },
    { label: "PE FWD", value: multiple(snapshot?.pe_ratio_fwd), raw: snapshot?.pe_ratio_fwd },
    { label: "PE 2026", value: multiple(snapshot?.pe_calendar_2026), raw: snapshot?.pe_calendar_2026 },
    { label: "PE 2027", value: multiple(snapshot?.pe_calendar_2027), raw: snapshot?.pe_calendar_2027 },
    { label: "PE 2028", value: multiple(snapshot?.pe_calendar_2028), raw: snapshot?.pe_calendar_2028 },
    { label: "PEG", value: multiple(snapshot?.peg_ratio_ttm, 2), raw: snapshot?.peg_ratio_ttm },
    { label: "PB", value: multiple(snapshot?.pb_ratio_ttm), raw: snapshot?.pb_ratio_ttm },
    { label: "PS TTM", value: multiple(snapshot?.ps_ratio_ttm), raw: snapshot?.ps_ratio_ttm },
    { label: "PS FWD", value: multiple(snapshot?.ps_ratio_fwd), raw: snapshot?.ps_ratio_fwd },
    { label: "PCF", value: multiple(snapshot?.pcf_ratio_ttm), raw: snapshot?.pcf_ratio_ttm },
    { label: "EV/Sales", value: multiple(snapshot?.ev_to_sales_ttm), raw: snapshot?.ev_to_sales_ttm },
    { label: "EV/EBITDA", value: multiple(snapshot?.ev_to_ebitda_ttm), raw: snapshot?.ev_to_ebitda_ttm },
    { label: "EV/EBIT", value: multiple(snapshot?.ev_to_ebit_ttm), raw: snapshot?.ev_to_ebit_ttm },
    { label: localized(locale, "目标空间", "TARGET UPSIDE"), value: percent(targetUpside(stock, quote?.price), 1), raw: targetUpside(stock, quote?.price) },
  ];
  const qualityRows: ChartMetric[] = [
    { label: localized(locale, "毛利率", "GROSS MARGIN"), value: percent(snapshot?.gross_profit_margin_ttm, 1), raw: snapshot?.gross_profit_margin_ttm },
    { label: localized(locale, "EBIT率", "EBIT MARGIN"), value: percent(snapshot?.ebit_margin_ttm, 1), raw: snapshot?.ebit_margin_ttm },
    { label: localized(locale, "EBITDA率", "EBITDA MARGIN"), value: percent(snapshot?.ebitda_margin_ttm, 1), raw: snapshot?.ebitda_margin_ttm },
    { label: localized(locale, "净利率", "NET MARGIN"), value: percent(snapshot?.net_income_margin_ttm, 1), raw: snapshot?.net_income_margin_ttm },
    { label: localized(locale, "FCF率", "FCF MARGIN"), value: percent(snapshot?.fcf_margin_ttm, 1), raw: snapshot?.fcf_margin_ttm },
    { label: localized(locale, "Capex率", "CAPEX / SALES"), value: percent(snapshot?.capex_to_sales_ttm, 1), raw: snapshot?.capex_to_sales_ttm },
    { label: "ROE", value: percent(snapshot?.roe_ttm, 1), raw: snapshot?.roe_ttm },
    { label: "ROA", value: percent(snapshot?.roa_ttm, 1), raw: snapshot?.roa_ttm },
    { label: "ROIC", value: percent(snapshot?.roic_ttm, 1), raw: snapshot?.roic_ttm },
  ];
  const qualityReadouts = [
    { label: localized(locale, "资产周转", "ASSET TURNOVER"), value: multiple(snapshot?.asset_turnover_ttm, 2) },
    { label: localized(locale, "每股现金", "CASH / SHARE"), value: money(snapshot?.cash_per_share_ttm) },
    { label: localized(locale, "经营现金流", "OPERATING CASH"), value: compact(snapshot?.cash_from_operations_ttm) },
  ];
  const growthRows: ChartMetric[] = [
    { label: localized(locale, "营收 TTM", "REVENUE TTM"), value: percent(snapshot?.revenue_growth_ttm, 1), raw: snapshot?.revenue_growth_ttm },
    { label: "EBITDA TTM", value: percent(snapshot?.ebitda_growth_ttm, 1), raw: snapshot?.ebitda_growth_ttm },
    { label: "EBIT TTM", value: percent(snapshot?.ebit_growth_ttm, 1), raw: snapshot?.ebit_growth_ttm },
    { label: "EPS TTM", value: percent(snapshot?.eps_growth_ttm, 1), raw: snapshot?.eps_growth_ttm },
    { label: "FCF TTM", value: percent(snapshot?.fcf_growth_ttm, 1), raw: snapshot?.fcf_growth_ttm },
    { label: "OCF TTM", value: percent(snapshot?.ocf_growth_ttm, 1), raw: snapshot?.ocf_growth_ttm },
    { label: localized(locale, "营收 FWD", "REVENUE FWD"), value: percent(snapshot?.revenue_growth_fwd, 1), raw: snapshot?.revenue_growth_fwd },
    { label: "EBITDA FWD", value: percent(snapshot?.ebitda_growth_fwd, 1), raw: snapshot?.ebitda_growth_fwd },
    { label: "EPS FWD", value: percent(snapshot?.eps_growth_fwd, 1), raw: snapshot?.eps_growth_fwd },
    { label: localized(locale, "营收 CAGR3", "REVENUE CAGR3"), value: percent(snapshot?.revenue_cagr_3y, 1), raw: snapshot?.revenue_cagr_3y },
    { label: "EPS CAGR3", value: percent(snapshot?.eps_cagr_3y, 1), raw: snapshot?.eps_cagr_3y },
    { label: "FCF CAGR3", value: percent(snapshot?.fcf_cagr_3y, 1), raw: snapshot?.fcf_cagr_3y },
    { label: localized(locale, "营收 CAGR5", "REVENUE CAGR5"), value: percent(snapshot?.revenue_cagr_5y, 1), raw: snapshot?.revenue_cagr_5y },
    { label: "EPS CAGR5", value: percent(snapshot?.eps_cagr_5y, 1), raw: snapshot?.eps_cagr_5y },
    { label: "FCF CAGR5", value: percent(snapshot?.fcf_cagr_5y, 1), raw: snapshot?.fcf_cagr_5y },
  ];
  const leverageRows: ChartMetric[] = [
    { label: localized(locale, "负债/权益", "DEBT / EQUITY"), value: multiple(snapshot?.debt_to_equity, 2), raw: snapshot?.debt_to_equity },
    { label: localized(locale, "净债/权益", "NET DEBT / EQUITY"), value: multiple(snapshot?.net_debt_to_equity, 2), raw: snapshot?.net_debt_to_equity },
    { label: localized(locale, "负债/资产", "DEBT / ASSETS"), value: multiple(snapshot?.debt_to_assets, 2), raw: snapshot?.debt_to_assets },
    { label: localized(locale, "债务/EBITDA", "DEBT / EBITDA"), value: multiple(snapshot?.debt_to_ebitda, 2), raw: snapshot?.debt_to_ebitda },
    { label: localized(locale, "净债/EBITDA", "NET DEBT / EBITDA"), value: multiple(snapshot?.net_debt_to_ebitda, 2), raw: snapshot?.net_debt_to_ebitda },
  ];
  const liquidityRows: ChartMetric[] = [
    { label: localized(locale, "利息覆盖", "INTEREST COVER"), value: multiple(snapshot?.interest_coverage), raw: snapshot?.interest_coverage },
    { label: localized(locale, "流动比率", "CURRENT RATIO"), value: multiple(snapshot?.current_ratio, 2), raw: snapshot?.current_ratio },
    { label: localized(locale, "速动比率", "QUICK RATIO"), value: multiple(snapshot?.quick_ratio, 2), raw: snapshot?.quick_ratio },
  ];
  const shareholderRows: ChartMetric[] = [
    { label: localized(locale, "股息率", "DIVIDEND YIELD"), value: percent(snapshot?.dividend_yield_ttm, 2), raw: snapshot?.dividend_yield_ttm },
    { label: localized(locale, "派息率", "PAYOUT RATIO"), value: percent(snapshot?.payout_ratio_ttm, 1), raw: snapshot?.payout_ratio_ttm },
    { label: localized(locale, "股息1Y增", "DIVIDEND 1Y"), value: percent(snapshot?.dividend_growth_1y, 1), raw: snapshot?.dividend_growth_1y },
    { label: localized(locale, "股息CAGR3", "DIVIDEND CAGR3"), value: percent(snapshot?.dividend_cagr_3y, 1), raw: snapshot?.dividend_cagr_3y },
    { label: localized(locale, "股息CAGR5", "DIVIDEND CAGR5"), value: percent(snapshot?.dividend_cagr_5y, 1), raw: snapshot?.dividend_cagr_5y },
    { label: localized(locale, "每股股息", "DIVIDEND / SHARE"), value: money(snapshot?.dividend_rate_ttm), raw: snapshot?.dividend_rate_ttm },
  ];
  const returnRows: ChartMetric[] = [
    ["1D", snapshot?.price_return_1d], ["5D", snapshot?.price_return_5d], ["1M", snapshot?.price_return_1m],
    ["3M", snapshot?.price_return_3m], ["6M", snapshot?.price_return_6m], ["YTD", snapshot?.price_return_ytd],
    ["1Y", snapshot?.price_return_1y], ["3Y", snapshot?.price_return_3y], ["5Y", snapshot?.price_return_5y], ["10Y", snapshot?.price_return_10y],
  ].map(([label, value]) => ({ label: String(label), value: percent(value as number | null, 1), raw: value as number | null }));
  const technicalRows: ChartMetric[] = [
    { label: localized(locale, "距 SMA10", "VS SMA10"), value: percent(snapshot?.price_vs_sma_10d, 1), raw: snapshot?.price_vs_sma_10d, note: money(snapshot?.sma_10_day) },
    { label: localized(locale, "距 SMA50", "VS SMA50"), value: percent(snapshot?.price_vs_sma_50d, 1), raw: snapshot?.price_vs_sma_50d, note: money(snapshot?.sma_50_day) },
    { label: localized(locale, "距 SMA100", "VS SMA100"), value: percent(snapshot?.price_vs_sma_100d, 1), raw: snapshot?.price_vs_sma_100d, note: money(snapshot?.sma_100_day) },
    { label: localized(locale, "距 SMA200", "VS SMA200"), value: percent(snapshot?.price_vs_sma_200d, 1), raw: snapshot?.price_vs_sma_200d, note: money(snapshot?.sma_200_day) },
  ];

  return <div className="focus-layout">
    <FocusSummary stock={stock} quote={quote} signalCount={relevantSignals.length} quoteMove={quoteMove} liveAt={liveAt} />
    <section className="price-panel practical-panel">
      <PanelHeader eyebrow="PRICE ACTION" title={localized(locale, "最新交易日 K 线", "Latest-session candlesticks")} meta={intraday ? `${intraday.sessionDate} · 1M→5M` : "LOADING"} />
      <IntradayChart key={stock.ticker} bars={bars} fallback={stock.history} ticker={stock.ticker} />
      <div className="price-stats">
        <span>{localized(locale, "开盘", "OPEN")} <b>{money(first?.open)}</b></span>
        <span>{localized(locale, "最高", "HIGH")} <b>{money(high)}</b></span>
        <span>{localized(locale, "最低", "LOW")} <b>{money(low)}</b></span>
        <span>{localized(locale, "收盘", "CLOSE")} <b>{money(last?.close)}</b></span>
        <span>{localized(locale, "日内", "SESSION")} <b className={valueTone(sessionChange)}>{percent(sessionChange)}</b></span>
        <span>{localized(locale, "成交", "VOLUME")} <b>{compact(volume)}</b></span>
      </div>
    </section>
    <section className="focus-signal-panel practical-panel">
      <PanelHeader eyebrow="WHAT CHANGED" title={localized(locale, "实时事件与催化剂", "Live events & catalysts")} meta={`${relevantSignals.length} MATCH / 60S`} />
      <SignalList signals={focusSignals} limit={8} />
    </section>
    <section className="focus-market-panel practical-panel">
      <PanelHeader eyebrow="MARKET CONTEXT" title={localized(locale, "市场与自选横截面", "Market & watchlist context")} meta="30S" />
      <div className="focus-index-tape">{indices.slice(0, 6).map((index) => <div key={index.index_ticker}><span>{index.index_ticker}</span><b>{index.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b><em className={valueTone(index.change_pct)}>{percent(index.change_pct, 1)}</em></div>)}</div>
      <div className="focus-peer-tape">{dashboard.stocks.map((peer) => { const peerQuote = quotes.get(peer.ticker); return <div key={peer.ticker}><b>{peer.ticker}</b><span>{money(peerQuote?.price ?? peer.snapshot?.price_current)}</span><em className={valueTone(peerQuote?.changesPercentage ?? peer.snapshot?.price_return_1d)}>{percent(peerQuote?.changesPercentage ?? peer.snapshot?.price_return_1d, 1)}</em><small>PE {decimal(peer.snapshot?.pe_ratio_ttm, 1)} · RSI {decimal(peer.snapshot?.rsi_14_day, 0)}</small></div>; })}</div>
    </section>
    <section className="focus-intelligence-grid" aria-label={localized(locale, "Drillr 图表化公司情报矩阵", "Drillr visual company-intelligence matrix")}>
      <VisualDataPanel className="valuation-panel" eyebrow="VALUATION SPECTRUM" title={localized(locale, "估值倍率谱", "Valuation spectrum")} meta="16 MARKS" points={capitalRows.length + valuationRows.length}>
        <div className="valuation-visual-body"><MetricBars metrics={capitalRows} /><MetricBars metrics={valuationRows} /></div>
      </VisualDataPanel>
      <VisualDataPanel className="quality-panel" eyebrow="ECONOMIC QUALITY" title={localized(locale, "盈利与资本效率", "Earnings & capital efficiency")} meta="12 MARKS" points={qualityRows.length + qualityReadouts.length}>
        <div className="quality-visual-body"><MetricBars metrics={qualityRows} signed columns={2} /><div className="quality-readouts">{qualityReadouts.map((item) => <span key={item.label}><small>{item.label}</small><b>{item.value}</b></span>)}</div></div>
      </VisualDataPanel>
      <VisualDataPanel className="growth-panel" eyebrow="GROWTH VECTOR" title={localized(locale, "增长方向与持续性", "Growth direction & durability")} meta="15 BARS" points={growthRows.length}>
        <MetricBars metrics={growthRows} signed columns={2} />
      </VisualDataPanel>
      <VisualDataPanel className="returns-panel" eyebrow="RETURN SURFACE" title={localized(locale, "多周期收益热力", "Multi-period return heatmap")} meta="10 WINDOWS" points={returnRows.length}>
        <ReturnHeatmap metrics={returnRows} />
      </VisualDataPanel>
      <VisualDataPanel className="technical-panel" eyebrow="TREND POSITION" title={localized(locale, "均线位置与动量", "Moving averages & momentum")} meta="10 MARKS" points={10}>
        <TechnicalVisual metrics={technicalRows} rsi={snapshot?.rsi_14_day} shares={snapshot?.shares_outstanding} />
      </VisualDataPanel>
      <VisualDataPanel className="expectation-panel" eyebrow="EXPECTATION MAP" title={localized(locale, "共识、目标与兑现", "Consensus, targets & delivery")} meta="24 MARKS" points={24}>
        <ExpectationVisual stock={stock} currentPrice={quote?.price ?? snapshot?.price_current} />
      </VisualDataPanel>
      <VisualDataPanel className="balance-panel" eyebrow="BALANCE & PAYOUT" title={localized(locale, "杠杆、流动性与股东回报", "Leverage, liquidity & shareholder returns")} meta="14 BARS" points={leverageRows.length + liquidityRows.length + shareholderRows.length}>
        <div className="balance-visual-body"><div className="balance-ratio-groups"><MetricBars metrics={leverageRows} signed scale={5} /><MetricBars metrics={liquidityRows} scale={20} /></div><MetricBars metrics={shareholderRows} signed /></div>
      </VisualDataPanel>
    </section>
  </div>;
}

function stockAttention(stock: StockData, quote: LiveQuote | undefined, signalCount: number, locale: Locale) {
  const move = quote?.changesPercentage ?? stock.snapshot?.price_return_1d ?? 0;
  const extended = quote?.postMarketChangePercent ?? stock.extended?.after_change_rate ?? 0;
  if (Math.abs(move) >= 3) return localized(locale, "日内显著波动", "SIGNIFICANT DAY MOVE");
  if (Math.abs(extended) >= 1.5) return localized(locale, "盘后价格活跃", "ACTIVE AFTER HOURS");
  if (signalCount > 0) return localized(locale, `${signalCount} 条相关信号`, `${signalCount} RELATED SIGNALS`);
  return localized(locale, "暂无异常变化", "NO UNUSUAL CHANGE");
}

function RadarWatchlist({
  stocks,
  quotes,
  signals,
  quoteMoves,
  onSelect,
}: {
  stocks: StockData[];
  quotes: Map<string, LiveQuote>;
  signals: SignalEvent[];
  quoteMoves: Record<string, number>;
  onSelect: (ticker: string) => void;
}) {
  const locale = useLocale();
  const ranked = [...stocks].sort((a, b) => Math.abs(quotes.get(b.ticker)?.changesPercentage ?? b.snapshot?.price_return_1d ?? 0) - Math.abs(quotes.get(a.ticker)?.changesPercentage ?? a.snapshot?.price_return_1d ?? 0));
  return <section className="radar-watchlist practical-panel"><PanelHeader eyebrow="WATCHLIST RADAR" title={localized(locale, "高密度自选扫描器", "High-density watchlist scanner")} meta="14 METRICS · CLICK TO FOCUS" /><div className="screener-head"><span>{localized(locale, "标的", "SYMBOL")}</span><span>{localized(locale, "实时报价", "LIVE PRICE")}</span><span>{localized(locale, "18D趋势", "18D TREND")}</span><span>{localized(locale, "多周期收益", "RETURNS")}</span><span>{localized(locale, "估值与动量", "VALUATION & MOMENTUM")}</span><span>{localized(locale, "扩展交易", "EXTENDED HOURS")}</span><span>{localized(locale, "状态", "STATUS")}</span></div><div className="radar-stock-list">
    {ranked.map((stock, index) => {
      const quote = quotes.get(stock.ticker);
      const move = quote?.changesPercentage ?? stock.snapshot?.price_return_1d;
      const stockSignals = signals.filter((signal) => signal.tickers.includes(stock.ticker)).length;
      return <button type="button" key={stock.ticker} data-moved={quoteMoves[stock.ticker] ? "true" : "false"} onClick={() => onSelect(stock.ticker)}>
        <span className="radar-symbol"><b>{stock.ticker}</b><em>{String(index + 1).padStart(2, "0")} · {localizedCompanyName(stock, locale, quote)}</em></span>
        <span className="radar-quote-pack"><b>{money(quote?.price ?? stock.snapshot?.price_current)}</b><em className={valueTone(move)}>{percent(move, 1)} {localized(locale, "日内", "DAY")}</em></span>
        <MiniSparkline values={stock.history.map((bar) => bar.close).slice(-18)} tone={valueTone(move)} />
        <span className="radar-metric-pack">
          <i><small>5D</small><b className={valueTone(stock.snapshot?.price_return_5d)}>{percent(stock.snapshot?.price_return_5d, 1)}</b></i>
          <i><small>1M</small><b className={valueTone(stock.snapshot?.price_return_1m)}>{percent(stock.snapshot?.price_return_1m, 1)}</b></i>
          <i><small>YTD</small><b className={valueTone(stock.snapshot?.price_return_ytd)}>{percent(stock.snapshot?.price_return_ytd, 1)}</b></i>
        </span>
        <span className="radar-metric-pack">
          <i><small>PE</small><b>{decimal(stock.snapshot?.pe_ratio_ttm, 1)}</b></i>
          <i><small>RSI</small><b>{decimal(stock.snapshot?.rsi_14_day, 0)}</b></i>
          <i><small>{localized(locale, "目标", "TARGET")}</small><b className={valueTone(targetUpside(stock, quote?.price))}>{percent(targetUpside(stock, quote?.price), 0)}</b></i>
        </span>
        <span className="radar-metric-pack">
          <i><small>{localized(locale, "盘前", "PRE")}</small><b className={valueTone(quote?.preMarketChangePercent ?? stock.extended?.pre_change_rate)}>{percent(quote?.preMarketChangePercent ?? stock.extended?.pre_change_rate, 1)}</b></i>
          <i><small>{localized(locale, "盘后", "POST")}</small><b className={valueTone(quote?.postMarketChangePercent ?? stock.extended?.after_change_rate)}>{percent(quote?.postMarketChangePercent ?? stock.extended?.after_change_rate, 1)}</b></i>
          <i><small>{localized(locale, "信号", "SIGNALS")}</small><b>{stockSignals}</b></i>
        </span>
        <span className="radar-attention"><i className={Math.abs(move ?? 0) >= 3 ? "hot" : ""} /><b>{stockAttention(stock, quote, stockSignals, locale)}</b></span>
      </button>;
    })}
  </div></section>;
}

function RadarCrossSection({ stocks, quotes, indices }: { stocks: StockData[]; quotes: Map<string, LiveQuote>; indices: MarketIndex[] }) {
  const locale = useLocale();
  return <section className="radar-cross-panel practical-panel"><PanelHeader eyebrow="CROSS SECTION" title={localized(locale, "指数与基本面横截面", "Indices & fundamentals")} meta={`${indices.length} INDEX · ${stocks.length * 8} STOCK POINTS`} />
    <div className="radar-index-strip">{indices.slice(0, 6).map((index) => <div key={index.index_ticker}><span>{index.index_ticker}</span><b>{index.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b><em className={valueTone(index.change_pct)}>{percent(index.change_pct, 1)}</em></div>)}</div>
    <div className="cross-table"><div className="cross-head"><span>{localized(locale, "标的", "SYMBOL")}</span><span>{localized(locale, "毛利", "GROSS")}</span><span>{localized(locale, "净利", "NET")}</span><span>{localized(locale, "营收增", "REV GROWTH")}</span><span>{localized(locale, "EPS增", "EPS GROWTH")}</span><span>ROIC</span><span>{localized(locale, "负债", "DEBT")}</span><span>PE FWD</span><span>{localized(locale, "目标空间", "TARGET UPSIDE")}</span></div>{stocks.map((stock) => <div key={stock.ticker}><b>{stock.ticker}</b><span>{percent(stock.snapshot?.gross_profit_margin_ttm, 0)}</span><span>{percent(stock.snapshot?.net_income_margin_ttm, 0)}</span><span className={valueTone(stock.snapshot?.revenue_growth_ttm)}>{percent(stock.snapshot?.revenue_growth_ttm, 0)}</span><span className={valueTone(stock.snapshot?.eps_growth_fwd)}>{percent(stock.snapshot?.eps_growth_fwd, 0)}</span><span>{percent(stock.snapshot?.roic_ttm, 0)}</span><span>{multiple(stock.snapshot?.debt_to_equity, 1)}</span><span>{multiple(stock.snapshot?.pe_ratio_fwd, 1)}</span><span className={valueTone(targetUpside(stock, quotes.get(stock.ticker)?.price))}>{percent(targetUpside(stock, quotes.get(stock.ticker)?.price), 0)}</span></div>)}</div>
  </section>;
}

function RadarCoverage({ dashboard }: { dashboard: DashboardPayload }) {
  const locale = useLocale();
  return <section className="radar-coverage-panel practical-panel"><PanelHeader eyebrow="DRILLR UNIVERSE" title={localized(locale, `${dashboard.capabilities.structuredFieldCount} 字段 · ${dashboard.capabilities.altTableCount} 另类表`, `${dashboard.capabilities.structuredFieldCount} FIELDS · ${dashboard.capabilities.altTableCount} ALT TABLES`)} meta="LIVE CATALOG" /><div className="coverage-columns"><div>{dashboard.capabilities.schemaGroups.slice(0, 10).map((group) => <span key={group.label}><b>{locale === "zh" ? group.label : SCHEMA_LABELS_EN[group.label] ?? group.label}</b><em>{group.count}F</em></span>)}</div><div>{dashboard.capabilities.altCategories.slice(0, 10).map((category) => <span key={category.category}><b>{locale === "zh" ? category.label : category.category}</b><em>{category.count}T</em></span>)}</div></div></section>;
}

function RadarView({ dashboard, quotes, signals, indices, quoteMoves, onSelect }: { dashboard: DashboardPayload; quotes: Map<string, LiveQuote>; signals: SignalEvent[]; indices: MarketIndex[]; quoteMoves: Record<string, number>; onSelect: (ticker: string) => void }) {
  const locale = useLocale();
  const stocks = dashboard.stocks;
  return <div className="radar-layout">
    <RadarWatchlist stocks={stocks} quotes={quotes} signals={signals} quoteMoves={quoteMoves} onSelect={onSelect} />
    <section className="radar-signal-panel practical-panel"><PanelHeader eyebrow="LIVE INTELLIGENCE" title={localized(locale, "自选股事件流", "Watchlist event stream")} meta="10 ITEMS · 60S" /><SignalList signals={signals} limit={10} emptyText={localized(locale, "自选股暂时没有新增事件", "No new watchlist events yet")} /></section>
    <RadarCrossSection stocks={stocks} quotes={quotes} indices={indices} />
    <RadarCoverage dashboard={dashboard} />
  </div>;
}

export function DrillrDashboard() {
  const [locale, setLocale] = useState<Locale>("en");
  const [localeReady, setLocaleReady] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [intraday, setIntraday] = useState<IntradayPayload | null>(null);
  const [freshSignals, setFreshSignals] = useState<SignalsPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("focus");
  const [selectedTicker, setSelectedTicker] = useState("");
  const [quoteMoves, setQuoteMoves] = useState<Record<string, number>>({});
  const localeRef = useRef<Locale>("en");
  const previousQuotes = useRef<Record<string, number>>({});
  const liveRefreshes = useRef(0);
  const signalRefreshes = useRef(0);
  const chartRefreshes = useRef(0);
  const [livePulse, setLivePulse] = useState(-1);
  const [signalPulse, setSignalPulse] = useState(-1);
  const [chartPulse, setChartPulse] = useState(-1);
  const [adminOpen, setAdminOpen] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [newName, setNewName] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [signInHref, setSignInHref] = useState("");
  const [saving, setSaving] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoadError("");
    try {
      const requestLocale = localeRef.current;
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const payload = (await response.json()) as DashboardPayload | DashboardError;
      if (!response.ok || !payload.ok) throw new Error(requestLocale === "zh" && !payload.ok ? payload.error : localized(requestLocale, "真实数据请求失败", "Unable to load real market data"));
      setDashboard(payload);
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("ticker")?.toUpperCase();
      const requestedView = params.get("view");
      const validTicker = payload.stocks.some((stock) => stock.ticker === requested);
      setSelectedTicker((current) => payload.stocks.some((stock) => stock.ticker === current) ? current : validTicker && requested ? requested : payload.stocks[0]?.ticker ?? "");
      if (requestedView === "radar") setViewMode("radar");
    } catch (error) {
      const requestLocale = localeRef.current;
      setLoadError(error instanceof Error ? error.message : localized(requestLocale, "真实数据源暂时不可用", "The real data source is temporarily unavailable"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLive = useCallback(async () => {
    try {
      const requestLocale = localeRef.current;
      const response = await fetch("/api/live", { cache: "no-store" });
      const payload = (await response.json()) as LivePayload | ApiError;
      if (!response.ok || !payload.ok) {
        const detail = "error" in payload ? payload.error : undefined;
        throw new Error(requestLocale === "zh" ? detail ?? "实时报价请求失败" : "Unable to load live quotes");
      }
      const nextMoves: Record<string, number> = {};
      for (const quote of payload.quotes) {
        const previous = previousQuotes.current[quote.symbol];
        nextMoves[quote.symbol] = previous == null ? 0 : quote.price - previous;
        previousQuotes.current[quote.symbol] = quote.price;
      }
      setQuoteMoves({});
      window.requestAnimationFrame(() => setQuoteMoves(nextMoves));
      setLive(payload);
      if (liveRefreshes.current > 0) setLivePulse((current) => current === 0 ? 1 : 0);
      liveRefreshes.current += 1;
      setLiveError("");
    } catch (error) {
      const requestLocale = localeRef.current;
      setLiveError(error instanceof Error ? error.message : localized(requestLocale, "实时报价暂时不可用", "Live quotes are temporarily unavailable"));
    }
  }, []);

  const loadSignals = useCallback(async () => {
    try {
      const response = await fetch("/api/signals", { cache: "no-store" });
      const payload = (await response.json()) as SignalsPayload | ApiError;
      if (response.ok && payload.ok) {
        setFreshSignals(payload);
        if (signalRefreshes.current > 0) setSignalPulse((current) => current === 0 ? 1 : 0);
        signalRefreshes.current += 1;
      }
    } catch {
      // The dashboard's last good signal payload remains visible.
    }
  }, []);

  const loadIntraday = useCallback(async (ticker: string) => {
    if (!ticker) return;
    setIntraday((current) => current?.ticker === ticker ? current : null);
    try {
      const response = await fetch(`/api/intraday?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
      const payload = (await response.json()) as IntradayPayload | ApiError;
      if (response.ok && payload.ok) {
        setIntraday(payload);
        if (chartRefreshes.current > 0) setChartPulse((current) => current === 0 ? 1 : 0);
        chartRefreshes.current += 1;
      }
    } catch {
      // Daily history remains as an explicit fallback in the chart.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("lang");
      const stored = window.localStorage.getItem("drillr-locale");
      const nextLocale: Locale = requested === "zh" || requested === "en"
        ? requested
        : stored === "zh" || stored === "en"
          ? stored
          : navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
      localeRef.current = nextLocale;
      setLocale(nextLocale);
      document.documentElement.lang = nextLocale === "zh" ? "zh-CN" : "en";
      setLocaleReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!localeReady) return;
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard, localeReady]);

  useEffect(() => {
    if (!localeReady) return;
    const timer = window.setTimeout(() => void loadLive(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadLive();
    }, 30_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [loadLive, localeReady]);

  useEffect(() => {
    if (!localeReady) return;
    const timer = window.setTimeout(() => void loadSignals(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadSignals();
    }, 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [loadSignals, localeReady]);

  useEffect(() => {
    if (!localeReady || !selectedTicker) return;
    const timer = window.setTimeout(() => void loadIntraday(selectedTicker), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadIntraday(selectedTicker);
    }, 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [loadIntraday, localeReady, selectedTicker]);

  function syncUrl(ticker: string, view: ViewMode) {
    const url = new URL(window.location.href);
    url.searchParams.set("ticker", ticker);
    url.searchParams.set("view", view);
    window.history.replaceState(null, "", url);
  }

  function selectTicker(ticker: string) {
    setIntraday(null);
    setSelectedTicker(ticker);
    setViewMode("focus");
    syncUrl(ticker, "focus");
  }

  function changeView(view: ViewMode) {
    setViewMode(view);
    syncUrl(selectedTicker, view);
  }

  function changeLocale(nextLocale: Locale) {
    localeRef.current = nextLocale;
    setLocale(nextLocale);
    window.localStorage.setItem("drillr-locale", nextLocale);
    document.documentElement.lang = nextLocale === "zh" ? "zh-CN" : "en";
    const url = new URL(window.location.href);
    url.searchParams.set("lang", nextLocale);
    window.history.replaceState(null, "", url);
  }

  async function addStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setAdminMessage("");
    setSignInHref("");
    try {
      const response = await fetch("/api/stocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: newTicker, name: newName }) });
      const payload = (await response.json()) as { stocks?: StockOption[]; error?: string; signIn?: string };
      if (!response.ok) {
        setAdminMessage(locale === "zh" ? payload.error ?? "暂时无法保存。" : "Unable to save the watchlist right now.");
        if (payload.signIn) setSignInHref(payload.signIn);
        return;
      }
      setNewTicker("");
      setNewName("");
      setAdminMessage(localized(locale, "已加入自选，正在读取真实数据。", "Added to the watchlist. Loading real data."));
      await Promise.all([loadDashboard(), loadLive(), loadSignals()]);
    } catch {
      setAdminMessage(localized(locale, "网络暂时不可用。", "The network is temporarily unavailable."));
    } finally {
      setSaving(false);
    }
  }

  async function removeStock(ticker: string) {
    setSaving(true);
    setAdminMessage("");
    setSignInHref("");
    try {
      const response = await fetch(`/api/stocks?ticker=${encodeURIComponent(ticker)}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string; signIn?: string };
      if (!response.ok) {
        setAdminMessage(locale === "zh" ? payload.error ?? "暂时无法删除。" : "Unable to remove this stock right now.");
        if (payload.signIn) setSignInHref(payload.signIn);
        return;
      }
      setAdminMessage(localized(locale, `${ticker} 已移除。`, `${ticker} was removed.`));
      await Promise.all([loadDashboard(), loadLive(), loadSignals()]);
    } catch {
      setAdminMessage(localized(locale, "网络暂时不可用。", "The network is temporarily unavailable."));
    } finally {
      setSaving(false);
    }
  }

  const quotes = useMemo(() => new Map((live?.quotes ?? []).map((quote) => [quote.symbol, quote])), [live]);
  const signals = freshSignals?.signals ?? dashboard?.signals ?? [];
  const indices = live?.indices.length ? live.indices : dashboard?.indices ?? [];
  const selectedStock = dashboard?.stocks.find((stock) => stock.ticker === selectedTicker) ?? dashboard?.stocks[0];

  if (!dashboard && loading) return <main className="boot-screen" data-locale={locale}><div className="boot-grid" aria-hidden="true" /><div className="boot-core"><span>drillr</span><i /><b>BUILDING YOUR MARKET VIEW</b></div><p>{localized(locale, "正在连接自选股、实时报价、分钟 K 线和事件信号", "Connecting watchlist, live quotes, intraday candles and event signals")}</p><div className="boot-progress"><i /></div></main>;
  if (!dashboard || !selectedStock) return <main className="error-screen" data-locale={locale}><span>DATA SOURCE OFFLINE</span><h1>{loadError || localized(locale, "真实数据源暂时不可用", "The real data source is temporarily unavailable")}</h1><p>{localized(locale, "页面没有切换到模拟数据。恢复 Drillr Gateway 后即可继续。", "The dashboard did not fall back to mock data. Restore the Drillr Gateway connection to continue.")}</p><button type="button" onClick={() => loadDashboard()}>{localized(locale, "重新连接", "RECONNECT")}</button></main>;

  return (
    <LocaleContext.Provider value={locale}><main className="market-terminal" data-locale={locale} data-view={viewMode} data-admin-open={adminOpen ? "true" : "false"} data-live-phase={livePulse} data-signal-phase={signalPulse} data-chart-phase={chartPulse}>
      <header className="terminal-topbar">
        <div className="terminal-brand"><span>drillr</span><div><b>{localized(locale, "高密度实时自选驾驶舱", "High-density real-time market cockpit")}</b><small>{dashboard.capabilities.structuredFieldCount} FIELDS · {dashboard.capabilities.altTableCount} ALT TABLES</small></div></div>
        <nav className="view-switch" aria-label={localized(locale, "视图模式", "View mode")}>
          <button type="button" className={viewMode === "focus" ? "active" : ""} onClick={() => changeView("focus")}><i />{localized(locale, "单股聚焦", "STOCK FOCUS")}</button>
          <button type="button" className={viewMode === "radar" ? "active" : ""} onClick={() => changeView("radar")}><i />{localized(locale, "自选雷达", "WATCHLIST RADAR")}</button>
        </nav>
        <div className="terminal-health"><span className={liveError ? "degraded" : "connected"}><i />{liveError ? "LIVE DEGRADED" : "DRILLR CONNECTED"}</span><div className="locale-switch" role="group" aria-label={localized(locale, "界面语言", "Interface language")}><button type="button" className={locale === "zh" ? "active" : ""} aria-pressed={locale === "zh"} onClick={() => changeLocale("zh")}>中</button><button type="button" className={locale === "en" ? "active" : ""} aria-pressed={locale === "en"} onClick={() => changeLocale("en")}>EN</button></div><LiveClock /></div>
      </header>

      <WatchStrip stocks={dashboard.stocks} quotes={quotes} selectedTicker={selectedStock.ticker} quoteMoves={quoteMoves} onSelect={selectTicker} onManage={() => setAdminOpen(true)} />

      <section className="terminal-workspace">
        {viewMode === "focus"
          ? <FocusView dashboard={dashboard} stock={selectedStock} quote={quotes.get(selectedStock.ticker)} quotes={quotes} intraday={intraday} signals={signals} indices={indices} quoteMove={quoteMoves[selectedStock.ticker]} liveAt={live?.fetchedAt} />
          : <RadarView dashboard={dashboard} quotes={quotes} signals={signals} indices={indices} quoteMoves={quoteMoves} onSelect={selectTicker} />}
      </section>

      <footer className="terminal-statusbar">
        <div><RefreshStamp label="QUOTE" value={live?.fetchedAt} cadence="30S CHECK / 3M SOURCE" /><RefreshStamp label="CHART" value={intraday?.fetchedAt} cadence="60S" /><RefreshStamp label="SIGNAL" value={freshSignals?.fetchedAt} cadence="60S" /></div>
        <span className={dashboard.stale || dashboard.partial ? "negative" : "positive"}>{dashboard.stale ? "STALE CACHE" : dashboard.partial ? "PARTIAL CORE" : "200+ VISUAL MARKS · REAL DATA · NO MOCK"}</span>
      </footer>

      {adminOpen && <div className="admin-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdminOpen(false); }}><section className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <div className="admin-head"><div><span>WATCHLIST SETTINGS</span><h2 id="admin-title">{localized(locale, "管理自选股票", "Manage watchlist")}</h2></div><button type="button" aria-label={localized(locale, "关闭", "Close")} onClick={() => setAdminOpen(false)}>×</button></div>
        <p className="admin-copy">{localized(locale, "最多保留 6 只股票用于雷达扫描。单股聚焦页会把一分钟行情聚合为可交互五分钟 K 线，并加载盘前盘后、关键指标和相关事件。", "Keep up to six stocks in the radar. Stock focus aggregates one-minute data into interactive five-minute candles and adds extended-hours prices, key metrics and related events.")}</p>
        <div className="admin-stock-list">{dashboard.stocks.map((stock, index) => <div key={stock.ticker}><span>{String(index + 1).padStart(2, "0")}</span><b>{stock.ticker}</b><em>{localizedCompanyName(stock, locale, quotes.get(stock.ticker))}</em><button type="button" disabled={saving || dashboard.stocks.length <= 1} onClick={() => removeStock(stock.ticker)}>{localized(locale, "移除", "REMOVE")}</button></div>)}</div>
        <form onSubmit={addStock} className="admin-form"><label><span>{localized(locale, "股票代码", "SYMBOL")}</span><input value={newTicker} onChange={(event) => setNewTicker(event.target.value.toUpperCase())} placeholder="MSFT" maxLength={10} required /></label><label><span>{localized(locale, "公司名称", "COMPANY NAME")}</span><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={localized(locale, "微软", "Microsoft")} maxLength={40} required /></label><button type="submit" disabled={saving || dashboard.stocks.length >= 6}>{dashboard.stocks.length >= 6 ? localized(locale, "已达到上限", "LIMIT REACHED") : saving ? localized(locale, "读取真实数据中…", "LOADING REAL DATA…") : localized(locale, "加入自选", "ADD TO WATCHLIST")}</button></form>
        {adminMessage && <p className="admin-message">{adminMessage}</p>}{signInHref && <a className="admin-signin" href={signInHref}>{localized(locale, "登录管理员身份", "ADMINISTRATOR SIGN-IN")} <span>↗</span></a>}
      </section></div>}
    </main></LocaleContext.Provider>
  );
}

"use client";

import {
  type FormEvent,
  useCallback,
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
type ApiError = { ok?: false; error?: string; detail?: string };

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

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  return new Intl.DateTimeFormat("zh-CN", {
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

function sessionLabel() {
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
  if (weekday === "Sat" || weekday === "Sun") return "休市";
  if (total >= 570 && total < 960) return "交易中";
  if (total >= 240 && total < 570) return "盘前";
  if (total >= 960 && total < 1200) return "盘后";
  return "休市";
}

function LiveClock() {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const update = () => setClock(new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <span className="live-clock"><b>{sessionLabel()}</b><em>{clock} CST</em></span>;
}

function RefreshStamp({ label, value, cadence }: { label: string; value?: string; cadence: string }) {
  return <span className="refresh-stamp"><i />{label}<b>{value ? dateTime(value) : "等待"}</b><em>{cadence}</em></span>;
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
  const usingMinute = bars.length > 1;
  const sourcePoints = usingMinute
    ? bars.map((bar) => ({ date: bar.date, open: bar.open, close: bar.close, high: bar.high, low: bar.low, volume: bar.volume }))
    : fallback.map((bar) => ({ date: bar.period_end, open: bar.open, close: bar.close, high: bar.high, low: bar.low, volume: bar.volume }));
  const points = aggregateCandles(sourcePoints, usingMinute ? 5 : 1);
  const [selectedIndex, setSelectedIndex] = useState(Math.max(points.length - 1, 0));
  const [pointerActive, setPointerActive] = useState(false);

  if (points.length < 2) return <div className="chart-empty">暂无可用价格序列</div>;

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
        aria-label={`${ticker} ${usingMinute ? "五分钟" : "日线"} K 线，可移动鼠标查看每根 K 线的开高低收和成交量`}
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
        <p><span>开 {money(activePoint.open)}</span><span>高 {money(activePoint.high)}</span><span>低 {money(activePoint.low)}</span><span>收 {money(activePoint.close)}</span></p>
        <small>成交量 {compact(activePoint.volume)}</small>
      </div>}
      <div className="chart-interaction-row">
        <div className="chart-axis"><span>{usingMinute ? points[0].date.slice(11, 16) : shortDate(points[0].date)}</span><b>拖动查看 · {usingMinute ? "5 MIN K" : "DAILY K"}</b><span>{usingMinute ? points.at(-1)!.date.slice(11, 16) : shortDate(points.at(-1)!.date)}</span></div>
        <input
          className="chart-scrubber"
          type="range"
          min="0"
          max={points.length - 1}
          value={activeIndex}
          onChange={(event) => { setPointerActive(true); setSelectedIndex(Number(event.target.value)); }}
          onBlur={() => setPointerActive(false)}
          aria-label={`${ticker} 价格序列时间点`}
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
  return (
    <nav className="watch-strip" aria-label="自选股票快速切换">
      <div className="watch-label"><span>WATCHLIST</span><b>{stocks.length}/6</b></div>
      <div className="watch-items">
        {stocks.map((stock) => {
          const quote = quotes.get(stock.ticker);
          const change = quote?.changesPercentage ?? stock.snapshot?.price_return_1d;
          return <button type="button" className={selectedTicker === stock.ticker ? "active" : ""} data-moved={quoteMoves[stock.ticker] ? "true" : "false"} key={stock.ticker} onClick={() => onSelect(stock.ticker)}>
            <span><b>{stock.ticker}</b><small>{stock.name}</small></span>
            <strong>{money(quote?.price ?? stock.snapshot?.price_current)}</strong>
            <em className={valueTone(change)}>{percent(change)}</em>
            <i className={valueTone(quoteMoves[stock.ticker])}>{quoteMoves[stock.ticker] ? (quoteMoves[stock.ticker] > 0 ? "↗" : "↘") : "·"}</i>
          </button>;
        })}
      </div>
      <button type="button" className="manage-watch" onClick={onManage}><span>编辑自选</span><b>＋</b></button>
    </nav>
  );
}

function FocusSummary({ stock, quote, signalCount, quoteMove, liveAt }: { stock: StockData; quote?: LiveQuote; signalCount: number; quoteMove?: number; liveAt?: string }) {
  const price = quote?.price ?? stock.snapshot?.price_current;
  const dayMove = quote?.changesPercentage ?? stock.snapshot?.price_return_1d;
  const companyName = quote?.name ?? stock.snapshot?.company_name ?? stock.name;
  return (
    <section className="focus-summary practical-panel" data-moved={quoteMove ? "true" : "false"}>
      <div className="focus-identity">
        <span>SELECTED EQUITY</span>
        <div><h1>{stock.ticker}</h1><p>{companyName}</p></div>
        <small>{stock.snapshot?.exchange ?? stock.market} · {stock.snapshot?.sector ?? "—"}</small>
      </div>
      <div className="hero-price">
        <span>最新价</span>
        <strong>{money(price)}</strong>
        <div className={valueTone(dayMove)}><b>{percent(dayMove)}</b><em>{quote ? (quote.change >= 0 ? "+" : "") + money(quote.change).replace("$", "$") : "日内"}</em></div>
      </div>
      <div className="session-quotes">
        <div><span>盘前</span><b>{money(quote?.preMarketPrice ?? stock.extended?.pre_price)}</b><em className={valueTone(quote?.preMarketChangePercent ?? stock.extended?.pre_change_rate)}>{percent(quote?.preMarketChangePercent ?? stock.extended?.pre_change_rate)}</em></div>
        <div><span>盘后</span><b>{money(quote?.postMarketPrice ?? stock.extended?.after_price)}</b><em className={valueTone(quote?.postMarketChangePercent ?? stock.extended?.after_change_rate)}>{percent(quote?.postMarketChangePercent ?? stock.extended?.after_change_rate)}</em></div>
        <div><span>隔夜</span><b>{money(stock.extended?.overnight_price)}</b><em className={valueTone(stock.extended?.overnight_change_rate)}>{percent(stock.extended?.overnight_change_rate)}</em></div>
      </div>
      <div className="focus-attention">
        <span>本轮刷新</span>
        <b className={valueTone(quoteMove)}>{quoteMove ? `${quoteMove > 0 ? "+" : ""}${quoteMove.toFixed(2)}` : "无价格变化"}</b>
        <small>{dateTime(liveAt)} · {signalCount} 条相关信号</small>
      </div>
    </section>
  );
}

function SignalList({ signals, limit = 6, emptyText = "暂时没有匹配的实时信号" }: { signals: SignalEvent[]; limit?: number; emptyText?: string }) {
  if (!signals.length) return <div className="panel-empty">{emptyText}</div>;
  return <div className="practical-signal-list">{signals.slice(0, limit).map((signal) => <article key={signal.id}>
    <time>{dateTime(signal.triggerAt)}</time>
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
  const rsiValue = finite(rsi);
  return <div className="technical-visual">
    <MetricBars metrics={metrics} signed scale={35} />
    <div className="rsi-gauge" role="img" aria-label={`RSI 14 ${decimal(rsiValue, 1)}，区间零到一百`}>
      <div><span>RSI 14</span><b>{decimal(rsiValue, 1)}</b><em>{rsiValue == null ? "—" : rsiValue >= 70 ? "偏热" : rsiValue <= 30 ? "偏冷" : "中性"}</em></div>
      <i><span>30</span><span>50</span><span>70</span><strong style={{ left: `${clamp(rsiValue ?? 50, 0, 100)}%` }} /></i>
    </div>
    <div className="shares-readout"><span>流通股本</span><b>{compact(shares)}</b></div>
  </div>;
}

function ExpectationVisual({ stock, currentPrice }: { stock: StockData; currentPrice: number | null | undefined }) {
  const analyst = stock.analyst;
  const snapshot = stock.snapshot;
  const ratingParts = [
    { label: "强买", value: analyst?.strong_buy_count ?? 0, tone: "strong-buy" },
    { label: "买入", value: analyst?.buy_count ?? 0, tone: "buy" },
    { label: "持有", value: analyst?.hold_count ?? 0, tone: "hold" },
    { label: "卖出", value: (analyst?.sell_count ?? 0) + (analyst?.strong_sell_count ?? 0), tone: "sell" },
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
    { label: "EPS 最新", value: percent(snapshot?.latest_eps_surprise, 1), raw: snapshot?.latest_eps_surprise },
    { label: "营收最新", value: percent(snapshot?.latest_revenue_surprise, 1), raw: snapshot?.latest_revenue_surprise },
    { label: "EPS 4Q均", value: percent(snapshot?.avg_eps_surprise_last_4q, 1), raw: snapshot?.avg_eps_surprise_last_4q },
    { label: "营收4Q均", value: percent(snapshot?.avg_revenue_surprise_last_4q, 1), raw: snapshot?.avg_revenue_surprise_last_4q },
  ];

  return <div className="expectation-visual">
    <div className="rating-visual">
      <header><span>分析师分布</span><b>{analyst?.consensus ?? "—"} · {analyst?.total_analysts ?? 0} 位</b></header>
      <div className="rating-stack" aria-label={ratingParts.map((part) => `${part.label}${part.value}`).join("，")}>{ratingParts.map((part) => <i key={part.label} className={part.tone} style={{ width: `${part.value / ratingTotal * 100}%` }} />)}</div>
      <footer>{ratingParts.map((part) => <span key={part.label}><i className={part.tone} />{part.label} {part.value}</span>)}</footer>
    </div>
    <div className="target-range-visual" role="img" aria-label={`当前价 ${money(price)}，目标价区间 ${money(targetLow)} 到 ${money(targetHigh)}，共识 ${money(targetConsensus)}`}>
      <header><span>目标价格带</span><b className={valueTone(targetUpside(stock, price ?? undefined))}>{percent(targetUpside(stock, price ?? undefined), 0)}</b></header>
      <div><i /><strong className="current" style={{ left: targetPosition(price) }}>现</strong><strong className="consensus" style={{ left: targetPosition(targetConsensus) }}>中</strong></div>
      <footer><span>{money(targetLow, 0)}</span><b>{money(price, 0)} 当前</b><span>{money(targetHigh, 0)}</span></footer>
    </div>
    <div className="earnings-mini-chart" role="img" aria-label={earnings.map((event) => `${shortDate(event.date)} EPS 实际 ${decimal(event.eps_actual)}，预期 ${decimal(event.eps_estimated)}`).join("；")}>
      <header><span>最近季度 EPS</span><b>实际 / 预期</b></header>
      <div style={{ "--earnings-count": Math.max(earnings.length, 1) } as CSSProperties}>{earnings.map((event) => <i key={event.date}><span><em style={{ height: `${Math.abs(event.eps_estimated ?? 0) / earningsScale * 100}%` }} /><strong style={{ height: `${Math.abs(event.eps_actual ?? 0) / earningsScale * 100}%` }} /></span><small>{shortDate(event.date)}</small></i>)}</div>
    </div>
    <MetricBars metrics={surpriseMetrics} signed columns={2} />
    <div className="next-estimates"><span>下季 EPS <b>{decimal(snapshot?.next_q_eps_estimate_avg)}</b></span><span>下季营收 <b>{compact(snapshot?.next_q_revenue_estimate_avg)}</b></span><span>12Q EPS <b>{decimal(snapshot?.eps_beats_last_12q, 0)}胜/{decimal(snapshot?.eps_misses_last_12q, 0)}负</b></span><span>12Q 营收 <b>{decimal(snapshot?.revenue_beats_last_12q, 0)}胜/{decimal(snapshot?.revenue_misses_last_12q, 0)}负</b></span></div>
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
    { label: "市值", value: compact(quote?.marketCap ?? snapshot?.market_capitalization), raw: quote?.marketCap ?? snapshot?.market_capitalization, note: "USD" },
    { label: "企业价值", value: compact(snapshot?.enterprise_value), raw: snapshot?.enterprise_value, note: "EV" },
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
    { label: "目标空间", value: percent(targetUpside(stock, quote?.price), 1), raw: targetUpside(stock, quote?.price) },
  ];
  const qualityRows: ChartMetric[] = [
    { label: "毛利率", value: percent(snapshot?.gross_profit_margin_ttm, 1), raw: snapshot?.gross_profit_margin_ttm },
    { label: "EBIT率", value: percent(snapshot?.ebit_margin_ttm, 1), raw: snapshot?.ebit_margin_ttm },
    { label: "EBITDA率", value: percent(snapshot?.ebitda_margin_ttm, 1), raw: snapshot?.ebitda_margin_ttm },
    { label: "净利率", value: percent(snapshot?.net_income_margin_ttm, 1), raw: snapshot?.net_income_margin_ttm },
    { label: "FCF率", value: percent(snapshot?.fcf_margin_ttm, 1), raw: snapshot?.fcf_margin_ttm },
    { label: "Capex率", value: percent(snapshot?.capex_to_sales_ttm, 1), raw: snapshot?.capex_to_sales_ttm },
    { label: "ROE", value: percent(snapshot?.roe_ttm, 1), raw: snapshot?.roe_ttm },
    { label: "ROA", value: percent(snapshot?.roa_ttm, 1), raw: snapshot?.roa_ttm },
    { label: "ROIC", value: percent(snapshot?.roic_ttm, 1), raw: snapshot?.roic_ttm },
  ];
  const qualityReadouts = [
    { label: "资产周转", value: multiple(snapshot?.asset_turnover_ttm, 2) },
    { label: "每股现金", value: money(snapshot?.cash_per_share_ttm) },
    { label: "经营现金流", value: compact(snapshot?.cash_from_operations_ttm) },
  ];
  const growthRows: ChartMetric[] = [
    { label: "营收 TTM", value: percent(snapshot?.revenue_growth_ttm, 1), raw: snapshot?.revenue_growth_ttm },
    { label: "EBITDA TTM", value: percent(snapshot?.ebitda_growth_ttm, 1), raw: snapshot?.ebitda_growth_ttm },
    { label: "EBIT TTM", value: percent(snapshot?.ebit_growth_ttm, 1), raw: snapshot?.ebit_growth_ttm },
    { label: "EPS TTM", value: percent(snapshot?.eps_growth_ttm, 1), raw: snapshot?.eps_growth_ttm },
    { label: "FCF TTM", value: percent(snapshot?.fcf_growth_ttm, 1), raw: snapshot?.fcf_growth_ttm },
    { label: "OCF TTM", value: percent(snapshot?.ocf_growth_ttm, 1), raw: snapshot?.ocf_growth_ttm },
    { label: "营收 FWD", value: percent(snapshot?.revenue_growth_fwd, 1), raw: snapshot?.revenue_growth_fwd },
    { label: "EBITDA FWD", value: percent(snapshot?.ebitda_growth_fwd, 1), raw: snapshot?.ebitda_growth_fwd },
    { label: "EPS FWD", value: percent(snapshot?.eps_growth_fwd, 1), raw: snapshot?.eps_growth_fwd },
    { label: "营收 CAGR3", value: percent(snapshot?.revenue_cagr_3y, 1), raw: snapshot?.revenue_cagr_3y },
    { label: "EPS CAGR3", value: percent(snapshot?.eps_cagr_3y, 1), raw: snapshot?.eps_cagr_3y },
    { label: "FCF CAGR3", value: percent(snapshot?.fcf_cagr_3y, 1), raw: snapshot?.fcf_cagr_3y },
    { label: "营收 CAGR5", value: percent(snapshot?.revenue_cagr_5y, 1), raw: snapshot?.revenue_cagr_5y },
    { label: "EPS CAGR5", value: percent(snapshot?.eps_cagr_5y, 1), raw: snapshot?.eps_cagr_5y },
    { label: "FCF CAGR5", value: percent(snapshot?.fcf_cagr_5y, 1), raw: snapshot?.fcf_cagr_5y },
  ];
  const leverageRows: ChartMetric[] = [
    { label: "负债/权益", value: multiple(snapshot?.debt_to_equity, 2), raw: snapshot?.debt_to_equity },
    { label: "净债/权益", value: multiple(snapshot?.net_debt_to_equity, 2), raw: snapshot?.net_debt_to_equity },
    { label: "负债/资产", value: multiple(snapshot?.debt_to_assets, 2), raw: snapshot?.debt_to_assets },
    { label: "债务/EBITDA", value: multiple(snapshot?.debt_to_ebitda, 2), raw: snapshot?.debt_to_ebitda },
    { label: "净债/EBITDA", value: multiple(snapshot?.net_debt_to_ebitda, 2), raw: snapshot?.net_debt_to_ebitda },
  ];
  const liquidityRows: ChartMetric[] = [
    { label: "利息覆盖", value: multiple(snapshot?.interest_coverage), raw: snapshot?.interest_coverage },
    { label: "流动比率", value: multiple(snapshot?.current_ratio, 2), raw: snapshot?.current_ratio },
    { label: "速动比率", value: multiple(snapshot?.quick_ratio, 2), raw: snapshot?.quick_ratio },
  ];
  const shareholderRows: ChartMetric[] = [
    { label: "股息率", value: percent(snapshot?.dividend_yield_ttm, 2), raw: snapshot?.dividend_yield_ttm },
    { label: "派息率", value: percent(snapshot?.payout_ratio_ttm, 1), raw: snapshot?.payout_ratio_ttm },
    { label: "股息1Y增", value: percent(snapshot?.dividend_growth_1y, 1), raw: snapshot?.dividend_growth_1y },
    { label: "股息CAGR3", value: percent(snapshot?.dividend_cagr_3y, 1), raw: snapshot?.dividend_cagr_3y },
    { label: "股息CAGR5", value: percent(snapshot?.dividend_cagr_5y, 1), raw: snapshot?.dividend_cagr_5y },
    { label: "每股股息", value: money(snapshot?.dividend_rate_ttm), raw: snapshot?.dividend_rate_ttm },
  ];
  const returnRows: ChartMetric[] = [
    ["1D", snapshot?.price_return_1d], ["5D", snapshot?.price_return_5d], ["1M", snapshot?.price_return_1m],
    ["3M", snapshot?.price_return_3m], ["6M", snapshot?.price_return_6m], ["YTD", snapshot?.price_return_ytd],
    ["1Y", snapshot?.price_return_1y], ["3Y", snapshot?.price_return_3y], ["5Y", snapshot?.price_return_5y], ["10Y", snapshot?.price_return_10y],
  ].map(([label, value]) => ({ label: String(label), value: percent(value as number | null, 1), raw: value as number | null }));
  const technicalRows: ChartMetric[] = [
    { label: "距 SMA10", value: percent(snapshot?.price_vs_sma_10d, 1), raw: snapshot?.price_vs_sma_10d, note: money(snapshot?.sma_10_day) },
    { label: "距 SMA50", value: percent(snapshot?.price_vs_sma_50d, 1), raw: snapshot?.price_vs_sma_50d, note: money(snapshot?.sma_50_day) },
    { label: "距 SMA100", value: percent(snapshot?.price_vs_sma_100d, 1), raw: snapshot?.price_vs_sma_100d, note: money(snapshot?.sma_100_day) },
    { label: "距 SMA200", value: percent(snapshot?.price_vs_sma_200d, 1), raw: snapshot?.price_vs_sma_200d, note: money(snapshot?.sma_200_day) },
  ];

  return <div className="focus-layout">
    <FocusSummary stock={stock} quote={quote} signalCount={relevantSignals.length} quoteMove={quoteMove} liveAt={liveAt} />
    <section className="price-panel practical-panel">
      <PanelHeader eyebrow="PRICE ACTION" title="最新交易日 K 线" meta={intraday ? `${intraday.sessionDate} · 1M→5M` : "LOADING"} />
      <IntradayChart key={stock.ticker} bars={bars} fallback={stock.history} ticker={stock.ticker} />
      <div className="price-stats">
        <span>开盘 <b>{money(first?.open)}</b></span>
        <span>最高 <b>{money(high)}</b></span>
        <span>最低 <b>{money(low)}</b></span>
        <span>收盘 <b>{money(last?.close)}</b></span>
        <span>日内 <b className={valueTone(sessionChange)}>{percent(sessionChange)}</b></span>
        <span>成交 <b>{compact(volume)}</b></span>
      </div>
    </section>
    <section className="focus-signal-panel practical-panel">
      <PanelHeader eyebrow="WHAT CHANGED" title="实时事件与催化剂" meta={`${relevantSignals.length} MATCH / 60S`} />
      <SignalList signals={focusSignals} limit={8} />
    </section>
    <section className="focus-market-panel practical-panel">
      <PanelHeader eyebrow="MARKET CONTEXT" title="市场与自选横截面" meta="30S" />
      <div className="focus-index-tape">{indices.slice(0, 6).map((index) => <div key={index.index_ticker}><span>{index.index_ticker}</span><b>{index.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b><em className={valueTone(index.change_pct)}>{percent(index.change_pct, 1)}</em></div>)}</div>
      <div className="focus-peer-tape">{dashboard.stocks.map((peer) => { const peerQuote = quotes.get(peer.ticker); return <div key={peer.ticker}><b>{peer.ticker}</b><span>{money(peerQuote?.price ?? peer.snapshot?.price_current)}</span><em className={valueTone(peerQuote?.changesPercentage ?? peer.snapshot?.price_return_1d)}>{percent(peerQuote?.changesPercentage ?? peer.snapshot?.price_return_1d, 1)}</em><small>PE {decimal(peer.snapshot?.pe_ratio_ttm, 1)} · RSI {decimal(peer.snapshot?.rsi_14_day, 0)}</small></div>; })}</div>
    </section>
    <section className="focus-intelligence-grid" aria-label="Drillr 图表化公司情报矩阵">
      <VisualDataPanel className="valuation-panel" eyebrow="VALUATION SPECTRUM" title="估值倍率谱" meta="16 MARKS" points={capitalRows.length + valuationRows.length}>
        <div className="valuation-visual-body"><MetricBars metrics={capitalRows} /><MetricBars metrics={valuationRows} /></div>
      </VisualDataPanel>
      <VisualDataPanel className="quality-panel" eyebrow="ECONOMIC QUALITY" title="盈利与资本效率" meta="12 MARKS" points={qualityRows.length + qualityReadouts.length}>
        <div className="quality-visual-body"><MetricBars metrics={qualityRows} signed columns={2} /><div className="quality-readouts">{qualityReadouts.map((item) => <span key={item.label}><small>{item.label}</small><b>{item.value}</b></span>)}</div></div>
      </VisualDataPanel>
      <VisualDataPanel className="growth-panel" eyebrow="GROWTH VECTOR" title="增长方向与持续性" meta="15 BARS" points={growthRows.length}>
        <MetricBars metrics={growthRows} signed columns={2} />
      </VisualDataPanel>
      <VisualDataPanel className="returns-panel" eyebrow="RETURN SURFACE" title="多周期收益热力" meta="10 WINDOWS" points={returnRows.length}>
        <ReturnHeatmap metrics={returnRows} />
      </VisualDataPanel>
      <VisualDataPanel className="technical-panel" eyebrow="TREND POSITION" title="均线位置与动量" meta="10 MARKS" points={10}>
        <TechnicalVisual metrics={technicalRows} rsi={snapshot?.rsi_14_day} shares={snapshot?.shares_outstanding} />
      </VisualDataPanel>
      <VisualDataPanel className="expectation-panel" eyebrow="EXPECTATION MAP" title="共识、目标与兑现" meta="24 MARKS" points={24}>
        <ExpectationVisual stock={stock} currentPrice={quote?.price ?? snapshot?.price_current} />
      </VisualDataPanel>
      <VisualDataPanel className="balance-panel" eyebrow="BALANCE & PAYOUT" title="杠杆、流动性与股东回报" meta="14 BARS" points={leverageRows.length + liquidityRows.length + shareholderRows.length}>
        <div className="balance-visual-body"><div className="balance-ratio-groups"><MetricBars metrics={leverageRows} signed scale={5} /><MetricBars metrics={liquidityRows} scale={20} /></div><MetricBars metrics={shareholderRows} signed /></div>
      </VisualDataPanel>
    </section>
  </div>;
}

function stockAttention(stock: StockData, quote: LiveQuote | undefined, signalCount: number) {
  const move = quote?.changesPercentage ?? stock.snapshot?.price_return_1d ?? 0;
  const extended = quote?.postMarketChangePercent ?? stock.extended?.after_change_rate ?? 0;
  if (Math.abs(move) >= 3) return "日内显著波动";
  if (Math.abs(extended) >= 1.5) return "盘后价格活跃";
  if (signalCount > 0) return `${signalCount} 条相关信号`;
  return "暂无异常变化";
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
  const ranked = [...stocks].sort((a, b) => Math.abs(quotes.get(b.ticker)?.changesPercentage ?? b.snapshot?.price_return_1d ?? 0) - Math.abs(quotes.get(a.ticker)?.changesPercentage ?? a.snapshot?.price_return_1d ?? 0));
  return <section className="radar-watchlist practical-panel"><PanelHeader eyebrow="WATCHLIST RADAR" title="高密度自选扫描器" meta="14 METRICS · CLICK TO FOCUS" /><div className="screener-head"><span>标的</span><span>实时报价</span><span>18D趋势</span><span>多周期收益</span><span>估值与动量</span><span>扩展交易</span><span>状态</span></div><div className="radar-stock-list">
    {ranked.map((stock, index) => {
      const quote = quotes.get(stock.ticker);
      const move = quote?.changesPercentage ?? stock.snapshot?.price_return_1d;
      const stockSignals = signals.filter((signal) => signal.tickers.includes(stock.ticker)).length;
      return <button type="button" key={stock.ticker} data-moved={quoteMoves[stock.ticker] ? "true" : "false"} onClick={() => onSelect(stock.ticker)}>
        <span className="radar-symbol"><b>{stock.ticker}</b><em>{String(index + 1).padStart(2, "0")} · {stock.name}</em></span>
        <span className="radar-quote-pack"><b>{money(quote?.price ?? stock.snapshot?.price_current)}</b><em className={valueTone(move)}>{percent(move, 1)} 日内</em></span>
        <MiniSparkline values={stock.history.map((bar) => bar.close).slice(-18)} tone={valueTone(move)} />
        <span className="radar-metric-pack">
          <i><small>5D</small><b className={valueTone(stock.snapshot?.price_return_5d)}>{percent(stock.snapshot?.price_return_5d, 1)}</b></i>
          <i><small>1M</small><b className={valueTone(stock.snapshot?.price_return_1m)}>{percent(stock.snapshot?.price_return_1m, 1)}</b></i>
          <i><small>YTD</small><b className={valueTone(stock.snapshot?.price_return_ytd)}>{percent(stock.snapshot?.price_return_ytd, 1)}</b></i>
        </span>
        <span className="radar-metric-pack">
          <i><small>PE</small><b>{decimal(stock.snapshot?.pe_ratio_ttm, 1)}</b></i>
          <i><small>RSI</small><b>{decimal(stock.snapshot?.rsi_14_day, 0)}</b></i>
          <i><small>目标</small><b className={valueTone(targetUpside(stock, quote?.price))}>{percent(targetUpside(stock, quote?.price), 0)}</b></i>
        </span>
        <span className="radar-metric-pack">
          <i><small>盘前</small><b className={valueTone(quote?.preMarketChangePercent ?? stock.extended?.pre_change_rate)}>{percent(quote?.preMarketChangePercent ?? stock.extended?.pre_change_rate, 1)}</b></i>
          <i><small>盘后</small><b className={valueTone(quote?.postMarketChangePercent ?? stock.extended?.after_change_rate)}>{percent(quote?.postMarketChangePercent ?? stock.extended?.after_change_rate, 1)}</b></i>
          <i><small>信号</small><b>{stockSignals}</b></i>
        </span>
        <span className="radar-attention"><i className={Math.abs(move ?? 0) >= 3 ? "hot" : ""} /><b>{stockAttention(stock, quote, stockSignals)}</b></span>
      </button>;
    })}
  </div></section>;
}

function RadarCrossSection({ stocks, quotes, indices }: { stocks: StockData[]; quotes: Map<string, LiveQuote>; indices: MarketIndex[] }) {
  return <section className="radar-cross-panel practical-panel"><PanelHeader eyebrow="CROSS SECTION" title="指数与基本面横截面" meta={`${indices.length} INDEX · ${stocks.length * 8} STOCK POINTS`} />
    <div className="radar-index-strip">{indices.slice(0, 6).map((index) => <div key={index.index_ticker}><span>{index.index_ticker}</span><b>{index.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b><em className={valueTone(index.change_pct)}>{percent(index.change_pct, 1)}</em></div>)}</div>
    <div className="cross-table"><div className="cross-head"><span>标的</span><span>毛利</span><span>净利</span><span>营收增</span><span>EPS增</span><span>ROIC</span><span>负债</span><span>PE FWD</span><span>目标空间</span></div>{stocks.map((stock) => <div key={stock.ticker}><b>{stock.ticker}</b><span>{percent(stock.snapshot?.gross_profit_margin_ttm, 0)}</span><span>{percent(stock.snapshot?.net_income_margin_ttm, 0)}</span><span className={valueTone(stock.snapshot?.revenue_growth_ttm)}>{percent(stock.snapshot?.revenue_growth_ttm, 0)}</span><span className={valueTone(stock.snapshot?.eps_growth_fwd)}>{percent(stock.snapshot?.eps_growth_fwd, 0)}</span><span>{percent(stock.snapshot?.roic_ttm, 0)}</span><span>{multiple(stock.snapshot?.debt_to_equity, 1)}</span><span>{multiple(stock.snapshot?.pe_ratio_fwd, 1)}</span><span className={valueTone(targetUpside(stock, quotes.get(stock.ticker)?.price))}>{percent(targetUpside(stock, quotes.get(stock.ticker)?.price), 0)}</span></div>)}</div>
  </section>;
}

function RadarCoverage({ dashboard }: { dashboard: DashboardPayload }) {
  return <section className="radar-coverage-panel practical-panel"><PanelHeader eyebrow="DRILLR UNIVERSE" title={`${dashboard.capabilities.structuredFieldCount} 字段 · ${dashboard.capabilities.altTableCount} 另类表`} meta="LIVE CATALOG" /><div className="coverage-columns"><div>{dashboard.capabilities.schemaGroups.slice(0, 10).map((group) => <span key={group.label}><b>{group.label}</b><em>{group.count}F</em></span>)}</div><div>{dashboard.capabilities.altCategories.slice(0, 10).map((category) => <span key={category.category}><b>{category.label}</b><em>{category.count}T</em></span>)}</div></div></section>;
}

function RadarView({ dashboard, quotes, signals, indices, quoteMoves, onSelect }: { dashboard: DashboardPayload; quotes: Map<string, LiveQuote>; signals: SignalEvent[]; indices: MarketIndex[]; quoteMoves: Record<string, number>; onSelect: (ticker: string) => void }) {
  const stocks = dashboard.stocks;
  return <div className="radar-layout">
    <RadarWatchlist stocks={stocks} quotes={quotes} signals={signals} quoteMoves={quoteMoves} onSelect={onSelect} />
    <section className="radar-signal-panel practical-panel"><PanelHeader eyebrow="LIVE INTELLIGENCE" title="自选股事件流" meta="10 ITEMS · 60S" /><SignalList signals={signals} limit={10} emptyText="自选股暂时没有新增事件" /></section>
    <RadarCrossSection stocks={stocks} quotes={quotes} indices={indices} />
    <RadarCoverage dashboard={dashboard} />
  </div>;
}

export function DrillrDashboard() {
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
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const payload = (await response.json()) as DashboardPayload | DashboardError;
      if (!response.ok || !payload.ok) throw new Error(!payload.ok ? payload.error : "真实数据请求失败");
      setDashboard(payload);
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("ticker")?.toUpperCase();
      const requestedView = params.get("view");
      const validTicker = payload.stocks.some((stock) => stock.ticker === requested);
      setSelectedTicker((current) => payload.stocks.some((stock) => stock.ticker === current) ? current : validTicker && requested ? requested : payload.stocks[0]?.ticker ?? "");
      if (requestedView === "radar") setViewMode("radar");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "真实数据源暂时不可用");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLive = useCallback(async () => {
    try {
      const response = await fetch("/api/live", { cache: "no-store" });
      const payload = (await response.json()) as LivePayload | ApiError;
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "实时报价请求失败");
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
      setLiveError(error instanceof Error ? error.message : "实时报价暂时不可用");
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
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLive(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadLive();
    }, 30_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [loadLive]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSignals(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadSignals();
    }, 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [loadSignals]);

  useEffect(() => {
    if (!selectedTicker) return;
    const timer = window.setTimeout(() => void loadIntraday(selectedTicker), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadIntraday(selectedTicker);
    }, 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [loadIntraday, selectedTicker]);

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

  async function addStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setAdminMessage("");
    setSignInHref("");
    try {
      const response = await fetch("/api/stocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: newTicker, name: newName }) });
      const payload = (await response.json()) as { stocks?: StockOption[]; error?: string; signIn?: string };
      if (!response.ok) {
        setAdminMessage(payload.error ?? "暂时无法保存。");
        if (payload.signIn) setSignInHref(payload.signIn);
        return;
      }
      setNewTicker("");
      setNewName("");
      setAdminMessage("已加入自选，正在读取真实数据。");
      await Promise.all([loadDashboard(), loadLive(), loadSignals()]);
    } catch {
      setAdminMessage("网络暂时不可用。");
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
        setAdminMessage(payload.error ?? "暂时无法删除。");
        if (payload.signIn) setSignInHref(payload.signIn);
        return;
      }
      setAdminMessage(`${ticker} 已移除。`);
      await Promise.all([loadDashboard(), loadLive(), loadSignals()]);
    } catch {
      setAdminMessage("网络暂时不可用。");
    } finally {
      setSaving(false);
    }
  }

  const quotes = useMemo(() => new Map((live?.quotes ?? []).map((quote) => [quote.symbol, quote])), [live]);
  const signals = freshSignals?.signals ?? dashboard?.signals ?? [];
  const indices = live?.indices.length ? live.indices : dashboard?.indices ?? [];
  const selectedStock = dashboard?.stocks.find((stock) => stock.ticker === selectedTicker) ?? dashboard?.stocks[0];

  if (!dashboard && loading) return <main className="boot-screen"><div className="boot-grid" aria-hidden="true" /><div className="boot-core"><span>drillr</span><i /><b>BUILDING YOUR MARKET VIEW</b></div><p>正在连接自选股、实时报价、分钟 K 线和事件信号</p><div className="boot-progress"><i /></div></main>;
  if (!dashboard || !selectedStock) return <main className="error-screen"><span>DATA SOURCE OFFLINE</span><h1>{loadError || "真实数据源暂时不可用"}</h1><p>页面没有切换到模拟数据。恢复 Drillr Gateway 后即可继续。</p><button type="button" onClick={() => loadDashboard()}>重新连接</button></main>;

  return (
    <main className="market-terminal" data-view={viewMode} data-admin-open={adminOpen ? "true" : "false"} data-live-phase={livePulse} data-signal-phase={signalPulse} data-chart-phase={chartPulse}>
      <header className="terminal-topbar">
        <div className="terminal-brand"><span>drillr</span><div><b>高密度实时自选驾驶舱</b><small>{dashboard.capabilities.structuredFieldCount} FIELDS · {dashboard.capabilities.altTableCount} ALT TABLES</small></div></div>
        <nav className="view-switch" aria-label="视图模式">
          <button type="button" className={viewMode === "focus" ? "active" : ""} onClick={() => changeView("focus")}><i />单股聚焦</button>
          <button type="button" className={viewMode === "radar" ? "active" : ""} onClick={() => changeView("radar")}><i />自选雷达</button>
        </nav>
        <div className="terminal-health"><span className={liveError ? "degraded" : "connected"}><i />{liveError ? "LIVE DEGRADED" : "DRILLR CONNECTED"}</span><LiveClock /></div>
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
        <div className="admin-head"><div><span>WATCHLIST SETTINGS</span><h2 id="admin-title">管理自选股票</h2></div><button type="button" aria-label="关闭" onClick={() => setAdminOpen(false)}>×</button></div>
        <p className="admin-copy">最多保留 6 只股票用于雷达扫描。单股聚焦页会把一分钟行情聚合为可交互五分钟 K 线，并加载盘前盘后、关键指标和相关事件。</p>
        <div className="admin-stock-list">{dashboard.stocks.map((stock, index) => <div key={stock.ticker}><span>{String(index + 1).padStart(2, "0")}</span><b>{stock.ticker}</b><em>{stock.name}</em><button type="button" disabled={saving || dashboard.stocks.length <= 1} onClick={() => removeStock(stock.ticker)}>移除</button></div>)}</div>
        <form onSubmit={addStock} className="admin-form"><label><span>股票代码</span><input value={newTicker} onChange={(event) => setNewTicker(event.target.value.toUpperCase())} placeholder="MSFT" maxLength={10} required /></label><label><span>公司名称</span><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="微软" maxLength={40} required /></label><button type="submit" disabled={saving || dashboard.stocks.length >= 6}>{dashboard.stocks.length >= 6 ? "已达到上限" : saving ? "读取真实数据中…" : "加入自选"}</button></form>
        {adminMessage && <p className="admin-message">{adminMessage}</p>}{signInHref && <a className="admin-signin" href={signInHref}>登录管理员身份 <span>↗</span></a>}
      </section></div>}
    </main>
  );
}

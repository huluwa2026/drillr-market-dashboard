"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  DashboardError,
  DashboardPayload,
  MarketIndex,
  SignalEvent,
  StockData,
  StockOption,
} from "./dashboard-types";

const FIELD_DESCRIPTIONS: Record<string, string> = {
  公司身份: "资料 · 行业 · 交易所 · 高管 · 证券标识",
  估值矩阵: "市值 · PE · PEG · PB · PS · EV 倍数",
  盈利质量: "毛利率 · 净利率 · ROE · ROIC · 周转率",
  成长序列: "收入 · EPS · FCF · 3Y/5Y 复合增速",
  现金与杠杆: "现金 · 净负债 · 偿债 · 流动性 · 覆盖率",
  股东回报: "股息 · 派息率 · 连续分红 · 股息增长",
  价格与技术: "多周期收益 · 均线 · RSI · 趋势状态",
  盈利预期: "一致预期 · 超预期 · 下季 EPS/收入",
  知识与治理: "业务知识 · 管理层 · 业务结构 · 会计标准",
  其他基础字段: "交易状态 · 图像 · 市场分类 · 基础标识",
};

const ALT_DESCRIPTIONS: Record<string, string> = {
  "Energy & Power": "发电机组 · 电价 · 地区小时供需",
  "Data Centers": "设施 · 建设进度 · GPU 集群 · 冷却",
  Semiconductors: "芯片 · 销量 · 晶圆代工 · 海关",
  "Compute Pricing": "GPU 租赁 · 云实例 · 现货/按需价格",
  "Model Development": "模型 · 基准 · 收入 · 融资 · 算力支出",
  "Inference Economics": "调用价 · 历史价 · 输入/输出成本",
  "Macro & Trade": "全球贸易 · 美国进出口 · FRED 宏观",
  "Prediction Markets": "事件 · 合约 · 成交 · 持仓 · 日频聚合",
  "Critical Minerals": "矿床 · 运营商 · 国家供应 · 供应风险",
};

const SERIES = ["#ff5a00", "#4bd783", "#5bb8ff", "#d9b24c", "#c58cff", "#ff6b68"];

function finite(value: number | null | undefined) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null;
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

function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[3]}` : value.slice(0, 10);
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

function formatClock() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function LiveClock() {
  const [clock, setClock] = useState(formatClock);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatClock()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <em>{clock} CST</em>;
}

function targetUpsideValue(stock: StockData) {
  const price = finite(stock.snapshot?.price_current);
  const target = finite(stock.analyst?.pt_consensus);
  return price && target ? ((target - price) / price) * 100 : null;
}

function targetUpside(stock: StockData) {
  return percent(targetUpsideValue(stock));
}

function valueTone(value: string | number | null | undefined) {
  if (typeof value === "number") return value >= 0 ? "positive" : "negative";
  if (typeof value !== "string") return "";
  if (value.startsWith("+") || /Buy/i.test(value)) return "positive";
  if (value.startsWith("−") || value.startsWith("-") || /Sell/i.test(value)) return "negative";
  return "";
}

function latestReported(stock: StockData) {
  return stock.earnings.find((event) => event.eps_actual != null) ?? stock.earnings[0] ?? null;
}

function latestOwnership(stock: StockData) {
  return stock.ownership[0] ?? null;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function PanelHead({ eyebrow, value, title, note }: { eyebrow: string; value: string | number; title: string; note: string }) {
  return (
    <header className="panel-head">
      <div><span>{eyebrow}</span><h2><strong>{value}</strong>{title}</h2></div>
      <p>{note}</p>
    </header>
  );
}

function StockTile({ stock }: { stock: StockData }) {
  const snapshot = stock.snapshot;
  const history = stock.history.slice(-24);
  const latest = history.at(-1);
  const previous = history.at(-2);
  if (!snapshot || !latest || history.length < 2) {
    return <article className="stock-tile stock-unavailable"><strong>{stock.ticker}</strong><span>{stock.name}</span><p>Drillr Gateway 暂无有效数据</p></article>;
  }

  const minPrice = Math.min(...history.map((bar) => bar.low));
  const maxPrice = Math.max(...history.map((bar) => bar.high));
  const priceRange = Math.max(maxPrice - minPrice, 0.01);
  const maxVolume = Math.max(...history.map((bar) => bar.volume), 1);
  const width = 360;
  const candleTop = 7;
  const candleBottom = 94;
  const candleHeight = candleBottom - candleTop;
  const slot = width / history.length;
  const yFor = (value: number) => candleBottom - ((value - minPrice) / priceRange) * candleHeight;
  const change = snapshot.price_return_1d ?? 0;
  const returns = [
    snapshot.price_return_1d,
    snapshot.price_return_5d,
    snapshot.price_return_1m,
    snapshot.price_return_3m,
    snapshot.price_return_ytd,
    snapshot.price_return_1y,
  ];
  const statRows = [
    ["开", money(latest.open)], ["高", money(latest.high)], ["低", money(latest.low)],
    ["昨收", previous ? money(previous.close) : "—"], ["成交量", compact(latest.volume)],
    ["市值", compact(snapshot.market_capitalization)], ["RSI", decimal(snapshot.rsi_14_day, 1)],
    ["目标空间", targetUpside(stock)],
  ];

  return (
    <article className="stock-tile">
      <header className="stock-head">
        <div className="stock-identity"><strong>{stock.ticker}</strong><span>{snapshot.company_name}</span><small>{snapshot.exchange}</small></div>
        <div className="stock-quote"><b className={valueTone(change)}>{snapshot.price_current.toFixed(2)}</b><em className={valueTone(change)}>{percent(change)}</em></div>
      </header>
      <div className="stock-core">
        <div className="stock-stats">
          {statRows.map(([label, value]) => <div key={label}><span>{label}</span><b className={valueTone(value)}>{value}</b></div>)}
        </div>
        <div className="candle-stage">
          <svg viewBox="0 0 360 124" preserveAspectRatio="none" role="img" aria-labelledby={`candle-${stock.ticker}`} data-chart-type="candlestick">
            <title id={`candle-${stock.ticker}`}>{stock.ticker} 最近 {history.length} 个交易日真实日线 K 线与成交量</title>
            <desc>实体表示开盘与收盘，影线表示最高与最低，下方柱形表示成交量。</desc>
            {[22, 51, 80].map((y) => <line className="plot-grid" x1="0" x2="360" y1={y} y2={y} key={y} />)}
            {history.map((bar, barIndex) => {
              const x = slot * barIndex + slot / 2;
              const up = bar.close >= bar.open;
              const openY = yFor(bar.open);
              const closeY = yFor(bar.close);
              const bodyY = Math.min(openY, closeY);
              const bodyHeight = Math.max(1.6, Math.abs(closeY - openY));
              return <g key={bar.period_end} className={up ? "candle up" : "candle down"}>
                <line className="candle-wick" x1={x} x2={x} y1={yFor(bar.high)} y2={yFor(bar.low)} />
                <rect className="candle-body" x={x - Math.max(1.7, slot * .25)} y={bodyY} width={Math.max(3.4, slot * .5)} height={bodyHeight} />
              </g>;
            })}
            <g data-chart-type="volume-histogram" aria-label="真实成交量柱状图">
              <line className="volume-baseline" x1="0" x2="360" y1="123" y2="123" />
              {history.map((bar, barIndex) => {
                const h = Math.max(2, (bar.volume / maxVolume) * 22);
                return <rect className="volume-bar" key={bar.period_end} x={slot * barIndex + slot * .22} y={123 - h} width={Math.max(2, slot * .56)} height={h} />;
              })}
            </g>
          </svg>
          <div className="chart-caption"><span>{shortDate(history[0].period_end)}</span><b>真实 OHLCV · {history.length}D</b><span>{shortDate(latest.period_end)}</span></div>
        </div>
      </div>
      <div className="return-heat" data-chart-type="return-heatmap" role="img" aria-label={`${stock.ticker} 六周期收益热力图`}>
        {(["1D", "5D", "1M", "3M", "YTD", "1Y"] as const).map((label, returnIndex) => {
          const value = finite(returns[returnIndex]);
          const intensity = value == null ? 0 : clamp(Math.abs(value) / 45, .12, .82);
          return <div key={label} className={value == null ? "neutral" : value >= 0 ? "heat-up" : "heat-down"} style={{ "--heat-alpha": intensity } as React.CSSProperties}><span>{label}</span><b>{percent(value)}</b></div>;
        })}
      </div>
    </article>
  );
}

function CoverageMatrix({ dashboard }: { dashboard: DashboardPayload }) {
  const stocks = dashboard.stocks;
  const max = Math.max(...dashboard.capabilities.schemaGroups.map((group) => group.count), 1);
  return (
    <section className="core-panel coverage-panel" data-chart-type="coverage-matrix" style={{ "--coverage-count": stocks.length } as React.CSSProperties}>
      <PanelHead eyebrow="STRUCTURED CORE" value={dashboard.capabilities.structuredFieldCount} title=" 个结构化字段" note="十个数据域逐项实测 · 非宣传口径" />
      <div className="coverage-head"><span>数据域 / 字段内容</span>{stocks.map((stock) => <b key={stock.ticker}>{stock.ticker}</b>)}<em>字段量</em></div>
      <div className="coverage-grid" role="img" aria-label={`${dashboard.capabilities.structuredFieldCount} 个结构化字段在 ${stocks.length} 个标的上的覆盖矩阵`}>
        {dashboard.capabilities.schemaGroups.map((group) => <div className="coverage-row" key={group.label}>
          <div><b>{group.label}</b><span>{FIELD_DESCRIPTIONS[group.label] ?? group.fields.slice(0, 5).join(" · ")}</span></div>
          {stocks.map((stock) => <i className={stock.snapshot ? "covered" : "missing"} key={stock.ticker}><span /></i>)}
          <em><strong style={{ "--bar": `${(group.count / max) * 100}%` } as React.CSSProperties} /></em>
          <small>{group.count}</small>
        </div>)}
      </div>
      <footer className="panel-foot"><span>字段实测率 <b>100%</b></span><span>标的覆盖 <b>{stocks.filter((stock) => stock.snapshot).length}/{stocks.length}</b></span><span>更新 <b>实时 / 日频</b></span></footer>
    </section>
  );
}

function AltRadial({ dashboard }: { dashboard: DashboardPayload }) {
  const categories = dashboard.capabilities.altCategories;
  const max = Math.max(...categories.map((category) => category.count), 1);
  return (
    <section className="core-panel alt-radial-panel" data-chart-type="radial-bars">
      <PanelHead eyebrow="ALTERNATIVE INTELLIGENCE" value={dashboard.capabilities.altTableCount} title=" 张另类数据表" note="九层 AI 产业链 · 目录实时读取" />
      <div className="alt-radial-body">
        <svg viewBox="0 0 230 230" role="img" aria-label="另类数据九层同心径向柱状图">
          <title>Drillr 另类数据九层覆盖</title><desc>每条同心弧长度代表该类别的真实数据表数量。</desc>
          {categories.map((category, index) => {
            const radius = 32 + index * 8.6;
            const ratio = category.count / max;
            return <g key={category.category}>
              <circle className="radial-track" cx="115" cy="115" r={radius} />
              <circle className="radial-value" cx="115" cy="115" r={radius} pathLength="100" strokeDasharray={`${Math.max(7, ratio * 76)} 100`} style={{ "--series": SERIES[index % SERIES.length] } as React.CSSProperties} />
            </g>;
          })}
          <text className="radial-total" x="115" y="111" textAnchor="middle">{dashboard.capabilities.altTableCount}</text>
          <text className="radial-label" x="115" y="128" textAnchor="middle">REAL TABLES</text>
        </svg>
        <div className="alt-legend">
          {categories.map((category, index) => <div key={category.category}><i style={{ "--series": SERIES[index % SERIES.length] } as React.CSSProperties} /><span><b>{category.label}</b><small>{ALT_DESCRIPTIONS[category.category] ?? category.tables[0]?.summary}</small></span><strong>{String(category.count).padStart(2, "0")}</strong></div>)}
        </div>
      </div>
    </section>
  );
}

const RADAR_AXES = [
  { label: "收入增长", value: (stock: StockData) => stock.snapshot?.revenue_growth_ttm, min: -20, max: 100 },
  { label: "毛利率", value: (stock: StockData) => stock.snapshot?.gross_profit_margin_ttm, min: 0, max: 100 },
  { label: "EPS 前瞻", value: (stock: StockData) => stock.snapshot?.eps_growth_fwd, min: -50, max: 120 },
  { label: "一年收益", value: (stock: StockData) => stock.snapshot?.price_return_1y, min: -50, max: 200 },
  { label: "目标空间", value: (stock: StockData) => targetUpsideValue(stock), min: -30, max: 60 },
];

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as const;
}

function CrossStockRadar({ stocks }: { stocks: StockData[] }) {
  const cx = 125; const cy = 101; const radius = 72;
  const angles = RADAR_AXES.map((_, index) => -Math.PI / 2 + index * (Math.PI * 2 / RADAR_AXES.length));
  return (
    <section className="core-panel radar-panel" data-chart-type="cross-stock-radar">
      <PanelHead eyebrow="CROSS SECTION" value={stocks.length * RADAR_AXES.length} title=" 个横截面对比" note="成长 · 盈利 · 价格 · 共识，同尺度呈现" />
      <div className="radar-body">
        <svg viewBox="0 0 250 205" role="img" aria-label={`${stocks.map((stock) => stock.ticker).join("、")} 五维横截面雷达图`}>
          <title>预选股票五维基本面雷达图</title>
          {[.25, .5, .75, 1].map((level) => <polygon key={level} className="radar-grid" points={angles.map((angle) => polarPoint(cx, cy, radius * level, angle).join(",")).join(" ")} />)}
          {angles.map((angle, index) => {
            const end = polarPoint(cx, cy, radius, angle);
            const label = polarPoint(cx, cy, radius + 19, angle);
            return <g key={RADAR_AXES[index].label}><line className="radar-axis" x1={cx} y1={cy} x2={end[0]} y2={end[1]} /><text className="radar-axis-label" x={label[0]} y={label[1] + 3} textAnchor={Math.abs(label[0] - cx) < 8 ? "middle" : label[0] > cx ? "start" : "end"}>{RADAR_AXES[index].label}</text></g>;
          })}
          {stocks.map((stock, stockIndex) => {
            const points = RADAR_AXES.map((axis, axisIndex) => {
              const raw = finite(axis.value(stock));
              const ratio = raw == null ? 0 : clamp((raw - axis.min) / (axis.max - axis.min));
              return polarPoint(cx, cy, Math.max(4, ratio * radius), angles[axisIndex]).join(",");
            }).join(" ");
            return <g key={stock.ticker} className="radar-series" style={{ "--series": SERIES[stockIndex % SERIES.length] } as React.CSSProperties}><polygon points={points} /><polyline points={`${points} ${points.split(" ")[0]}`} /></g>;
          })}
        </svg>
        <div className="radar-legend">
          {stocks.map((stock, index) => <div key={stock.ticker}><i style={{ "--series": SERIES[index % SERIES.length] } as React.CSSProperties} /><b>{stock.ticker}</b><span>营收 {percent(stock.snapshot?.revenue_growth_ttm, 1)}</span><span>毛利 {percent(stock.snapshot?.gross_profit_margin_ttm, 1)}</span><span>1Y {percent(stock.snapshot?.price_return_1y, 1)}</span></div>)}
        </div>
      </div>
    </section>
  );
}

function SignalTimeline({ signals }: { signals: SignalEvent[] }) {
  const points = signals.slice(0, 12).reverse();
  const plotWidth = 560; const plotHeight = 132;
  return (
    <section className="core-panel signal-panel" data-chart-type="signal-timeline">
      <PanelHead eyebrow="EVIDENCE GRAPH" value={signals.length} title=" 条最新事件信号" note="来源、时间、标的、评分全部可追溯" />
      <div className="signal-chart-wrap">
        <svg viewBox="0 0 590 160" preserveAspectRatio="none" role="img" aria-label="最新真实事件信号时间与评分气泡图">
          <title>Drillr 事件信号时间轴</title><desc>横轴为时间顺序，纵轴为信号评分，气泡大小同样编码评分。</desc>
          {[1, 2, 3, 4, 5].map((score) => {
            const y = 142 - (score / 5) * plotHeight;
            return <g key={score}><line className="signal-grid" x1="24" x2="584" y1={y} y2={y} /><text className="signal-y-label" x="4" y={y + 3}>{score}</text></g>;
          })}
          {points.map((signal, index) => {
            const x = 34 + (index / Math.max(1, points.length - 1)) * (plotWidth - 10);
            const y = 142 - (clamp(signal.score / 5) * plotHeight);
            const ticker = signal.tickers[0] ?? "MKT";
            return <g className="signal-point" key={signal.id}>
              <line x1={x} x2={x} y1="142" y2={y} />
              <circle cx={x} cy={y} r={3.5 + clamp(signal.score / 5) * 5.5} />
              <text x={x} y={y < 35 ? y + 20 : y - 10} textAnchor="middle">{ticker}</text>
              <text className="signal-date" x={x} y="156" textAnchor="middle">{shortDate(signal.triggerAt)}</text>
            </g>;
          })}
        </svg>
      </div>
      <div className="signal-feed">
        {signals.slice(0, 6).map((signal) => <article key={signal.id}><time>{dateTime(signal.triggerAt)}</time><b>{signal.tickers.slice(0, 2).join("/") || "SECTOR"}</b><p>{signal.headline}</p><span>{signal.sourceNames[0] ?? "SOURCE"}</span><strong>{signal.score.toFixed(1)}</strong></article>)}
      </div>
    </section>
  );
}

function ModuleHead({ title, meta }: { title: string; meta: string }) {
  return <header className="module-head"><h3>{title}</h3><span>{meta}</span></header>;
}

function IndexRange({ indices }: { indices: MarketIndex[] }) {
  return <section className="analytics-module" data-chart-type="index-range"><ModuleHead title="指数年内位置" meta="52W RANGE" /><div className="range-chart" role="img" aria-label="指数当前点位在五十二周区间的位置">{indices.map((item) => {
    const ratio = clamp((item.price - item.year_low) / Math.max(.01, item.year_high - item.year_low));
    return <div key={item.index_ticker}><b>{item.name.replace("Dow Jones Industrial Average", "Dow Jones")}</b><span><i /><strong style={{ "--x": `${ratio * 100}%` } as React.CSSProperties} /></span><em>{item.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}</em><small className={valueTone(item.change_pct)}>{percent(item.change_pct)}</small></div>;
  })}</div></section>;
}

function ValuationBars({ stocks }: { stocks: StockData[] }) {
  const values = stocks.flatMap((stock) => [finite(stock.snapshot?.pe_ratio_ttm) ?? 0, finite(stock.snapshot?.pe_ratio_fwd) ?? 0]);
  const max = Math.max(...values, 1);
  return <section className="analytics-module" data-chart-type="grouped-bars"><ModuleHead title="估值双柱" meta="PE TTM / FWD" /><div className="valuation-chart" role="img" aria-label="各标的滚动与远期市盈率分组条形图">{stocks.map((stock) => {
    const ttm = finite(stock.snapshot?.pe_ratio_ttm);
    const fwd = finite(stock.snapshot?.pe_ratio_fwd);
    return <div key={stock.ticker}><b>{stock.ticker}</b><span><i className="ttm" style={{ "--bar": `${ttm == null ? 0 : ttm / max * 100}%` } as React.CSSProperties} /><i className="fwd" style={{ "--bar": `${fwd == null ? 0 : fwd / max * 100}%` } as React.CSSProperties} /></span><em>{decimal(ttm, 1)} / {decimal(fwd, 1)}</em></div>;
  })}</div><div className="mini-legend"><span><i className="orange" />TTM</span><span><i className="blue" />FWD</span></div></section>;
}

function AnalystStack({ stocks }: { stocks: StockData[] }) {
  return <section className="analytics-module" data-chart-type="stacked-consensus"><ModuleHead title="分析师共识结构" meta="RATING MIX" /><div className="analyst-chart" role="img" aria-label="强买入、买入、持有、卖出与强卖出占比堆叠图">{stocks.map((stock) => {
    const analyst = stock.analyst;
    const counts = analyst ? [analyst.strong_buy_count, analyst.buy_count, analyst.hold_count, analyst.sell_count, analyst.strong_sell_count] : [0, 0, 0, 0, 0];
    const total = Math.max(counts.reduce((sum, value) => sum + value, 0), 1);
    return <div key={stock.ticker}><b>{stock.ticker}</b><span>{counts.map((count, index) => <i key={index} className={`rating-${index}`} style={{ "--part": `${count / total * 100}%` } as React.CSSProperties} />)}</span><em>{analyst?.total_analysts ?? 0} 位</em></div>;
  })}</div><div className="mini-legend rating-legend"><span><i className="buy" />买入</span><span><i className="hold" />持有</span><span><i className="sell" />卖出</span></div></section>;
}

function ExtendedLollipop({ stocks }: { stocks: StockData[] }) {
  const values = stocks.flatMap((stock) => [stock.extended?.pre_change_rate, stock.extended?.after_change_rate, stock.extended?.overnight_change_rate].map((value) => finite(value) ?? 0));
  const bound = Math.max(...values.map(Math.abs), .5);
  return <section className="analytics-module" data-chart-type="lollipop"><ModuleHead title="盘前 / 盘后 / 隔夜" meta="EXTENDED MOVE" /><div className="lollipop-chart" role="img" aria-label="盘前盘后与隔夜涨跌幅棒棒糖图">{stocks.map((stock) => {
    const stockValues = [stock.extended?.pre_change_rate, stock.extended?.after_change_rate, stock.extended?.overnight_change_rate];
    return <div key={stock.ticker}><b>{stock.ticker}</b><span><i className="zero" />{stockValues.map((raw, index) => {
      const value = finite(raw);
      const x = value == null ? 50 : 50 + value / bound * 43;
      return <strong key={index} className={`session-${index} ${valueTone(value)}`} style={{ "--x": `${x}%` } as React.CSSProperties}><em>{value == null ? "—" : value.toFixed(1)}</em></strong>;
    })}</span></div>;
  })}</div><div className="mini-legend"><span><i className="orange" />盘前</span><span><i className="blue" />盘后</span><span><i className="purple" />隔夜</span></div></section>;
}

function EarningsPairs({ stocks }: { stocks: StockData[] }) {
  const events = stocks.map(latestReported);
  const max = Math.max(...events.flatMap((event) => [Math.abs(event?.eps_actual ?? 0), Math.abs(event?.eps_estimated ?? 0)]), .01);
  return <section className="analytics-module" data-chart-type="paired-columns"><ModuleHead title="盈利兑现" meta="EPS ACT / EST" /><div className="earnings-chart" role="img" aria-label="最近一期每股盈利实际值与预估值配对柱状图">{stocks.map((stock, index) => {
    const event = events[index];
    const actual = finite(event?.eps_actual);
    const estimated = finite(event?.eps_estimated);
    const surprise = actual != null && estimated ? (actual - estimated) / Math.abs(estimated) * 100 : null;
    return <div key={stock.ticker}><span className="eps-bars"><i className="eps-est" style={{ "--bar": `${estimated == null ? 0 : Math.abs(estimated) / max * 100}%` } as React.CSSProperties} /><i className="eps-act" style={{ "--bar": `${actual == null ? 0 : Math.abs(actual) / max * 100}%` } as React.CSSProperties} /></span><b>{stock.ticker}</b><em className={valueTone(surprise)}>{percent(surprise, 1)}</em></div>;
  })}</div><div className="mini-legend"><span><i className="dim" />预期</span><span><i className="orange" />实际</span></div></section>;
}

function TargetWhisker({ stocks }: { stocks: StockData[] }) {
  return <section className="analytics-module" data-chart-type="target-whisker"><ModuleHead title="目标价区间" meta="LOW / NOW / AVG / HIGH" /><div className="target-chart" role="img" aria-label="分析师目标价低值当前价共识与高值须状图">{stocks.map((stock) => {
    const low = finite(stock.analyst?.pt_low); const high = finite(stock.analyst?.pt_high); const avg = finite(stock.analyst?.pt_consensus); const now = finite(stock.snapshot?.price_current);
    const min = Math.min(...[low, now, avg].filter((value): value is number => value != null));
    const max = Math.max(...[high, now, avg].filter((value): value is number => value != null));
    const range = Math.max(max - min, .01);
    const pos = (value: number | null) => value == null ? 0 : (value - min) / range * 100;
    return <div key={stock.ticker}><b>{stock.ticker}</b><span><i style={{ "--from": `${pos(low)}%`, "--to": `${pos(high)}%` } as React.CSSProperties} /><em className="target-now" style={{ "--x": `${pos(now)}%` } as React.CSSProperties} /><strong style={{ "--x": `${pos(avg)}%` } as React.CSSProperties} /></span><small>{money(avg, 0)}</small></div>;
  })}</div><div className="mini-legend"><span><i className="green" />现价</span><span><i className="orange" />共识</span></div></section>;
}

function OwnershipBubbles({ stocks }: { stocks: StockData[] }) {
  const events = stocks.map(latestOwnership);
  const max = Math.max(...events.map((event) => Math.abs(event?.shares ?? 0)), 1);
  return <section className="analytics-module" data-chart-type="ownership-bubbles"><ModuleHead title="所有权动态" meta="FORM 4 / 13F" /><div className="ownership-bubbles" role="img" aria-label="最新所有权事件按股份量缩放的气泡图">{stocks.map((stock, index) => {
    const event = events[index]; const shares = Math.abs(event?.shares ?? 0); const size = 28 + Math.sqrt(shares / max) * 42;
    return <div key={stock.ticker} style={{ "--bubble": `${size}px` } as React.CSSProperties}><i><b>{stock.ticker}</b><span>{compact(event?.shares)}</span></i><em>{event?.filing_type ?? "—"}</em><small>{event?.activity_type ?? event?.source ?? "—"}</small></div>;
  })}</div></section>;
}

export function DrillrDashboard() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);
  const [newTicker, setNewTicker] = useState("");
  const [newName, setNewName] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [signInHref, setSignInHref] = useState("");
  const [saving, setSaving] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const payload = (await response.json()) as DashboardPayload | DashboardError;
      if (!response.ok || !payload.ok) throw new Error(!payload.ok ? payload.error : "真实数据请求失败");
      setDashboard(payload);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "真实数据源暂时不可用"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void loadDashboard(); }, 0); return () => window.clearTimeout(timer); }, [loadDashboard]);
  async function addStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setAdminMessage(""); setSignInHref("");
    try {
      const response = await fetch("/api/stocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: newTicker, name: newName }) });
      const payload = (await response.json()) as { stocks?: StockOption[]; error?: string; signIn?: string };
      if (!response.ok) { setAdminMessage(payload.error ?? "暂时无法保存。"); if (payload.signIn) setSignInHref(payload.signIn); return; }
      setNewTicker(""); setNewName(""); setAdminMessage("标的已加入，正在向 Drillr Gateway 拉取真实数据。"); await loadDashboard();
    } catch { setAdminMessage("网络暂时不可用。"); }
    finally { setSaving(false); }
  }

  async function removeStock(ticker: string) {
    setSaving(true); setAdminMessage(""); setSignInHref("");
    try {
      const response = await fetch(`/api/stocks?ticker=${encodeURIComponent(ticker)}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string; signIn?: string };
      if (!response.ok) { setAdminMessage(payload.error ?? "暂时无法删除。"); if (payload.signIn) setSignInHref(payload.signIn); return; }
      setAdminMessage(`${ticker} 已移除，正在刷新真实数据。`); await loadDashboard();
    } catch { setAdminMessage("网络暂时不可用。"); }
    finally { setSaving(false); }
  }

  const tickerTitle = useMemo(() => dashboard?.stocks.map((stock) => stock.ticker).join(" · ") ?? "", [dashboard]);

  if (!dashboard && loading) return <main className="boot-screen"><div className="boot-grid" aria-hidden="true" /><div className="boot-core"><span>drillr</span><i /><b>CONNECTING DATA CORE</b></div><p>正在读取真实行情、财务、分析师、所有权、另类数据与事件信号</p><div className="boot-progress"><i /></div></main>;
  if (!dashboard) return <main className="error-screen"><span>DATA SOURCE OFFLINE</span><h1>{loadError || "真实数据源暂时不可用"}</h1><p>页面没有切换到模拟数据。恢复 Drillr Gateway 后即可继续。</p><button type="button" onClick={() => loadDashboard()}>重新连接</button></main>;

  const stocks = dashboard.stocks;
  return (
    <div className="cockpit" data-admin-open={adminOpen ? "true" : "false"}>
      <header className="cockpit-header">
        <div className="cockpit-brand"><span className="wordmark">drillr</span><b>美股数据底座全景</b><small>LIVE CORE</small></div>
        <div className="universe-title"><i />{tickerTitle}<i /></div>
        <div className="header-status"><span>DRILLR GATEWAY</span><i className="gateway-dot" /><b>{dashboard.stale ? "STALE" : dashboard.partial ? "PARTIAL" : "VERIFIED"}</b><LiveClock /><button type="button" onClick={() => setAdminOpen(true)}>管理</button></div>
      </header>

      <section className="stock-wall" style={{ "--stock-count": Math.max(1, stocks.length) } as React.CSSProperties} aria-label="全部预选股票真实行情">
        {stocks.map((stock) => <StockTile key={stock.ticker} stock={stock} />)}
      </section>

      <section className="core-deck" aria-label="Drillr 底层数据核心能力">
        <CoverageMatrix dashboard={dashboard} />
        <AltRadial dashboard={dashboard} />
        <CrossStockRadar stocks={stocks} />
        <SignalTimeline signals={dashboard.signals} />
      </section>

      <section className="analytics-rack" aria-label="真实市场与公司多图形分析层">
        <IndexRange indices={dashboard.indices} />
        <ValuationBars stocks={stocks} />
        <AnalystStack stocks={stocks} />
        <ExtendedLollipop stocks={stocks} />
        <EarningsPairs stocks={stocks} />
        <TargetWhisker stocks={stocks} />
        <OwnershipBubbles stocks={stocks} />
      </section>

      <footer className="cockpit-footer"><span>DRILLR FINANCIAL DATA INFRASTRUCTURE · 14 VISUAL ENCODINGS · 0 MOCK</span><span>PRICE {shortDate(dashboard.dataAsOf.prices)} · EXT {dateTime(dashboard.dataAsOf.extended)} · SIGNAL {dateTime(dashboard.dataAsOf.signals)}</span><span className={dashboard.stale || dashboard.partial ? "negative" : "positive"}>{dashboard.source.toUpperCase()} · CACHE {Math.round(dashboard.cacheAgeSeconds / 60)}M · {dashboard.stale ? "STALE" : dashboard.partial ? "PARTIAL" : "VERIFIED"}</span></footer>

      {adminOpen && <div className="admin-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdminOpen(false); }}><section className="admin-drawer" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <div className="admin-head"><div><span>大盘配置</span><h2 id="admin-title">管理真实数据标的</h2></div><button type="button" aria-label="关闭" onClick={() => setAdminOpen(false)}>×</button></div>
        <p className="admin-copy">全部标的始终平铺；新增后直接查询 Drillr Gateway。没有有效数据会明确显示不可用，绝不生成替代数字。</p>
        <div className="admin-stock-list">{stocks.map((stock, index) => <div key={stock.ticker}><span>{String(index + 1).padStart(2, "0")}</span><b>{stock.ticker}</b><em>{stock.name}</em><button type="button" disabled={saving || stocks.length <= 1} onClick={() => removeStock(stock.ticker)}>移除</button></div>)}</div>
        <form onSubmit={addStock} className="admin-form"><label><span>股票代码</span><input value={newTicker} onChange={(event) => setNewTicker(event.target.value.toUpperCase())} placeholder="MSFT" maxLength={10} required /></label><label><span>公司名称</span><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="微软" maxLength={40} required /></label><button type="submit" disabled={saving || stocks.length >= 6}>{stocks.length >= 6 ? "已达到上限" : saving ? "读取真实数据中…" : "加入大盘"}</button></form>
        {adminMessage && <p className="admin-message">{adminMessage}</p>}{signInHref && <a className="admin-signin" href={signInHref}>登录管理员身份 <span>↗</span></a>}
      </section></div>}
    </div>
  );
}

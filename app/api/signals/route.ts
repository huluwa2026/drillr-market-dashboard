import { listDashboardStocks } from "../../../db";
import type { SignalEvent } from "../../dashboard-types";
import { gatewayJson } from "../gateway";
import {
  enforcePublicRateLimit,
  protectedJson,
  serviceUnavailable,
  withSharedApiCache,
} from "../protection";

export const dynamic = "force-dynamic";

type SignalEnvelope = {
  data?: Array<{
    headline: string;
    summary: string | null;
    suggested_tickers?: string[];
    sector?: string[];
    created_at?: string;
  }>;
};

export async function GET(request: Request) {
  const limited = await enforcePublicRateLimit(request, "signals", 4);
  if (limited) return limited;

  try {
    const stocks = await listDashboardStocks();
    const tickers = stocks.map((stock) => stock.ticker);
    const cached = await withSharedApiCache(
      `signals-v1:${tickers.join(",")}`,
      60_000,
      async () => {
        const tickerCsv = encodeURIComponent(tickers.join(","));
        const envelope = await gatewayJson<SignalEnvelope>(
          `/api/v1/signals?tickers=${tickerCsv}&limit=50`,
          undefined,
          "signals",
        );
        const signals: SignalEvent[] = (envelope.data ?? []).map((item) => ({
          id: `${item.created_at ?? "unknown"}:${item.headline}`,
          headline: item.headline,
          summary: item.summary ? item.summary.slice(0, 300) : null,
          tickers: (item.suggested_tickers ?? []).filter((ticker) => tickers.includes(ticker)),
          score: null,
          sourceNames: [],
          eventTypes: item.sector?.slice(0, 2) ?? [],
          createdAt: item.created_at ?? "",
          triggerAt: item.created_at ?? "",
        }));

        return {
          ok: true as const,
          source: "Drillr public signals" as const,
          fetchedAt: new Date().toISOString(),
          signals,
        };
      },
    );
    return protectedJson(cached.value, cached.state);
  } catch (error) {
    return serviceUnavailable("signals", "实时信号暂时不可用", error);
  }
}

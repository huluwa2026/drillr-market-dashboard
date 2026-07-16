import { listDashboardStocks } from "../../../db";
import type { IntradayBar } from "../../dashboard-types";
import { gatewayJson } from "../gateway";
import {
  enforcePublicRateLimit,
  protectedJson,
  serviceUnavailable,
  withSharedApiCache,
} from "../protection";

export const dynamic = "force-dynamic";

type OhlcvEnvelope = {
  success?: boolean;
  data?: IntradayBar[];
  error?: string;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const limited = await enforcePublicRateLimit(request, "intraday", 10);
  if (limited) return limited;

  const ticker = new URL(request.url).searchParams.get("ticker")?.trim().toUpperCase() ?? "";
  const stocks = await listDashboardStocks();
  if (!stocks.some((stock) => stock.ticker === ticker)) {
    return Response.json({ ok: false, error: "该标的不在当前自选列表中" }, { status: 400 });
  }

  try {
    const cached = await withSharedApiCache(
      `intraday-v1:${ticker}`,
      60_000,
      async () => {
        const to = new Date();
        const from = new Date(to.getTime() - 5 * 24 * 60 * 60 * 1000);
        const envelope = await gatewayJson<OhlcvEnvelope>(
          `/api/v1/quotes/ohlcv/${encodeURIComponent(ticker)}?time_frame=1min&from=${isoDate(from)}&to=${isoDate(to)}`,
          undefined,
          "intraday",
        );
        const rows = envelope.data ?? [];
        const latestSession = rows.at(-1)?.date.slice(0, 10) ?? null;
        const bars = latestSession ? rows.filter((bar) => bar.date.startsWith(latestSession)) : [];

        return {
          ok: true as const,
          ticker,
          source: "price_volume_intraday" as const,
          sourceCadenceSeconds: 60,
          fetchedAt: new Date().toISOString(),
          sessionDate: latestSession,
          bars,
        };
      },
    );
    return protectedJson(cached.value, cached.state);
  } catch (error) {
    return serviceUnavailable("intraday bars", "一分钟行情暂时不可用", error);
  }
}

import { listDashboardStocks } from "../../../db";
import type { LiveQuote, MarketIndex } from "../../dashboard-types";
import { gatewayJson, mapRows, runSql } from "../gateway";
import {
  enforcePublicRateLimit,
  protectedJson,
  serviceUnavailable,
  withSharedApiCache,
} from "../protection";

export const dynamic = "force-dynamic";

type QuoteEnvelope = {
  success?: boolean;
  data?: LiveQuote[];
  error?: string;
};

export async function GET(request: Request) {
  const limited = await enforcePublicRateLimit(request, "live", 6);
  if (limited) return limited;

  try {
    const stocks = await listDashboardStocks();
    const tickerList = stocks.map((stock) => stock.ticker).join(",");
    const cached = await withSharedApiCache(
      `live-v1:${tickerList}`,
      60_000,
      async () => {
        const symbols = encodeURIComponent(tickerList);
        const indexSql = `
          SELECT index_ticker, name, price, change, change_pct, volume, day_low, day_high,
                 year_low, year_high, open, previous_close, last_updated
          FROM index_price
          ORDER BY index_ticker
          LIMIT 20`;

        const [quoteEnvelope, indexEnvelope] = await Promise.all([
          gatewayJson<QuoteEnvelope>(`/api/v1/quotes/batch?symbols=${symbols}`, undefined, "live"),
          runSql(indexSql, "live").catch(() => null),
        ]);

        return {
          ok: true as const,
          source: "equity_price_rt" as const,
          sourceCadenceSeconds: 180,
          fetchedAt: new Date().toISOString(),
          partial: indexEnvelope === null,
          quotes: quoteEnvelope.data ?? [],
          indices: indexEnvelope ? mapRows<MarketIndex>(indexEnvelope) : [],
        };
      },
    );
    return protectedJson(cached.value, cached.state);
  } catch (error) {
    return serviceUnavailable("live quotes", "实时报价暂时不可用", error);
  }
}

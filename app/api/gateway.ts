import {
  getGatewayCircuit,
  recordGatewayFailure,
  recordGatewaySuccess,
  takeGatewayDailyRequest,
} from "../../db";

type GatewayErrorEnvelope = {
  error?: { message?: string } | string;
};

export class GatewayProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayProtectionError";
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function acquireGatewayRequest() {
  const state = await getGatewayCircuit();
  if ((state?.openUntil ?? 0) > Date.now()) {
    throw new GatewayProtectionError("Drillr Gateway circuit is temporarily open");
  }

  const dailyLimit = positiveInteger(process.env.DRILLR_DAILY_REQUEST_LIMIT, 10_000);
  const dayKey = new Date().toISOString().slice(0, 10);
  const used = await takeGatewayDailyRequest(dayKey);
  if (used > dailyLimit) {
    throw new GatewayProtectionError("Daily Drillr Gateway request budget exhausted");
  }
}

async function recordFailure() {
  const threshold = positiveInteger(process.env.DRILLR_CIRCUIT_FAILURE_THRESHOLD, 5);
  const cooldownSeconds = positiveInteger(process.env.DRILLR_CIRCUIT_COOLDOWN_SECONDS, 60);
  await recordGatewayFailure(threshold, cooldownSeconds * 1000);
}

export async function gatewayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.DRILLR_API_KEY;
  const baseUrl = (process.env.DRILLR_GATEWAY_URL ?? "https://gateway.drillr.ai").replace(/\/$/, "");
  if (!apiKey) throw new Error("DRILLR_API_KEY is not configured");

  await acquireGatewayRequest();

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (error) {
    await recordFailure();
    throw error;
  }

  const body = await response.text();
  let payload: T & GatewayErrorEnvelope;
  try {
    payload = JSON.parse(body) as T & GatewayErrorEnvelope;
  } catch {
    await recordFailure();
    throw new Error(`Drillr Gateway returned ${response.status} with an invalid response`);
  }

  if (!response.ok) {
    await recordFailure();
    const detail = typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(detail || `Drillr Gateway returned ${response.status}`);
  }
  await recordGatewaySuccess();
  return payload;
}

export type SqlEnvelope = {
  data?: { columns?: string[]; rows?: unknown[][]; rowCount?: number };
  error?: { code?: string; message?: string };
};

export async function runSql(sql: string): Promise<SqlEnvelope> {
  const envelope = await gatewayJson<SqlEnvelope>("/api/v1/data/run_sql", {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
  if (!envelope.data?.rows) throw new Error(envelope.error?.message || "run_sql returned no rows");
  return envelope;
}

export function mapRows<T>(envelope: SqlEnvelope): T[] {
  const columns = envelope.data?.columns ?? [];
  return (envelope.data?.rows ?? []).map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]])),
  ) as T[];
}

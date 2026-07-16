import {
  chatGPTSignInPath,
  getChatGPTUser,
  identitySignInAvailable,
} from "../../chatgpt-auth";
import { isSameOriginMutation } from "../../auth-policy";
import {
  deleteDashboardStock,
  listDashboardStocks,
  upsertDashboardStock,
} from "../../../db";
import { enforcePublicRateLimit } from "../protection";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.includes("At least one")) {
    return "大盘至少需要保留一个展示标的。";
  }
  if (error instanceof Error && error.message.includes("At most six")) {
    return "为保证一屏展示完整，大盘最多配置 6 只股票。";
  }
  return "数据配置暂时不可用，请稍后再试。";
}

async function requireAdmin() {
  const user = await getChatGPTUser();
  const localAdmin =
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_LOCAL_ADMIN === "true";
  const identity = user ?? (localAdmin
    ? { displayName: "Local admin", email: "local-admin@localhost", fullName: null }
    : null);
  if (!identity) return null;

  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (process.env.NODE_ENV === "production" && allowlist.length === 0) {
    return false;
  }
  if (allowlist.length > 0 && !allowlist.includes(identity.email.toLowerCase())) {
    return false;
  }
  return identity;
}

export async function GET(request: Request) {
  const limited = await enforcePublicRateLimit(request, "stocks", 6);
  if (limited) return limited;
  try {
    return Response.json({ stocks: await listDashboardStocks() });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return Response.json({ error: "拒绝跨站管理请求。" }, { status: 403 });
  }
  const admin = await requireAdmin();
  if (!admin) {
    return Response.json(
      {
        error: admin === false ? "当前账号没有管理员权限。" : "请先验证管理员身份。",
        signIn: admin === null && identitySignInAvailable() ? chatGPTSignInPath("/") : undefined,
      },
      { status: admin === false ? 403 : 401 },
    );
  }

  try {
    const payload = (await request.json()) as { ticker?: string; name?: string };
    const ticker = payload.ticker?.trim().toUpperCase() ?? "";
    const name = payload.name?.trim() ?? "";
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !name) {
      return Response.json({ error: "请输入有效的股票代码和公司名称。" }, { status: 400 });
    }
    return Response.json({ stocks: await upsertDashboardStock(ticker, name) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) {
    return Response.json({ error: "拒绝跨站管理请求。" }, { status: 403 });
  }
  const admin = await requireAdmin();
  if (!admin) {
    return Response.json(
      {
        error: admin === false ? "当前账号没有管理员权限。" : "请先验证管理员身份。",
        signIn: admin === null && identitySignInAvailable() ? chatGPTSignInPath("/") : undefined,
      },
      { status: admin === false ? 403 : 401 },
    );
  }

  try {
    const ticker = new URL(request.url).searchParams.get("ticker")?.trim().toUpperCase() ?? "";
    if (!ticker) return Response.json({ error: "缺少股票代码。" }, { status: 400 });
    return Response.json({ stocks: await deleteDashboardStock(ticker) });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

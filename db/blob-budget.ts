import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

/**
 * 每日 gateway 调用额度的持久化计数。
 *
 * 为什么不放在进程内存里:serverless 每个实例的内存互相独立、且随冷启动丢失,
 * 所以内存版的日额度实际上限是「配置值 × 活跃实例数」—— 面对分布式请求形同虚设。
 * Blob 是跨实例、跨冷启动的单一真相,配合 etag 条件写入做原子递增,
 * 这样无论前端限流被怎么绕过,一天打到 gateway 的调用次数都有硬上限。
 */

interface DailyUsage {
  date: string;
  total: number;
  scopes: Record<string, number>;
  updatedAt: string;
}

export interface ReserveResult {
  allowed: boolean;
  totalUsed: number;
  scopeUsed: number;
}

const MAX_ATTEMPTS = 6;

function budgetPath(dayKey: string): string {
  return `control/gateway-usage-${dayKey}.json`;
}

export function blobBudgetConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readUsage(pathname: string): Promise<{ value: DailyUsage; etag: string } | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const value = (await new Response(result.stream).json()) as DailyUsage;
  return { value, etag: result.blob.etag };
}

/**
 * 原子地预留一次调用额度。返回 allowed=false 表示今日额度已用尽。
 * 竞争由 etag 条件写入解决:写入前 blob 被别的实例改过就重试。
 */
export async function reserveViaBlob(
  dayKey: string,
  scope: string,
  totalLimit: number,
  scopeLimit: number,
): Promise<ReserveResult> {
  const pathname = budgetPath(dayKey);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const stored = await readUsage(pathname);
    const current: DailyUsage = stored?.value ?? {
      date: dayKey,
      total: 0,
      scopes: {},
      updatedAt: new Date(0).toISOString(),
    };

    const totalUsed = current.total;
    const scopeUsed = current.scopes[scope] ?? 0;
    if (totalUsed >= totalLimit || scopeUsed >= scopeLimit) {
      return { allowed: false, totalUsed, scopeUsed };
    }

    const next: DailyUsage = {
      date: dayKey,
      total: totalUsed + 1,
      scopes: { ...current.scopes, [scope]: scopeUsed + 1 },
      updatedAt: new Date().toISOString(),
    };

    try {
      await put(pathname, JSON.stringify(next), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: Boolean(stored?.etag),
        ifMatch: stored?.etag,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
      return { allowed: true, totalUsed: next.total, scopeUsed: next.scopes[scope]! };
    } catch (error) {
      // 别的实例抢先写了,重读再试。最后一次仍冲突才抛出。
      //
      // 两种冲突都要接住:
      //   - PreconditionFailed —— 已存在的 blob 在我们读到之后被改过(etag 不匹配)
      //   - "already exists"   —— 当天第一次调用时,两个实例都发现 blob 不存在,
      //     于是都以 allowOverwrite:false 去创建,后到的那个会撞上。
      //     SDK 没有为这种情况提供专门的错误类型,只能认消息。
      const conflict =
        error instanceof BlobPreconditionFailedError ||
        (error instanceof Error && /already exists/i.test(error.message));
      if (conflict && attempt < MAX_ATTEMPTS - 1) continue;
      throw error;
    }
  }

  throw new Error("Unable to reserve the gateway budget atomically.");
}

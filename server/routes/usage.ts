import { Hono } from "hono";

export function createUsageRoute(engine) {
  const route = new Hono();

  route.get("/usage/llm", (c) => {
    const query = c.req.query();
    const filter: Record<string, any> = {};
    for (const key of [
      "since",
      "until",
      "attributionKind",
      "sessionId",
      "sessionPath",
      "childSessionId",
      "childSessionPath",
      "agentId",
      "subsystem",
      "operation",
      "modelId",
      "provider",
      "status",
    ]) {
      if (typeof query[key] === "string" && query[key].trim()) filter[key] = query[key].trim();
    }
    const hasDateWindow = !!filter.since || !!filter.until;
    if (typeof query.limit === "string" && query.limit.trim()) {
      const rawLimit = query.limit.trim().toLowerCase();
      if (rawLimit !== "all") {
        const limit = Number(rawLimit);
        filter.limit = Number.isFinite(limit) && limit > 0
          ? Math.min(Math.floor(limit), 2_000)
          : 500;
      }
    } else if (!hasDateWindow) {
      filter.limit = 500;
    }
    return c.json(engine.usageLedger.list(filter));
  });

  // P0-4 上下文浮窗聚合：容量/组成估算 + 压缩与修剪收益 + 会话缓存命中率
  route.get("/usage/context", (c) => {
    const sessionPath = c.req.query("sessionPath");
    if (!sessionPath) {
      return c.json({ ok: false, error: "sessionPath is required" }, 400);
    }
    const breakdown = engine.getSessionContextBreakdown?.(sessionPath) || null;
    const stats = engine.getSessionContextStats?.(sessionPath)
      || { pruneCount: 0, prunedTokens: 0, compactionCount: 0, recoveredTokens: 0 };

    // 会话级缓存命中率：与设置-供应商同口径——按请求次数平均
    // （usage.cache.hit 为归一化布尔；token 求和比会因供应商输入计数口径差异爆表）
    let cache: { hitRatio: number | null; requests: number } | null = null;
    try {
      const list = engine.usageLedger?.list?.({ sessionPath, limit: 2000 }) || { entries: [] };
      let observed = 0;
      let hits = 0;
      let requests = 0;
      for (const entry of list.entries || []) {
        const u = entry?.usage;
        if (!u || typeof u !== "object") continue;
        requests += 1;
        const hit = (u as any)?.cache?.hit;
        if (hit === null || hit === undefined) continue;
        observed += 1;
        if (hit === true) hits += 1;
      }
      cache = { hitRatio: observed > 0 ? hits / observed : null, requests };
    } catch {
      cache = null;
    }

    return c.json({
      ok: true,
      contextUsage: breakdown?.contextUsage ?? null,
      breakdown: breakdown?.breakdown ?? null,
      stats,
      cache,
    });
  });

  return route;
}

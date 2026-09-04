import { describe, expect, it, vi } from "vitest";

import { HanaEngine as Engine } from "../core/engine.ts";

/**
 * P0-4 会话上下文收益统计（内存 Map）：
 * recordPruneStats / recordCompactionStats / getSessionContextStats / 会话清理。
 */

function makeEngine() {
  const engine = Object.create(Engine.prototype) as any;
  engine._sessionContextStats = new Map();
  engine._planArtifacts = new Map();
  engine._deleteSessionRuntimeMapEntry = () => {};
  engine._deleteSessionRuntimeSetEntry = () => {};
  return engine;
}

describe("engine session context stats", () => {
  it("accumulates prune stats per session", () => {
    const engine = makeEngine();
    engine.recordPruneStats("/sessions/a", 20_000);
    engine.recordPruneStats("/sessions/a", 25_000);

    expect(engine.getSessionContextStats("/sessions/a")).toMatchObject({
      pruneCount: 2,
      prunedTokens: 45_000,
      compactionCount: 0,
      recoveredTokens: 0,
    });
  });

  it("accumulates compaction recoveries independently of prunes", () => {
    const engine = makeEngine();
    engine.recordPruneStats("/sessions/a", 10_000);
    engine.recordCompactionStats("/sessions/a", 120_000);
    engine.recordCompactionStats("/sessions/a", 80_000);

    expect(engine.getSessionContextStats("/sessions/a")).toMatchObject({
      pruneCount: 1,
      prunedTokens: 10_000,
      compactionCount: 2,
      recoveredTokens: 200_000,
    });
  });

  it("ignores zero/negative token records and unknown sessions", () => {
    const engine = makeEngine();
    engine.recordPruneStats("/sessions/a", 0);
    engine.recordCompactionStats("/sessions/a", -5);

    expect(engine.getSessionContextStats("/sessions/a")).toMatchObject({
      pruneCount: 0,
      prunedTokens: 0,
      compactionCount: 0,
      recoveredTokens: 0,
    });
    expect(engine.getSessionContextStats("/sessions/b")).toMatchObject({
      pruneCount: 0,
      prunedTokens: 0,
      compactionCount: 0,
      recoveredTokens: 0,
    });
  });

  it("session runtime cleanup drops the stats entry", () => {
    const engine = makeEngine();
    engine.setPlanArtifact = () => {};
    engine.recordPruneStats("/sessions/a", 5_000);
    engine.clearSessionRuntimeState = Engine.prototype.clearSessionRuntimeState;
    engine._deleteSessionRuntimeMapEntry = () => {};
    engine._deleteSessionRuntimeSetEntry = () => {};

    engine.clearSessionRuntimeState("/sessions/a");

    expect(engine._sessionContextStats.has("/sessions/a")).toBe(false);
  });

  it("stats are isolated per session", () => {
    const engine = makeEngine();
    engine.recordPruneStats("/sessions/a", 1_000);
    engine.recordCompactionStats("/sessions/b", 2_000);

    expect(engine.getSessionContextStats("/sessions/a").prunedTokens).toBe(1_000);
    expect(engine.getSessionContextStats("/sessions/a").recoveredTokens).toBe(0);
    expect(engine.getSessionContextStats("/sessions/b").recoveredTokens).toBe(2_000);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fsSync from "fs";
import os from "os";
import path from "path";

/**
 * 回归测试：终止（abort）运行中的会话后，权限模式仍可切换。
 *
 * 根因回顾：_forceReleaseStreamingSession 原实现会删除 _hibernatedSessionMeta +
 * _sessions 条目并清空焦点指针，导致终止后所有权限写入路径 409（session not found /
 * requires an active session）。修复 = 仿休眠路径写 meta 快照并保留焦点 path；
 * discardSessionRuntime 的"真删除"语义保持不变（删除/关闭会话仍清光）。
 */

async function loadCoord(tmpDir, overrides: any = {}) {
  const { SessionCoordinator } = await import("../core/session-coordinator.ts");
  const deps = {
    agentsDir: path.join(tmpDir, "agents"),
    listAgents: () => [{ id: "a", name: "AgentA" }],
    getAgent: (id) => (id ? { id, agentName: `Agent${String(id).toUpperCase()}` } : { id: "a", agentName: "AgentA" }),
    getActiveAgentId: () => "a",
    agentIdFromSessionPath: (p) => {
      const rel = path.relative(path.join(tmpDir, "agents"), p);
      return rel.split(path.sep)[0];
    },
    listDeletedAgents: () => [],
    isAgentDeleted: () => false,
    getAgentById: (id) => (id ? { id, agentName: `Agent${String(id).toUpperCase()}` } : { id: "a", agentName: "AgentA" }),
    emitEvent: vi.fn(),
    emitDevLog: vi.fn(),
    ...overrides,
  };
  return new SessionCoordinator(deps);
}

function makeStreamingEntry(sessionPath: string) {
  const session = {
    isStreaming: true,
    abort: async () => {},
    dispose: () => {},
    getContextUsage: () => null,
    sessionManager: {
      getSessionFile: () => sessionPath,
      getCwd: () => path.dirname(sessionPath),
    },
  };
  return {
    session,
    unsub: () => {},
    sessionId: "s1",
    agentId: "a",
    permissionMode: "operate",
    workflowMode: "normal",
    effectiveWorkflowMode: "normal",
    accessMode: "operate",
    planMode: false,
    thinkingLevel: null,
    memoryEnabled: false,
    experienceEnabled: false,
    modelId: null,
    modelProvider: null,
    cwd: path.dirname(sessionPath),
    workspaceFolders: [],
    authorizedFolders: [],
    toolNames: [],
    lastTouchedAt: Date.now(),
  };
}

describe("session-coordinator: abort keeps permission mode switchable", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "hana-coord-abort-"));
  });

  afterEach(() => {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupStreamingFocus(coord, sessionPath) {
    const entry = makeStreamingEntry(sessionPath);
    coord._setRuntimeValueForPath(coord._sessions, sessionPath, entry);
    coord._session = entry.session;
    coord._currentSessionPath = sessionPath;
    coord._sessionStarted = true;
    // 与磁盘/manifest 相关的副作用在单测中打桩，只验证状态机与 meta 写入
    coord._teardownSessionEntry = async () => {};
    coord._refreshRuntimeWorkflowPrompt = () => null;
    coord.writeSessionMeta = vi.fn();
    coord._resolveSessionManifestForPath = () => null;
    return entry;
  }

  it("force-release keeps hibernated meta and focus path so mode stays switchable", async () => {
    const sessionPath = path.join(tmpDir, "agents", "a", "sessions", "s1.jsonl");
    const coord = await loadCoord(tmpDir);
    const entry = setupStreamingFocus(coord, sessionPath);

    expect(coord._forceReleaseStreamingSession(entry, sessionPath, "test")).toBe(true);

    // 焦点对象被卸载，但焦点 path 保留（与休眠路径一致）
    expect(coord._session).toBeNull();
    expect(coord._currentSessionPath).toBe(sessionPath);
    expect(coord._sessionStarted).toBe(false);

    // 终止后按路径切换权限模式必须成功（回归主 bug）
    const result = coord.setSessionPermissionMode(sessionPath, "ask");
    expect(result.ok).toBe(true);
    expect(coord.getPermissionMode(sessionPath)).toBe("ask");

    // 写入落在 hibernated meta 上，且会话元数据被持久化
    const meta = coord._getRuntimeValueForPath(coord._hibernatedSessionMeta, sessionPath);
    expect(meta?.permissionMode).toBe("ask");
    expect(coord.writeSessionMeta).toHaveBeenCalled();

    // currentSessionOnly 分支同样可切（焦点 path 保留的收益）
    expect(coord.setCurrentSessionPermissionMode("read_only").ok).toBe(true);
    expect(coord.getPermissionMode(sessionPath)).toBe("read_only");
  });

  it("discardSessionRuntime keeps hard-delete semantics (meta and focus cleared)", async () => {
    const sessionPath = path.join(tmpDir, "agents", "a", "sessions", "s2.jsonl");
    const coord = await loadCoord(tmpDir);
    setupStreamingFocus(coord, sessionPath);

    await coord.discardSessionRuntime(sessionPath, "test");

    expect(coord._getRuntimeValueForPath(coord._hibernatedSessionMeta, sessionPath)).toBeFalsy()
    expect(coord.currentSessionPath).toBeNull();
    expect(coord._getSessionEntryByPath(sessionPath)).toBeFalsy();
  });
});

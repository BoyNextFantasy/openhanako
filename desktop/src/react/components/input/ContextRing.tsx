import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '../../stores';
import { isSessionCompacting } from '../../stores/context-slice';
import { sessionScopedListIncludes, sessionScopedValue } from '../../stores/session-slice';
import { useI18n } from '../../hooks/use-i18n';
import { getWebSocket } from '../../services/websocket';
import { refreshSessionCapabilities } from '../../stores/session-actions';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { AnchoredPortal } from '../../ui';
import { shouldShowContextRingTokenLabel } from './context-ring-visibility';
import styles from './InputArea.module.css';

/** P0-4：/api/usage/context 聚合数据（组成估算 + 压缩/修剪收益 + 缓存命中） */
type ContextStats = {
  contextUsage: { tokens: number | null; contextWindow: number | null; percent: number | null } | null;
  breakdown: { estimated: boolean; systemPromptTokens: number; toolsTokens: number; messagesTokens: number; otherTokens: number } | null;
  stats: { pruneCount: number; prunedTokens: number; compactionCount: number; recoveredTokens: number };
  cache: { hitRatio: number | null; requests: number } | null;
};

/** 万级紧凑格式化：52000 → 5.2万 */
function formatCompact(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}

const HOVER_CLOSE_DELAY = 200;

/**
 * 上下文圆环（P0-4）：小圆环常驻，鼠标悬停弹出分层统计浮窗——
 * 容量层（总量/窗口/进度条）→ 组成层（估算分解）→ 收益层（缓存命中/治理节省）→ 操作层（压缩）。
 * 移开鼠标即收起；浮窗内可停留（悬停区域包含浮窗本身）。
 */
export function ContextRing() {
  const { t } = useI18n();
  const agentYuan = useStore(s => s.agentYuan);
  const [tokens, setTokens] = useState<number | null>(null);
  const [contextWindow, setContextWindow] = useState<number | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [stats, setStats] = useState<ContextStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  // 从 Zustand store 同步 context 数据（keyed store 优先，compat global 兜底）
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const contextEntry = useStore(s => (
    s.currentSessionPath ? sessionScopedValue(s, s.contextBySession, s.currentSessionPath) : null
  ));
  const globalContextTokens = useStore(s => s.contextTokens);
  const globalContextWindow = useStore(s => s.contextWindow);
  const globalContextPercent = useStore(s => s.contextPercent);
  const storeContextTokens = contextEntry?.tokens ?? globalContextTokens;
  const storeContextWindow = contextEntry?.window ?? globalContextWindow;
  const storeContextPercent = contextEntry?.percent ?? globalContextPercent;
  const storeCompacting = useStore(s => isSessionCompacting(s, currentSessionPath));
  const refreshing = useStore(s => sessionScopedListIncludes(s, s.capabilityRefreshingSessions, currentSessionPath));
  const busy = compacting || refreshing;

  useEffect(() => {
    setTokens(storeContextTokens ?? null);
    setContextWindow(storeContextWindow ?? null);
    setPercent(storeContextPercent ?? null);
    setCompacting(storeCompacting);
  }, [storeContextTokens, storeContextWindow, storeContextPercent, storeCompacting]);

  // 会话切换：收起浮窗并重置状态
  useEffect(() => {
    setHoverOpen(false);
    setStats(null);
  }, [currentSessionPath]);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setHoverOpen(false), HOVER_CLOSE_DELAY);
  }, [cancelClose]);

  const openHover = useCallback(() => {
    cancelClose();
    setHoverOpen(true);
  }, [cancelClose]);

  // 悬停展开时拉取统计；压缩/刷新结束后自动刷新一次
  const prevBusyRef = useRef(false);
  useEffect(() => {
    if (!hoverOpen || !currentSessionPath) return;
    let cancelled = false;
    setStatsLoading(true);
    hanaFetch(`/api/usage/context?sessionPath=${encodeURIComponent(currentSessionPath)}`, { throwOnHttpError: false })
      .then((res) => res.json())
      .then((data) => { if (!cancelled && data) setStats(data); })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [hoverOpen, currentSessionPath]);

  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (wasBusy && !busy && hoverOpen && currentSessionPath) {
      let cancelled = false;
      hanaFetch(`/api/usage/context?sessionPath=${encodeURIComponent(currentSessionPath)}`, { throwOnHttpError: false })
        .then((res) => res.json())
        .then((data) => { if (!cancelled && data) setStats(data); })
        .catch(() => {});
      return () => { cancelled = true; };
    }
  }, [busy, hoverOpen, currentSessionPath]);

  const handleRefreshAndCompact = useCallback(() => {
    if (!currentSessionPath || busy) return;
    void refreshSessionCapabilities(currentSessionPath);
  }, [busy, currentSessionPath]);

  const handleCompact = useCallback(() => {
    if (!currentSessionPath || busy) return;
    const ws = getWebSocket();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'compact', sessionPath: currentSessionPath }));
    }
  }, [busy, currentSessionPath]);

  if (!currentSessionPath) return null;
  const displayTokens = tokens ?? 0;
  const pct = percent ?? 0;
  const showTokenLabel = shouldShowContextRingTokenLabel(tokens);
  const yuan = agentYuan || 'hanako';

  const tokensK = Math.round(displayTokens / 1000);

  // SVG 圆环参数
  const r = 6;
  const sw = 2.5;
  const size = (r + sw) * 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * r;
  const strokeDashoffset = circumference * (1 - Math.min(pct, 100) / 100);

  // 浮窗数据（store 实时值优先，统计接口补充分解/收益）
  const total = storeContextTokens ?? stats?.contextUsage?.tokens ?? 0;
  const windowTokens = storeContextWindow ?? stats?.contextUsage?.contextWindow ?? 0;
  const usedPct = Math.min(100, Math.round(storeContextPercent ?? stats?.contextUsage?.percent ?? 0));
  const bd = stats?.breakdown ?? null;
  const bdRows: Array<{ label: string; tokens: number }> = bd ? [
    { label: '系统提示词', tokens: bd.systemPromptTokens },
    { label: '工具定义', tokens: bd.toolsTokens },
    { label: '消息', tokens: bd.messagesTokens },
    { label: '其他', tokens: bd.otherTokens },
  ] : [];
  const hit = stats?.cache?.hitRatio;
  const savedTotal = (stats?.stats.recoveredTokens ?? 0) + (stats?.stats.prunedTokens ?? 0);

  return (
    <>
      <span
        className={styles['context-ring-wrap']}
        data-testid="context-ring-wrap"
        ref={(node) => {
          anchorRef.current = node;
        }}
        onMouseEnter={openHover}
        onMouseLeave={scheduleClose}
      >
        <button
          type="button"
          className={`${styles['context-ring']}${compacting ? ` ${styles.compacting}` : ''}`}
          data-yuan={yuan}
          aria-haspopup="dialog"
          aria-expanded={hoverOpen}
          aria-label={t('input.contextActions')}
        >
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={center} cy={center} r={r} fill="none" stroke="var(--ring-bg)" strokeWidth={sw} />
            <circle
              cx={center} cy={center} r={r}
              fill="none"
              stroke="var(--ring-fg)"
              strokeWidth={sw}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              transform={`rotate(-90 ${center} ${center})`}
              className={styles['context-ring-progress']}
            />
          </svg>
          {showTokenLabel && (
            <span className={styles['context-ring-label']}>{tokensK}k</span>
          )}
        </button>
      </span>
      <AnchoredPortal
        open={hoverOpen}
        anchorRef={anchorRef}
        className={styles['context-hover-wrap']}
        align="end"
        offset={6}
        onClose={() => setHoverOpen(false)}
      >
        <div
          className={styles['context-panel']}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {/* 容量层 */}
          <div className={styles['context-panel-head']}>
            <span className={styles['context-panel-title']}>上下文容量</span>
            <span className={styles['context-panel-num']}>
              {formatCompact(total)} / {formatCompact(windowTokens)} · {usedPct}%
            </span>
          </div>
          <div className={styles['context-stats-bar']}>
            <div
              className={styles['context-stats-bar-fill']}
              style={{ width: `${usedPct}%` }}
            />
          </div>

          {/* 组成层 */}
          <div className={styles['context-panel-section']}>
            <div className={styles['context-panel-section-title']}>
              组成{bd?.estimated ? '（估算）' : ''}
            </div>
            {statsLoading && !stats ? (
              <div className={styles['context-stats-note']}>统计加载中…</div>
            ) : bd ? (
              <div className={styles['context-stats-breakdown']}>
                {bdRows.map((row) => {
                  const share = total > 0 ? Math.round((row.tokens / total) * 1000) / 10 : 0;
                  return (
                    <div key={row.label} className={styles['context-stats-row']}>
                      <span className={styles['context-stats-dot']} />
                      <span className={styles['context-stats-label']}>{row.label}</span>
                      <span className={styles['context-stats-value']}>{share}%</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles['context-stats-note']}>暂无数据</div>
            )}
          </div>

          {/* 收益层 */}
          <div className={styles['context-panel-section']}>
            <div className={styles['context-panel-section-title']}>治理收益</div>
            {hit != null && (
              <div className={styles['context-stats-kv']}>
                <span>平均缓存命中率</span>
                <span>{Math.round(hit * 100)}%</span>
              </div>
            )}
            <div className={styles['context-stats-kv']}>
              <span>已节省（压缩 + 修剪）</span>
              <span>{savedTotal > 0 ? `${formatCompact(savedTotal)} token` : '—'}</span>
            </div>
            {(stats?.stats.compactionCount ?? 0) + (stats?.stats.pruneCount ?? 0) > 0 && (
              <div className={styles['context-stats-note']}>
                压缩 {stats?.stats.compactionCount ?? 0} 次 · 修剪 {stats?.stats.pruneCount ?? 0} 次
              </div>
            )}
          </div>

          {/* 操作层 */}
          <div className={styles['context-panel-actions']}>
            <button
              type="button"
              className={styles['context-panel-action']}
              onClick={handleRefreshAndCompact}
              disabled={busy || refreshing}
              title={t('input.refreshAndCompactTooltip')}
            >
              {refreshing ? '刷新中…' : t('input.refreshAndCompact')}
            </button>
            <button
              type="button"
              className={styles['context-panel-action']}
              onClick={handleCompact}
              disabled={busy}
            >
              {compacting ? '压缩中…' : t('input.compact')}
            </button>
          </div>
        </div>
      </AnchoredPortal>
    </>
  );
}

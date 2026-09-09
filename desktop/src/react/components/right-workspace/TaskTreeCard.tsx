/**
 * TaskTreeCard — 右侧「任务计划」卡
 *
 * LLM 任务树（Plan 确认开工后由 plan-workflow 建树）：树形缩进 + 5 态图标。
 * 数据来自 GET /api/tasks（5s 轮询，TaskRegistry 无 agent 隔离，全局任务池），
 * 支持 done/abandon（POST /api/tasks/:id）。无任务时整卡隐藏。
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useStore } from '../../stores';
import styles from './TaskTreeCard.module.css';

const POLL_INTERVAL_MS = 5000;

export interface TaskNode {
  id: string;
  summary: string;
  status: string;
  parentTaskId: string | null;
  owner: string | null;
  lastEventKind: string | null;
  lastEventSummary: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  endedAt: number | null;
  children: TaskNode[];
}

const ACTIVE_STATUSES = new Set(['open', 'in_progress', 'blocked']);

const STATUS_GLYPH: Record<string, string> = {
  open: '○',
  blocked: '⊘',
  done: '✓',
  abandoned: '×',
};

function textWithFallback(key: string, fallback: string) {
  const translated = window.t?.(key);
  return translated && translated !== key ? translated : fallback;
}

function countNodes(nodes: TaskNode[]): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const node of nodes) {
    total += 1;
    if (node.status === 'done') done += 1;
    const child = countNodes(node.children);
    total += child.total;
    done += child.done;
  }
  return { total, done };
}

function DisclosureIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {expanded ? <polyline points="6 9 12 15 18 9" /> : <polyline points="9 6 15 12 9 18" />}
    </svg>
  );
}

function InProgressIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 3v5m0 0h-5m5 0-3-2.708A9 9 0 1 0 20.777 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DoneIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function AbandonIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export function TaskTreeCard() {
  const sessionPath = useStore((s) => s.currentSessionPath);
  const [tasks, setTasks] = useState<TaskNode[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);

  // 任务按会话过滤：只显示当前会话建的任务树（历史遗留的无标记任务自然排除）。
  // 返回 null 表示「本次没拿到结果」（无会话/请求失败），调用方不应覆盖已有数据。
  const fetchTasks = useCallback(async (): Promise<TaskNode[] | null> => {
    if (!sessionPath) return null;
    try {
      const res = await hanaFetch(`/api/tasks?sessionPath=${encodeURIComponent(sessionPath)}`);
      const data = await res.json();
      return data?.ok && Array.isArray(data.tasks) ? (data.tasks as TaskNode[]) : null;
    } catch {
      return null;
    }
  }, [sessionPath]);

  // 递归 await 轮询（等上一次请求完成再等 5s），避免请求堆叠；
  // stopped 用 effect 局部变量（跨 effect 共享的 ref 会在会话切换时被新 effect 复位，
  // 导致旧循环无法退出、双循环交替写状态）。
  useEffect(() => {
    let stopped = false;
    (async () => {
      while (!stopped) {
        const next = await fetchTasks();
        if (stopped) return;
        if (next !== null) setTasks(next);
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [fetchTasks]);

  if (!sessionPath || !tasks || !tasks.length) return null;

  const { total, done } = countNodes(tasks);
  const title = textWithFallback('rightWorkspace.tasks.title', '任务计划');

  function toggleExpanded(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAction(id: string, action: 'done' | 'abandon') {
    if (pendingId) return;
    setPendingId(id);
    try {
      await hanaFetch(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
    } catch {
      // 静默：失败等下一轮轮询反映真实状态
    } finally {
      const next = await fetchTasks();
      if (next !== null) setTasks(next);
      setPendingId(null);
    }
  }

  function renderRows(nodes: TaskNode[], depth: number): ReactNode[] {
    return nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const expanded = !collapsed.has(node.id);
      const active = ACTIVE_STATUSES.has(node.status);
      return (
        <div key={node.id}>
          <div
            className={styles.row}
            data-status={node.status}
            data-task-id={node.id}
            style={{ '--task-depth': depth } as CSSProperties}
          >
            <span className={styles.disclosure}>
              {hasChildren ? (
                <button
                  type="button"
                  className={styles.disclosureButton}
                  aria-label={textWithFallback('rightWorkspace.tasks.toggle', '展开/折叠子任务')}
                  aria-expanded={expanded}
                  onClick={() => toggleExpanded(node.id)}
                >
                  <DisclosureIcon expanded={expanded} />
                </button>
              ) : null}
            </span>
            <span className={styles.icon} aria-hidden="true">
              {node.status === 'in_progress' ? <InProgressIcon /> : STATUS_GLYPH[node.status] ?? '○'}
            </span>
            <span className={styles.text} title={node.summary}>{node.summary}</span>
            {active && (
              <span className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionButton}
                  aria-label={textWithFallback('rightWorkspace.tasks.markDone', '标记完成')}
                  title={textWithFallback('rightWorkspace.tasks.markDone', '标记完成')}
                  disabled={pendingId !== null}
                  onClick={() => handleAction(node.id, 'done')}
                >
                  <DoneIcon />
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  aria-label={textWithFallback('rightWorkspace.tasks.abandon', '放弃任务')}
                  title={textWithFallback('rightWorkspace.tasks.abandon', '放弃任务')}
                  disabled={pendingId !== null}
                  onClick={() => handleAction(node.id, 'abandon')}
                >
                  <AbandonIcon />
                </button>
              </span>
            )}
          </div>
          {hasChildren && expanded && renderRows(node.children, depth + 1)}
        </div>
      );
    });
  }

  return (
    <section className={`universal-card ${styles.card}`} aria-label={title}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>{done}/{total}</span>
      </div>
      <div className={styles.list}>
        {renderRows(tasks, 0)}
      </div>
    </section>
  );
}

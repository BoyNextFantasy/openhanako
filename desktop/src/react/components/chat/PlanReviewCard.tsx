import { useEffect, useState } from 'react';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useStore } from '../../stores';
import styles from './PlanReviewCard.module.css';

/**
 * 计划卡（聊天流内）
 *
 * plan_submit 非阻塞提交：工具立即返回，卡片渲染在该工具调用的位置。
 * - pending（store 状态为 pending 且工具未结束）→ 可交互：确认 / ✕ 关闭
 *   - 确认 → POST /api/plan/confirm：服务端建任务树 + plan 模式代切完整权限 +
 *     注入开工用户消息 → 模型在新轮次收到「开始执行」并立即动手
 *   - ✕ → POST /api/plan/dismiss → 服务端标记 cancelled，模型下轮以最新输入为准
 * - 非 pending → 历史静态卡（状态来自 store 的 plan_review_update 或 tool.details.outcome）
 * - 刷新恢复：未完成的卡挂载时拉一次 GET /api/plan/artifact，pending 匹配则恢复交互态
 */

type PlanStep = {
  index: number;
  title: string;
  details: string;
  files: string[];
  acceptance: string;
};

type PlanArtifactUi = {
  goal: string;
  scope: string[];
  outOfScope: string[];
  steps: PlanStep[];
  risks: string[];
  testPlan: string[];
  confirmationPoints: string[];
};

interface PlanReviewCardProps {
  variant?: 'inline' | 'modal';
  tool: {
    id?: string;
    name: string;
    args?: Record<string, unknown>;
    done: boolean;
    success: boolean;
    details?: { outcome?: string; [key: string]: unknown } | null;
  };
  sessionPath: string;
}

function text(key: string, fallback: string) {
  const translated = (window as any).t?.(key);
  return translated && translated !== key ? translated : fallback;
}

const STATUS_LABELS: Record<string, string> = {
  pending: '等待你的裁决',
  confirmed: '已确认 · 执行开始',
  cancelled: '已取消',
  superseded: '已作废 · 以用户最新输入为准',
};

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div className={styles['plan-section']}>
      <div className={styles['plan-section-title']}>{title}</div>
      <ul className={styles['plan-list']}>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  );
}

export function PlanReviewCard({ tool, sessionPath, variant = 'inline' }: PlanReviewCardProps) {
  const artifact = (tool.args && (tool.args as PlanArtifactUi).goal ? tool.args : null) as PlanArtifactUi | null;
  const status = useStore((s) => (tool.id ? s.planReviewByToolCall[tool.id] : undefined));
  const setPlanReviewStatus = useStore((s) => s.setPlanReviewStatus);
  const setPendingPlan = useStore((s) => s.setPendingPlan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // pending 只看 store 状态：非阻塞下工具瞬间 done，tool.done 不能作为裁决依据
  const pending = status === 'pending';

  // 刷新恢复：未完成的卡若丢失状态，向服务端查询自己是否是 pending 的那张
  useEffect(() => {
    const toolId = tool.id;
    if (status || tool.done || !toolId || !sessionPath) return;
    let cancelled = false;
    hanaFetch(`/api/plan/artifact?sessionPath=${encodeURIComponent(sessionPath)}`, { throwOnHttpError: false })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data?.pending) return;
        if (data.pending.toolCallId === toolId) {
          setPlanReviewStatus(toolId, 'pending');
          setPendingPlan(sessionPath, { toolCallId: toolId, artifact: data.pending.artifact });
        }
      })
      .catch(() => { /* 恢复失败静默：卡片保持静态 */ });
    return () => { cancelled = true; };
  }, [status, tool.done, tool.id, sessionPath, setPlanReviewStatus, setPendingPlan]);

  if (!artifact) {
    return <div className={styles['plan-card']}><div className={styles['plan-status']}>{text('plan.generating', '计划卡生成中…')}</div></div>;
  }

  const handleConfirm = async () => {
    if (busy || !pending) return;
    setBusy(true);
    setError('');
    try {
      const res = await hanaFetch('/api/plan/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionPath }),
        throwOnHttpError: false,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      if (tool.id) setPlanReviewStatus(tool.id, 'confirmed');
      setPendingPlan(sessionPath, null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    if (busy || !pending) return;
    setBusy(true);
    setError('');
    try {
      const res = await hanaFetch('/api/plan/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionPath }),
        throwOnHttpError: false,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      if (tool.id) setPlanReviewStatus(tool.id, 'cancelled');
      setPendingPlan(sessionPath, null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const outcome = typeof tool.details?.outcome === 'string' ? tool.details.outcome : null;
  const statusLine = pending
    ? text('plan.awaiting', '等待你的裁决：确认开始执行，或 ✕ 关闭 / 直接输入修改意见')
    : (status && (STATUS_LABELS[status] || status))
      || (tool.done ? text('plan.processed', '已处理') : text('plan.syncing', '状态同步中…'));
  const isConfirmed = status === 'confirmed' || outcome === 'confirmed';

  return (
    <div className={`${styles['plan-card']} ${variant === 'modal' ? styles['plan-card-modal'] : ''} ${pending ? '' : styles['plan-card-resolved']}`}>
      <div className={styles['plan-head']}>
        <span className={styles['plan-badge']}>{text('plan.badge', '计划卡')}</span>
        <span className={`${styles['plan-status']} ${isConfirmed ? styles['plan-status-confirmed'] : ''}`}>
          {statusLine}
        </span>
        {pending && (
          <button
            type="button"
            className={styles['plan-close']}
            onClick={handleDismiss}
            disabled={busy}
            title={text('plan.dismissHint', '关闭计划卡：模型会以你的最新输入为准')}
            aria-label={text('plan.dismiss', '关闭计划卡')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      <div className={styles['plan-body']}>
        <p className={styles['plan-goal']}>{artifact.goal}</p>
        <Section title={text('plan.scope', '范围')} items={artifact.scope} />
        <Section title={text('plan.outOfScope', '范围外')} items={artifact.outOfScope} />
        {artifact.steps?.length > 0 && (
          <div className={styles['plan-section']}>
            <div className={styles['plan-section-title']}>{text('plan.steps', '实施步骤')}</div>
            <ul className={styles['plan-list']}>
              {artifact.steps.map((step, i) => (
                <li key={i} className={styles['plan-step']}>
                  <span className={styles['plan-step-title']}>
                    <span className={styles['plan-step-index']}>{step.index ?? i + 1}.</span>
                    {step.title}
                  </span>
                  <div className={styles['plan-step-meta']}>
                    <div>{step.details}</div>
                    {step.files?.length > 0 && (
                      <div><strong>{text('plan.files', '文件')}：</strong>{step.files.join('、')}</div>
                    )}
                    <div><strong>{text('plan.acceptance', '验收')}：</strong>{step.acceptance}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Section title={text('plan.risks', '风险')} items={artifact.risks} />
        <Section title={text('plan.testPlan', '测试计划')} items={artifact.testPlan} />
        <Section title={text('plan.confirmationPoints', '需要你确认的点')} items={artifact.confirmationPoints} />
      </div>
      {pending && (
        <div className={styles['plan-foot']}>
          <div className={styles['plan-hint']}>
            {text('plan.hint', '确认后将创建任务树并自动切换到完整权限开始执行；也可以直接输入修改意见（当前卡会作废）。')}
            {error && <div className={styles['plan-error']}>{error}</div>}
          </div>
          <button
            type="button"
            className={styles['plan-confirm']}
            disabled={busy}
            onClick={handleConfirm}
          >
            {busy ? text('plan.confirming', '确认中…') : text('plan.confirmButton', '确认并开始执行')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 计划卡弹窗挂载点（ChatPage 层）：当前会话存在 pending 计划卡时浮窗展示。
 * 点遮罩仅收起浮窗（卡仍在消息流内可交互），✕ 才是真正的取消。
 */
export function PlanReviewBar() {
  const currentSessionPath = useStore((s) => s.currentSessionPath);
  const pendingPlan = useStore((s) => (s.currentSessionPath ? s.pendingPlanByPath[s.currentSessionPath] : undefined));
  const [closedFor, setClosedFor] = useState<string | null>(null);

  const open = pendingPlan && pendingPlan.toolCallId !== closedFor;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pendingPlan) setClosedFor(pendingPlan.toolCallId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingPlan]);

  if (!open || !currentSessionPath) return null;

  const modalTool = {
    id: pendingPlan.toolCallId,
    name: 'plan_submit',
    args: pendingPlan.artifact as Record<string, unknown>,
    done: false,
    success: false,
  };

  return (
    <>
      <div className={styles.backdrop} onClick={() => setClosedFor(pendingPlan.toolCallId)} />
      <div className={styles.wrapper} onClick={() => setClosedFor(pendingPlan.toolCallId)}>
        <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
          <PlanReviewCard variant="modal" tool={modalTool} sessionPath={currentSessionPath} />
        </div>
      </div>
    </>
  );
}

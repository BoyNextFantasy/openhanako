import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useStore } from '../../stores';
import { parseMemoryFacts, serializeMemoryFacts } from './memory-review-utils';
import styles from './Chat.module.css';

interface Props {
  agentId?: string | null;
}

interface CompiledMemoryResponse {
  editableFactsEnabled?: boolean;
  sections?: {
    facts?: string;
    today?: string;
    week?: string;
    longterm?: string;
  };
  error?: string;
}

interface PinnedResponse {
  pins?: unknown[];
  error?: string;
}

export const MemoryReviewCard = memo(function MemoryReviewCard({ agentId }: Props) {
  const currentAgentId = useStore(s => s.currentAgentId);
  const resolvedAgentId = (agentId || currentAgentId || '').trim();
  const [items, setItems] = useState<string[]>([]);
  const [editableFactsEnabled, setEditableFactsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addToast = useStore(s => s.addToast);

  const agentQuery = useMemo(() => (
    resolvedAgentId ? `?agentId=${encodeURIComponent(resolvedAgentId)}` : ''
  ), [resolvedAgentId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!resolvedAgentId) throw new Error('找不到当前助手，暂时不能读取记忆。');
        const res = await hanaFetch(`/api/memories/compiled${agentQuery}`);
        const data = await res.json() as CompiledMemoryResponse;
        if (data.error) throw new Error(data.error);
        if (cancelled) return;
        setEditableFactsEnabled(data.editableFactsEnabled === true);
        setItems(parseMemoryFacts(data.sections?.facts || ''));
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || '记忆读取失败');
        setItems([]);
        setEditableFactsEnabled(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [agentQuery, resolvedAgentId]);

  const pinItem = useCallback(async (item: string) => {
    if (!resolvedAgentId || busyItem) return;
    setBusyItem(item);
    setError(null);
    try {
      const endpoint = `/api/agents/${encodeURIComponent(resolvedAgentId)}/pinned`;
      const res = await hanaFetch(endpoint);
      const data = await res.json() as PinnedResponse;
      if (data.error) throw new Error(data.error);
      const pins = (Array.isArray(data.pins) ? data.pins : [])
        .filter((pin): pin is string => typeof pin === 'string')
        .map(pin => pin.trim())
        .filter(Boolean);
      if (pins.includes(item)) {
        addToast('这条记忆已经置顶了', 'info');
        return;
      }
      const saveRes = await hanaFetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins: [...pins, item] }),
      });
      const saveData = await saveRes.json() as { error?: string };
      if (saveData.error) throw new Error(saveData.error);
      addToast('已置顶这条记忆', 'success');
    } catch (err: any) {
      const message = err?.message || '置顶失败';
      setError(message);
      addToast(message, 'error');
    } finally {
      setBusyItem(null);
    }
  }, [addToast, busyItem, resolvedAgentId]);

  const forgetItem = useCallback(async (item: string) => {
    if (!resolvedAgentId || busyItem || !editableFactsEnabled) return;
    const previousItems = items;
    const nextItems = previousItems.filter(current => current !== item);
    setBusyItem(item);
    setError(null);
    setItems(nextItems);
    try {
      const res = await hanaFetch(`/api/memories/compiled/facts${agentQuery}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts: serializeMemoryFacts(nextItems) }),
      });
      const data = await res.json() as { facts?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (typeof data.facts === 'string') setItems(parseMemoryFacts(data.facts));
      addToast('已移除这条记忆', 'success');
    } catch (err: any) {
      const message = err?.message || '保存失败';
      setItems(previousItems);
      setError(message);
      addToast(message, 'error');
    } finally {
      setBusyItem(null);
    }
  }, [addToast, agentQuery, busyItem, editableFactsEnabled, items, resolvedAgentId]);

  return (
    <section className={styles.memoryReviewCard} aria-label="Satori 想到的事">
      <div className={styles.memoryReviewHeader}>
        <div className={styles.memoryReviewTitle}>Satori 想到的事</div>
        {loading && <div className={styles.memoryReviewMeta}>读取中...</div>}
      </div>
      {!loading && !editableFactsEnabled && (
        <div className={styles.memoryReviewHint}>
          打开“可编辑记忆”实验后，可以在这里直接删除记忆。
        </div>
      )}
      {error && <div className={styles.memoryReviewError}>{error}</div>}
      {!loading && items.length === 0 ? (
        <div className={styles.memoryReviewEmpty}>
          现在没有可展示的事实记忆。
        </div>
      ) : (
        <div className={styles.memoryReviewList}>
          {items.map(item => (
            <div className={styles.memoryReviewItem} key={item}>
              <div className={styles.memoryReviewText}>{item}</div>
              <div className={styles.memoryReviewActions}>
                <button
                  type="button"
                  className={styles.memoryReviewButton}
                  onClick={() => { void pinItem(item); }}
                  disabled={busyItem !== null}
                >
                  置顶
                </button>
                {editableFactsEnabled && (
                  <button
                    type="button"
                    className={`${styles.memoryReviewButton} ${styles.memoryReviewButtonDanger}`}
                    onClick={() => { void forgetItem(item); }}
                    disabled={busyItem !== null}
                  >
                    不再记住
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});

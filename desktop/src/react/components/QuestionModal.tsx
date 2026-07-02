import React from 'react';
import { useStore } from '../stores';
import { Overlay } from '../ui/Overlay';
import { getWebSocket } from '../services/websocket';
import { sessionScopedValue } from '../stores/session-slice';
import type { PendingQuestionBlock } from '../stores/chat-types';

export function QuestionModal() {
  const currentSessionPath = useStore((s) => s.currentSessionPath);
  const resolvePendingQuestion = useStore((s) => s.resolvePendingQuestion);
  const setPendingQuestion = useStore((s) => s.setPendingQuestion);
  const block = useStore((s) => sessionScopedValue(s, s.pendingQuestionsByPath, currentSessionPath));

  if (!currentSessionPath || !block) return null;

  const sessionPath = currentSessionPath;

  return <QuestionOverlay
    key={block.id}
    block={block}
    sessionPath={sessionPath}
    onResolve={(id) => resolvePendingQuestion(id)}
    onDismiss={() => {
      setPendingQuestion(sessionPath, null);
      const ws = getWebSocket();
      ws?.send(JSON.stringify({ type: 'question_reject', id: block.id, sessionPath }));
    }}
  />;
}

interface QuestionOverlayProps {
  block: PendingQuestionBlock;
  sessionPath: string;
  onResolve: (id: string) => void;
  onDismiss: () => void;
}

function QuestionOverlay({ block, sessionPath, onResolve, onDismiss }: QuestionOverlayProps) {
  const [answers, setAnswers] = React.useState<string[][]>(() =>
    block.questions.map(() => [] as string[]),
  );

  const handleToggleOption = (qIdx: number, label: string, multiple?: boolean) => {
    setAnswers((prev) => {
      const next = prev.map((a) => [...a]);
      if (multiple) {
        const idx = next[qIdx].indexOf(label);
        if (idx >= 0) {
          next[qIdx] = next[qIdx].filter((l) => l !== label);
        } else {
          next[qIdx] = [...next[qIdx], label];
        }
      } else {
        next[qIdx] = [label];
      }
      return next;
    });
  };

  const handleConfirm = () => {
    const ws = getWebSocket();
    ws?.send(JSON.stringify({ type: 'question_reply', id: block.id, sessionPath, answers }));
    onResolve(block.id);
  };

  const canConfirm = block.questions.every((q, i) => q.multiple || answers[i].length > 0);

  return (
    <Overlay open onClose={onDismiss} backdrop="dim" zIndex={2000} closeOnEsc trapFocus>
      <div style={{
        background: 'var(--bg-primary)',
        borderRadius: 12,
        padding: 24,
        maxWidth: 500,
        width: '90vw',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}>
        {block.questions.map((q, qIdx) => (
          <div key={qIdx} style={{ marginBottom: qIdx < block.questions.length - 1 ? 20 : 0 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14, color: 'var(--text-secondary)' }}>
              {q.header}
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 500 }}>
              {q.question}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {q.options.map((opt) => {
                const selected = answers[qIdx]?.includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => handleToggleOption(qIdx, opt.label, q.multiple)}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: selected ? '2px solid var(--accent)' : '1px solid var(--border-default)',
                      background: selected ? 'var(--accent-bg, rgba(0,120,255,0.08))' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 14,
                    }}
                  >
                    <div style={{ fontWeight: selected ? 600 : 400 }}>{opt.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {opt.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid var(--border-default)',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--text-on-accent, #fff)',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </Overlay>
  );
}

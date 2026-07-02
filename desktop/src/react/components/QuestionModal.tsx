import { useEffect, useRef, useState } from 'react';
import { useStore } from '../stores';
import { getWebSocket } from '../services/websocket';
import { sessionScopedValue } from '../stores/session-slice';
import type { PendingQuestionBlock } from '../stores/chat-types';
import s from './QuestionModal.module.css';

export function QuestionBar() {
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
  const [answers, setAnswers] = useState<string[][]>(() =>
    block.questions.map(() => [] as string[]),
  );
  const [customTexts, setCustomTexts] = useState<string[]>(() =>
    block.questions.map(() => ''),
  );
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onDismiss(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDismiss]);

  const handleToggleOption = (qIdx: number, label: string, multiple?: boolean) => {
    setCustomTexts((prev) => {
      const next = [...prev];
      next[qIdx] = '';
      return next;
    });
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

  const handleCustomInput = (qIdx: number, value: string) => {
    const trimmed = value.trim();
    setCustomTexts((prev) => {
      const next = [...prev];
      next[qIdx] = value;
      return next;
    });
    setAnswers((prev) => {
      const next = prev.map((a) => [...a]);
      next[qIdx] = trimmed ? [trimmed] : [];
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
    <>
      <div className={s.backdrop} onClick={onDismiss} />
      <div className={s.wrapper}>
        <div className={s.panel}>
          {block.questions.map((q, qIdx) => (
            <div key={qIdx} className={qIdx > 0 ? s.questionGroup : undefined}>
              {q.header && <div className={s.header}>{q.header}</div>}
              <div className={s.questionText}>{q.question}</div>
              <div className={s.options}>
                {q.options.map((opt) => {
                  const selected = answers[qIdx]?.includes(opt.label);
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => handleToggleOption(qIdx, opt.label, q.multiple)}
                      className={`${s.optionBtn}${selected ? ` ${s.optionBtnSelected}` : ''}`}
                    >
                      <div className={`${s.optionLabel}${selected ? ` ${s.optionLabelSelected}` : ''}`}>
                        {opt.label}
                      </div>
                      {opt.description && (
                        <div className={`${s.optionDesc}${selected ? ` ${s.optionDescSelected}` : ''}`}>
                          {opt.description}
                        </div>
                      )}
                    </button>
                  );
                })}
                <div
                  className={`${s.customOption}${customTexts[qIdx] ? ` ${s.customOptionSelected}` : ''}`}
                  onClick={() => inputRefs.current[qIdx]?.focus()}
                >
                  <span className={`${s.customLabel}${customTexts[qIdx] ? ` ${s.customLabelSelected}` : ''}`}>
                    Custom
                  </span>
                  <input
                    ref={(el) => { inputRefs.current[qIdx] = el; }}
                    className={s.customInput}
                    type="text"
                    value={customTexts[qIdx]}
                    onChange={(e) => handleCustomInput(qIdx, e.target.value)}
                    placeholder="Type your answer..."
                    maxLength={200}
                  />
                </div>
              </div>
            </div>
          ))}
          <div className={s.actions}>
            <button type="button" onClick={onDismiss} className={s.dismissBtn}>
              Dismiss
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={s.confirmBtn}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

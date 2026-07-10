import { useCallback, useState } from 'react';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useI18n } from '../../hooks/use-i18n';
import { useStore } from '../../stores';
import type { SessionPermissionMode, SessionWorkflowMode } from '../../types';
import styles from './InputArea.module.css';

function labelKey(mode: SessionWorkflowMode) {
  return mode === 'compose' ? 'input.composeModeCompose' : 'input.composeModeNormal';
}

function ComposeIcon({ mode }: { mode: SessionWorkflowMode }) {
  return (
    <svg data-workflow-mode={mode} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h6" />
      <path d="M14 7h6" />
      <path d="M7 4v6" />
      <path d="M17 4v6" />
      <path d="M6 17h12" />
      <path d="M9 14v6" />
      <path d="M15 14v6" />
    </svg>
  );
}

export function ComposeModeButton({
  mode,
  permissionMode,
  onChange,
}: {
  mode: SessionWorkflowMode;
  permissionMode: SessionPermissionMode;
  onChange: (mode: SessionWorkflowMode) => void;
}) {
  const { t } = useI18n();
  const [switching, setSwitching] = useState(false);
  const disabled = permissionMode === 'plan';
  const activeMode = disabled ? 'normal' : mode;
  const label = t(labelKey(activeMode));

  const showError = useCallback(() => {
    window.dispatchEvent(new CustomEvent('hana-inline-notice', {
      detail: { text: t('input.composeModeSwitchFailed'), type: 'error' },
    }));
  }, [t]);

  const toggle = useCallback(async () => {
    if (disabled || switching) return;
    const nextMode: SessionWorkflowMode = activeMode === 'compose' ? 'normal' : 'compose';
    setSwitching(true);
    try {
      const state = useStore.getState();
      const pendingNewSession = state.pendingNewSession === true;
      const sessionPath = pendingNewSession ? null : state.currentSessionPath;
      const res = await hanaFetch('/api/session-workflow-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: nextMode,
          pendingNewSession,
          ...(sessionPath ? { sessionPath } : {}),
        }),
      });
      const data = await res.json();
      if (data?.ok === false) {
        showError();
        return;
      }
      onChange((data.effectiveMode || data.mode || nextMode) as SessionWorkflowMode);
    } catch (err) {
      console.error('[compose-mode] toggle failed:', err);
      showError();
    } finally {
      setSwitching(false);
    }
  }, [activeMode, disabled, onChange, showError, switching]);

  return (
    <button
      type="button"
      className={`${styles['plan-mode-btn']} ${styles['compose-mode-btn']}${activeMode === 'compose' ? ` ${styles['compose-mode-active']}` : ''}`}
      title={disabled ? t('input.composeModeDisabledInPlan') : label}
      aria-label={label}
      aria-pressed={activeMode === 'compose'}
      aria-busy={switching}
      disabled={disabled || switching}
      onClick={(event) => {
        event.stopPropagation();
        void toggle();
      }}
    >
      <ComposeIcon mode={activeMode} />
      <span className={styles['plan-mode-label']}>{label}</span>
    </button>
  );
}

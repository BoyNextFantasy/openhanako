import { memo, type RefObject } from 'react';
import { SendButton } from './SendButton';
import styles from './InputArea.module.css';

interface Props {
  t: (key: string) => string;
  // 左侧工具按钮
  onAttach: () => void;
  slashBtnRef: RefObject<HTMLButtonElement | null>;
  onSlashToggle: () => void;
  // 模式控件（Plan/Compose/ContextRing/Thinking/Model）已上移到编辑器上方工具栏，
  // 这些 props 保留为 optional 以兼容既有挂载方，不再渲染。
  permissionMode?: unknown;
  onPermissionModeChange?: unknown;
  planModeLocked?: unknown;
  workflowMode?: unknown;
  onWorkflowModeChange?: unknown;
  showThinking?: unknown;
  thinkingLevel?: unknown;
  onThinkingChange?: unknown;
  availableThinkingLevels?: unknown;
  models?: unknown;
  sessionModel?: unknown;
  // 右侧控制
  isStreaming: boolean;
  hasInput: boolean;
  canSend: boolean;
  showAudioInput: boolean;
  audioRecordingActive: boolean;
  audioRecordingBusy: boolean;
  onAudioToggle: () => void;
  onSend: () => void;
  onSteer: () => void;
  onStop: () => void;
}

/** 编辑器下方的工具按钮行 + 发送控制（模式控件见 InputArea 的 input-toolbar-top） */
export const InputControlBar = memo(function InputControlBar(props: Props) {
  const {
    t, onAttach, slashBtnRef, onSlashToggle,
    isStreaming, hasInput, canSend,
    showAudioInput, audioRecordingActive, audioRecordingBusy, onAudioToggle,
    onSend, onSteer, onStop,
  } = props;

  return (
    <div className={styles['input-bottom-bar']}>
      <div className={styles['input-actions']}>
        <button
          className={styles['attach-btn']}
          title={t('input.attachFiles')}
          onClick={onAttach}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          ref={slashBtnRef}
          className={styles['attach-btn']}
          title={t('input.commandMenu')}
          onClick={onSlashToggle}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3.5 13.6 10.4 20.5 12 13.6 13.6 12 20.5 10.4 13.6 3.5 12 10.4 10.4 12 3.5Z" />
          </svg>
        </button>
      </div>
      <div className={styles['input-controls']}>
        {showAudioInput && (
          <button
            type="button"
            className={`${styles['audio-record-btn']}${audioRecordingActive ? ` ${styles['is-recording']}` : ''}`}
            title={t(audioRecordingActive ? 'input.stopRecording' : 'input.recordAudio')}
            aria-label={t(audioRecordingActive ? 'input.stopRecording' : 'input.recordAudio')}
            aria-pressed={audioRecordingActive}
            disabled={audioRecordingBusy}
            onClick={onAudioToggle}
          >
            {audioRecordingActive ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="7" y="7" width="10" height="10" rx="2" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <path d="M12 19v3" />
              </svg>
            )}
          </button>
        )}
        <SendButton isStreaming={isStreaming} hasInput={hasInput}
          disabled={isStreaming ? false : !canSend} onSend={onSend} onSteer={onSteer} onStop={onStop} />
      </div>
    </div>
  );
});

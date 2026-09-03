// desktop/src/react/components/chat/MessageActions.tsx
import { memo, useCallback, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { useStore } from '../../stores';
import { useI18n } from '../../hooks/use-i18n';
import { selectSelectedIdsBySession } from '../../stores/session-selectors';
import { sessionScopedValue } from '../../stores/session-slice';
import { MessageFooterActions, type MessageFooterAction } from './MessageFooterActions';

interface Props {
  messageId: string;
  selectionIds?: readonly string[];
  sessionPath: string;
  onCopy: () => void;
  onScreenshot: () => void;
  copied: boolean;
  isStreaming: boolean;
  align?: 'left' | 'right';
}

export function useMessageFooterActions({
  messageId,
  selectionIds,
  sessionPath,
  onCopy,
  onScreenshot,
  copied,
  isStreaming,
}: Props): MessageFooterAction[] {
  const { t } = useI18n();
  const selectedIds = useStore(s => selectSelectedIdsBySession(s, sessionPath));
  const sessionItems = useStore(s => sessionScopedValue(s, s.chatSessions, sessionPath)?.items);
  const setSelection = useStore(s => s.setMessageSelection);
  const targetSelectionIds = useMemo(() => {
    const ids = selectionIds && selectionIds.length > 0 ? selectionIds : [messageId];
    return Array.from(new Set(ids.filter(Boolean)));
  }, [messageId, selectionIds]);
  const targetSelectionIdSet = useMemo(() => new Set(targetSelectionIds), [targetSelectionIds]);
  const isSelected = targetSelectionIds.length > 0 && targetSelectionIds.every(id => selectedIds.includes(id));
  const selectableIds = useMemo(() => (
    (sessionItems || [])
      .filter(item => item.type === 'message')
      .map(item => item.data.id)
  ), [sessionItems]);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id));

  const handleToggle = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (isSelected) {
      setSelection(sessionPath, selectedIds.filter(id => !targetSelectionIdSet.has(id)));
      return;
    }
    setSelection(sessionPath, [...selectedIds, ...targetSelectionIds]);
  }, [isSelected, selectedIds, sessionPath, setSelection, targetSelectionIdSet, targetSelectionIds]);

  const handleSelectAll = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setSelection(sessionPath, allSelected ? [] : selectableIds);
  }, [allSelected, selectableIds, setSelection, sessionPath]);

  return useMemo(() => [
    {
      id: 'copy',
      title: t('common.copyText'),
      icon: copied ? <CheckIcon /> : <CopyIcon />,
      onClick: () => onCopy(),
      disabled: isStreaming,
      active: copied,
    },
    {
      id: 'screenshot',
      title: t('common.screenshot'),
      icon: <ScreenshotIcon />,
      onClick: () => onScreenshot(),
      disabled: isStreaming,
    },
    {
      id: 'select-all',
      title: t('common.selectAllMessages'),
      icon: <SelectAllIcon />,
      onClick: handleSelectAll,
      disabled: isStreaming,
      active: allSelected,
      pressed: allSelected,
    },
    {
      id: 'select',
      title: t('common.selectMessage'),
      icon: <SelectMessageIcon selected={isSelected} />,
      onClick: handleToggle,
      disabled: isStreaming,
      active: isSelected,
      pressed: isSelected,
    },
  ], [allSelected, copied, handleSelectAll, handleToggle, isSelected, isStreaming, onCopy, onScreenshot, t]);
}

export const MessageActions = memo(function MessageActions(props: Props) {
  const { align = 'right' } = props;
  const actions = useMessageFooterActions(props);

  return (
    <MessageFooterActions
      align={align}
      actions={actions}
      visible
      testId="message-actions-inline"
    />
  );
});

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8.5" y="8.5" width="12" height="12" rx="3" ry="3" />
      <path d="M15.5 5.5v-.5a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 5v7A2.5 2.5 0 0 0 6 14.5h.5" />
    </svg>
  );
}

function ScreenshotIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function SelectAllIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6h11.5" />
      <path d="M9 12h11.5" />
      <path d="M9 18h11.5" />
      <path d="M3.5 6h.01" />
      <path d="M3.5 12h.01" />
      <path d="M3.5 18h.01" />
    </svg>
  );
}

function SelectMessageIcon({ selected }: { selected: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {selected
        ? <>
            <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" opacity="0.15" />
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <polyline points="9 12 11.5 14.5 16 9" />
          </>
        : <rect x="3" y="3" width="18" height="18" rx="2" />
      }
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

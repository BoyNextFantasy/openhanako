import type { ActivePanel } from '../../types';
import { useStore } from '../../stores';
import { useAnyBrowserRunning } from '../../stores/browser-slice';
import { RegionalErrorBoundary } from '../RegionalErrorBoundary';
import { SessionList } from '../SessionList';
import { SidebarNoticeSlot } from '../notices/SidebarNoticeSlot';

interface ChatSidebarContentProps {
  showSettingsButton?: boolean;
  showActivityBars?: boolean;
  onNewSession: () => void;
  onCollapse: () => void;
  onOpenSettings?: () => void;
  onTogglePanel?: (panel: ActivePanel) => void;
  region?: string;
}

interface ChatSidebarProps extends ChatSidebarContentProps {
  open: boolean;
}

function AutomationBadge() {
  const count = useStore(s => s.automationCount);
  return <span className="automation-count-badge">{count > 0 ? String(count) : ''}</span>;
}

function BridgeDot() {
  const connected = useStore(s => s.bridgeDotConnected);
  return <span className={`sidebar-bridge-dot${connected ? ' connected' : ''}`}></span>;
}

export function ChatSidebarContent({
  showSettingsButton = true,
  showActivityBars = true,
  onNewSession,
  onCollapse,
  onOpenSettings,
  onTogglePanel,
  region = 'sidebar',
}: ChatSidebarContentProps) {
  const currentAgentId = useStore(s => s.currentAgentId);
  const browserRunning = useAnyBrowserRunning();
  const activePanel = useStore(s => s.activePanel);
  const t = window.t ?? ((p: string) => p);

  // 桌面/悬浮态：图标栏 + 会话面板（双栏布局模型）。
  // 移动端走下方 legacy 分支（DOM 与原版一致），绕开 mobile-entry.css 双写。
  if (showActivityBars) {
    return (
      <div className="sidebar-body">
        <nav className="sidebar-rail" aria-label={t('sidebar.title')}>
          <button
            className="rail-btn rail-new"
            data-tip={t('sidebar.newChat')}
            aria-label={t('sidebar.newChat')}
            onClick={onNewSession}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <div className="rail-sep" />
          <button
            className={`rail-btn${activePanel === 'activity' ? ' rail-btn-active' : ''}`}
            data-tip={t('sidebar.activity')}
            aria-label={t('sidebar.activity')}
            onClick={() => onTogglePanel?.('activity')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"></circle><path d="M8.5 15.5a5 5 0 0 1 0-7"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M6 18a8.5 8.5 0 0 1 0-12"></path><path d="M18 6a8.5 8.5 0 0 1 0 12"></path>
            </svg>
          </button>
          <button
            className={`rail-btn${activePanel === 'automation' ? ' rail-btn-active' : ''}`}
            data-tip={t('automation.title')}
            aria-label={t('automation.title')}
            onClick={() => onTogglePanel?.('automation')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
              <path d="M9 16l2 2 4-4"></path>
            </svg>
            <AutomationBadge />
          </button>
          <button
            className={`rail-btn${activePanel === 'skills' ? ' rail-btn-active' : ''}`}
            data-tip={t('skills.panel.title')}
            aria-label={t('skills.panel.title')}
            onClick={() => onTogglePanel?.('skills')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="14" width="7" height="7" rx="1"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1"></rect>
            </svg>
          </button>
          <button
            className={`rail-btn${activePanel === 'bridge' ? ' rail-btn-active' : ''}`}
            data-tip={t('sidebar.bridgeShort')}
            aria-label={t('sidebar.bridgeShort')}
            onClick={() => onTogglePanel?.('bridge')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
            <BridgeDot />
          </button>
          {browserRunning && (
            <button
              className="rail-btn"
              data-tip={t('browser.background')}
              aria-label={t('browser.background')}
              title={t('browser.backgroundHint')}
              onClick={() => window.platform?.openBrowserViewer?.()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
            </button>
          )}
          <div className="rail-spacer" />
          {showSettingsButton && (
            <button
              className="rail-btn"
              data-tip={t('settings.title')}
              aria-label={t('settings.title')}
              onClick={onOpenSettings}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3.2"></circle>
                <path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.2 5.2l2 2M16.8 16.8l2 2M18.8 5.2l-2 2M7.2 16.8l-2 2"></path>
              </svg>
            </button>
          )}
          <button
            className="rail-btn"
            data-tip={t('sidebar.collapse')}
            aria-label={t('sidebar.collapse')}
            onClick={onCollapse}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 6 9 12 15 18"></polyline>
            </svg>
          </button>
        </nav>
        <div className="sidebar-main">
          <div className="session-list">
            <RegionalErrorBoundary region={region} resetKeys={[currentAgentId]}>
              <SessionList />
            </RegionalErrorBoundary>
            <SidebarNoticeSlot />
          </div>
        </div>
      </div>
    );
  }

  // legacy 单列布局（移动端：无活动条、无设置按钮）
  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">{t('sidebar.title')}</span>
        <div className="sidebar-header-actions">
          <button className="sidebar-action-btn" title={t('sidebar.newChat')} onClick={onNewSession}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          {showSettingsButton && (
            <button className="sidebar-action-btn" title={t('settings.title')} onClick={onOpenSettings}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
          )}
          <button className="sidebar-action-btn" title={t('sidebar.collapse')} onClick={onCollapse}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 6 9 12 15 18"></polyline>
            </svg>
          </button>
        </div>
      </div>

      <div className="session-list">
        <RegionalErrorBoundary region={region} resetKeys={[currentAgentId]}>
          <SessionList />
        </RegionalErrorBoundary>
        <SidebarNoticeSlot />
      </div>
    </>
  );
}

export function ChatSidebar({
  open,
  ...contentProps
}: ChatSidebarProps) {
  return (
    <aside className={`sidebar${open ? '' : ' collapsed'}`} id="sidebar">
      <div className="sidebar-inner">
        <ChatSidebarContent {...contentProps} />
      </div>
      <div className="resize-handle resize-handle-right" id="sidebarResizeHandle"></div>
    </aside>
  );
}

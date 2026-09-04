// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextRing } from '../../components/input/ContextRing';
import { useStore } from '../../stores';
import { refreshSessionCapabilities } from '../../stores/session-actions';

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

vi.mock('../../services/websocket', () => ({
  getWebSocket: vi.fn(() => ({ readyState: 1, send: sendMock })),
}));

vi.mock('../../stores/session-actions', () => ({
  refreshSessionCapabilities: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    contextUsage: { tokens: 1_000, contextWindow: 200_000, percent: 0 },
    breakdown: { estimated: true, systemPromptTokens: 0, toolsTokens: 0, messagesTokens: 0, otherTokens: 1_000 },
    stats: { pruneCount: 0, prunedTokens: 0, compactionCount: 0, recoveredTokens: 0 },
    cache: { hitRatio: null, requests: 0 },
  }), { status: 200 })),
}));

/** 悬停小圆环，打开分层统计浮窗 */
function hoverRing(container: HTMLElement) {
  const wrap = screen.getByTestId('context-ring-wrap');
  fireEvent.mouseEnter(wrap);
}

describe('ContextRing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      agentYuan: 'hanako',
      currentSessionPath: '/session/a.jsonl',
      contextTokens: null,
      contextWindow: null,
      contextPercent: null,
      contextBySession: {},
      compactingSessions: ['/session/a.jsonl'],
    } as never);
  });

  afterEach(() => {
    cleanup();
    useStore.setState({
      currentSessionPath: null,
      contextTokens: null,
      contextWindow: null,
      contextPercent: null,
      contextBySession: {},
      compactingSessions: [],
    } as never);
  });

  it('stays visible while the current session is compacting before usage arrives', async () => {
    const { container } = render(<ContextRing />);

    await waitFor(() => {
      const button = container.querySelector('button');
      expect(button).toBeTruthy();
    });
  });

  it('is visible for an active session but hides the token label below 100k', async () => {
    useStore.setState({
      contextBySession: {
        '/session/a.jsonl': { tokens: 12_345, window: 200_000, percent: 6 },
      },
      compactingSessions: [],
    } as never);

    const { container, queryByText } = render(<ContextRing />);

    await waitFor(() => {
      expect(container.querySelector('button')).toBeTruthy();
    });
    expect(queryByText('12k')).toBeNull();
  });

  it('shows the token label from 100k', async () => {
    useStore.setState({
      contextBySession: {
        '/session/a.jsonl': { tokens: 100_000, window: 200_000, percent: 50 },
      },
      compactingSessions: [],
    } as never);

    const { getByText } = render(<ContextRing />);

    await waitFor(() => {
      expect(getByText('100k')).toBeTruthy();
    });
  });

  it('opens a layered stats panel on hover instead of compacting immediately', async () => {
    useStore.setState({
      compactingSessions: [],
    } as never);

    const { container } = render(<ContextRing />);
    hoverRing(container);

    await waitFor(() => {
      expect(screen.getByText('上下文容量')).toBeInTheDocument();
    });
    expect(screen.getByText('input.refreshAndCompact')).toBeInTheDocument();
    expect(screen.getByText('input.compact')).toBeInTheDocument();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('runs fresh compact from the update action inside the hover panel', async () => {
    useStore.setState({
      compactingSessions: [],
    } as never);

    const { container } = render(<ContextRing />);
    hoverRing(container);
    fireEvent.click(await screen.findByText('input.refreshAndCompact'));

    expect(refreshSessionCapabilities).toHaveBeenCalledWith('/session/a.jsonl');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('runs ordinary compact from the compact action inside the hover panel', async () => {
    useStore.setState({
      compactingSessions: [],
    } as never);

    const { container } = render(<ContextRing />);
    hoverRing(container);
    fireEvent.click(await screen.findByText('input.compact'));

    expect(sendMock).toHaveBeenCalledWith(JSON.stringify({ type: 'compact', sessionPath: '/session/a.jsonl' }));
    expect(refreshSessionCapabilities).not.toHaveBeenCalled();
  });

  it('restores pending plan stats hydrate path via context usage endpoint', async () => {
    useStore.setState({
      compactingSessions: [],
    } as never);

    const { container } = render(<ContextRing />);
    hoverRing(container);

    // 悬停即触发 /api/usage/context 拉取（P0-4 聚合端点）
    await waitFor(() => {
      expect(screen.getByText('上下文容量')).toBeInTheDocument();
    });
  });
});

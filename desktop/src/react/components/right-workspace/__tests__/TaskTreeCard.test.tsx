// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { TaskTreeCard } from '../TaskTreeCard';
import type { TaskNode } from '../TaskTreeCard';

vi.mock('../../../hooks/use-hana-fetch', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetchMock(...(args as [string, RequestInit?])),
}));

const mockState: any = { currentSessionPath: '/sessions/demo.jsonl' };
vi.mock('../../../stores', () => ({
  useStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

const hanaFetchMock = vi.fn<(url: string, opts?: RequestInit) => Promise<Response>>();

let currentForest: TaskNode[] = [];

function freshForest(): TaskNode[] {
  return [
    {
      id: 'T1',
      summary: '父任务：实现登录',
      status: 'in_progress',
      parentTaskId: null,
      owner: null,
      lastEventKind: 'started',
      lastEventSummary: null,
      createdAt: 1,
      updatedAt: 2,
      endedAt: null,
      children: [
        {
          id: 'T1.1', summary: '子任务A', status: 'open', parentTaskId: 'T1', owner: null,
          lastEventKind: 'created', lastEventSummary: null, createdAt: 1, updatedAt: 1, endedAt: null,
          children: [],
        },
        {
          id: 'T1.2', summary: '子任务B', status: 'done', parentTaskId: 'T1', owner: null,
          lastEventKind: 'done', lastEventSummary: null, createdAt: 1, updatedAt: 2, endedAt: 2,
          children: [],
        },
      ],
    },
  ];
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  currentForest = freshForest();
  mockState.currentSessionPath = '/sessions/demo.jsonl';
  hanaFetchMock.mockReset();
  hanaFetchMock.mockImplementation(async (url: string, opts?: RequestInit) => {
    if (url === '/api/tasks?sessionPath=%2Fsessions%2Fdemo.jsonl' && !opts?.method) {
      return jsonResponse({ ok: true, tasks: currentForest });
    }
    if (url.startsWith('/api/tasks/') && opts?.method === 'POST') {
      const id = decodeURIComponent(url.slice('/api/tasks/'.length));
      const body = JSON.parse(String(opts.body));
      const mutate = (nodes: TaskNode[]): boolean => {
        for (const node of nodes) {
          if (node.id === id) {
            node.status = body.action === 'done' ? 'done' : 'abandoned';
            return true;
          }
          if (mutate(node.children)) return true;
        }
        return false;
      };
      mutate(currentForest);
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ ok: false, error: 'not found' }, 404);
  });
});

afterEach(cleanup);

describe('TaskTreeCard', () => {
  it('渲染树行、5 态样式与 header 计数', async () => {
    const { container } = render(<TaskTreeCard />);

    await waitFor(() => {
      expect(screen.getByText('父任务：实现登录')).toBeTruthy();
    });
    expect(screen.getByText('子任务A')).toBeTruthy();
    expect(screen.getByText('子任务B')).toBeTruthy();

    const parentRow = container.querySelector('[data-task-id="T1"]');
    expect(parentRow?.getAttribute('data-status')).toBe('in_progress');
    const doneRow = container.querySelector('[data-task-id="T1.2"]');
    expect(doneRow?.getAttribute('data-status')).toBe('done');

    expect(screen.getByText('1/3')).toBeTruthy();
  });

  it('折叠再展开子树', async () => {
    const { container } = render(<TaskTreeCard />);
    await waitFor(() => {
      expect(screen.getByText('父任务：实现登录')).toBeTruthy();
    });

    const disclosure = container.querySelector<HTMLButtonElement>('[data-task-id="T1"] button[aria-expanded]');
    expect(disclosure?.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(disclosure!);
    expect(screen.queryByText('子任务A')).toBeNull();
    expect(disclosure?.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(disclosure!);
    expect(screen.getByText('子任务A')).toBeTruthy();
  });

  it('active 行有 done/abandon 按钮，terminal 行没有', async () => {
    const { container } = render(<TaskTreeCard />);
    await waitFor(() => {
      expect(screen.getByText('父任务：实现登录')).toBeTruthy();
    });

    const activeRow = container.querySelector('[data-task-id="T1.1"]');
    expect(activeRow!.querySelectorAll('button[aria-label="标记完成"], button[title="标记完成"]').length).toBe(1);
    expect(activeRow!.querySelectorAll('button[aria-label="放弃任务"], button[title="放弃任务"]').length).toBe(1);

    const doneRow = container.querySelector('[data-task-id="T1.2"]');
    expect(doneRow!.querySelectorAll('button').length).toBe(0);
  });

  it('点击 done 发送 POST 并刷新状态', async () => {
    const { container } = render(<TaskTreeCard />);
    await waitFor(() => {
      expect(screen.getByText('子任务A')).toBeTruthy();
    });

    const row = container.querySelector('[data-task-id="T1.1"]');
    const doneButton = row!.querySelector<HTMLButtonElement>('button[aria-label="标记完成"], button[title="标记完成"]');
    fireEvent.click(doneButton!);

    await waitFor(() => {
      expect(container.querySelector('[data-task-id="T1.1"]')?.getAttribute('data-status')).toBe('done');
    });
    expect(hanaFetchMock).toHaveBeenCalledWith(
      '/api/tasks/T1.1',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByText('2/3')).toBeTruthy();
  });

  it('空任务森林整卡隐藏', async () => {
    currentForest = [];
    const { container } = render(<TaskTreeCard />);

    await waitFor(() => {
      expect(hanaFetchMock).toHaveBeenCalled();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.querySelector('.universal-card')).toBeNull();
  });

  it('无当前会话时不请求、整卡隐藏', async () => {
    mockState.currentSessionPath = null;
    const { container } = render(<TaskTreeCard />);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hanaFetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('.universal-card')).toBeNull();
  });
});

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { FileDiffPreview } from '../../components/input/FileDiffPreview';
import { SessionConfirmationPrompt } from '../../components/input/SessionConfirmationPrompt';
import type { SessionConfirmationBlock } from '../../stores/chat-types';

afterEach(cleanup);

function rowsOf(container: HTMLElement, kind: string) {
  return Array.from(container.querySelectorAll(`[data-kind="${kind}"]`));
}

function expand(container: HTMLElement) {
  fireEvent.click(screen.getByTestId('file-diff-summary'));
}

describe('FileDiffPreview', () => {
  it('默认折叠：只显示「路径 + 统计 + 箭头」摘要条，无内容行', () => {
    const { container } = render(
      <FileDiffPreview
        toolName="edit"
        params={{ path: 'src/a.ts', edits: [{ oldText: 'const a = 1;', newText: 'const a = 2;' }] }}
      />,
    );

    const summary = screen.getByTestId('file-diff-summary');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(summary.textContent).toContain('src/a.ts');
    expect(summary.textContent).toContain('+1');
    expect(summary.textContent).toContain('-1');
    expect(container.querySelector('[data-testid="file-diff-body"]')).toBeNull();
    expect(rowsOf(container, 'del').length).toBe(0);
    expect(rowsOf(container, 'add').length).toBe(0);
  });

  it('点击摘要条展开红绿行，再点收起', () => {
    const { container } = render(
      <FileDiffPreview
        toolName="edit"
        params={{ path: 'src/a.ts', edits: [{ oldText: 'const a = 1;', newText: 'const a = 2;' }] }}
      />,
    );

    expand(container);
    expect(screen.getByTestId('file-diff-summary').getAttribute('aria-expanded')).toBe('true');
    expect(rowsOf(container, 'del').map((node) => node.textContent)).toEqual(['const a = 1;']);
    expect(rowsOf(container, 'add').map((node) => node.textContent)).toEqual(['const a = 2;']);

    expand(container);
    expect(container.querySelector('[data-testid="file-diff-body"]')).toBeNull();
  });

  it('edit 多处编辑展开后按「变更 i/n」分段', () => {
    const { container } = render(
      <FileDiffPreview
        toolName="edit"
        params={{
          path: 'src/a.ts',
          edits: [
            { oldText: 'const a = 1;', newText: 'const a = 2;' },
            { oldText: 'const b = 1;', newText: 'const b = 2;' },
          ],
        }}
      />,
    );

    expand(container);
    expect(screen.getByText('变更 1/2')).toBeTruthy();
    expect(screen.getByText('变更 2/2')).toBeTruthy();
    expect(rowsOf(container, 'del').length).toBe(2);
    expect(rowsOf(container, 'add').length).toBe(2);
  });

  it('edits 为 JSON 字符串时归一化后渲染（GLM/Opus 形态）', () => {
    const { container } = render(
      <FileDiffPreview
        toolName="edit"
        params={{
          path: 'src/a.ts',
          edits: JSON.stringify([{ oldText: 'const a = 1;', newText: 'const a = 2;' }]),
        }}
      />,
    );

    expand(container);
    expect(rowsOf(container, 'del').map((node) => node.textContent)).toEqual(['const a = 1;']);
    expect(rowsOf(container, 'add').map((node) => node.textContent)).toEqual(['const a = 2;']);
  });

  it('顶层 oldText/newText 旧形状归一化后渲染', () => {
    const { container } = render(
      <FileDiffPreview
        toolName="edit"
        params={{ path: 'src/a.ts', oldText: 'const a = 1;', newText: 'const a = 2;' }}
      />,
    );

    expand(container);
    expect(rowsOf(container, 'del').map((node) => node.textContent)).toEqual(['const a = 1;']);
    expect(rowsOf(container, 'add').map((node) => node.textContent)).toEqual(['const a = 2;']);
  });

  it('write 显示 +N 统计，展开后为新内容预览', () => {
    const { container } = render(
      <FileDiffPreview toolName="write" params={{ path: 'docs/new.md', content: '# 标题\n正文' }} />,
    );

    expect(screen.getByTestId('file-diff-summary').textContent).toContain('+2');
    expect(screen.getByTestId('file-diff-summary').textContent).not.toContain('-');

    expand(container);
    expect(rowsOf(container, 'add').map((node) => node.textContent)).toEqual(['# 标题', '正文']);
  });

  it('展开渲染超过 1000 行时截断并提示剩余行数', () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `line-${i + 1}`);
    const { container } = render(
      <FileDiffPreview toolName="write" params={{ path: 'big.txt', content: lines.join('\n') }} />,
    );

    expand(container);
    expect(rowsOf(container, 'add').length).toBe(1000);
    expect(screen.getByTestId('file-diff-truncated').textContent).toContain('已省略其余 200 行');
  });

  it('二进制内容展开与否都只显示省略提示', () => {
    const { container } = render(
      <FileDiffPreview toolName="write" params={{ path: 'img.bin', content: 'ok\0broken' }} />,
    );

    expect(screen.getByTestId('file-diff-omitted')).toBeTruthy();
    expand(container);
    expect(rowsOf(container, 'add').length).toBe(0);
    expect(screen.getByTestId('file-diff-omitted')).toBeTruthy();
  });

  it('超长单行只显示省略提示', () => {
    render(
      <FileDiffPreview toolName="write" params={{ path: 'min.txt', content: 'x'.repeat(10_001) }} />,
    );

    expect(screen.getByTestId('file-diff-omitted')).toBeTruthy();
  });

  it('非 write/edit 工具不渲染任何内容', () => {
    const { container } = render(
      <FileDiffPreview toolName="bash" params={{ command: 'rm -rf node_modules' }} />,
    );

    expect(container.querySelector('[data-testid="file-diff-preview"]')).toBeNull();
  });

  it('参数形状不完整（无 path / edits 非数组）时不渲染', () => {
    const { container } = render(<FileDiffPreview toolName="edit" params={{ edits: 'oops' }} />);
    expect(container.querySelector('[data-testid="file-diff-preview"]')).toBeNull();

    const { container: container2 } = render(<FileDiffPreview toolName="write" params={{ path: 'x' }} />);
    expect(container2.querySelector('[data-testid="file-diff-preview"]')).toBeNull();
  });
});

describe('SessionConfirmationPrompt 集成 FileDiffPreview', () => {
  const hanaFetchMock = vi.fn(async (_path: string, _opts?: RequestInit) => new Response('{}', { status: 200 }));

  vi.mock('../../hooks/use-hana-fetch', () => ({
    hanaFetch: (path: string, opts?: RequestInit) => hanaFetchMock(path, opts),
    hanaUrl: (path: string) => `http://127.0.0.1:3210${path}`,
  }));

  function confirmationBlock(overrides: Partial<SessionConfirmationBlock> = {}): SessionConfirmationBlock {
    return {
      type: 'session_confirmation',
      confirmId: 'conf-diff-1',
      kind: 'tool_action_approval',
      surface: 'input',
      status: 'pending',
      title: '需要你的确认',
      subject: { label: 'edit', detail: 'path: src/a.ts' },
      severity: 'elevated',
      actions: { confirmLabel: '同意', rejectLabel: '拒绝' },
      payload: {
        toolName: 'edit',
        params: { path: 'src/a.ts', edits: [{ oldText: 'const a = 1;', newText: 'const a = 2;' }] },
      },
      ...overrides,
    };
  }

  it('tool_action_approval 卡默认折叠显示摘要条，点击展开 diff', () => {
    const { container } = render(<SessionConfirmationPrompt block={confirmationBlock()} />);

    expect(screen.getByTestId('session-confirmation-summary')).toBeTruthy();
    const preview = container.querySelector('[data-testid="file-diff-preview"]');
    expect(preview).toBeTruthy();
    expect(container.querySelector('[data-testid="file-diff-body"]')).toBeNull();
    expect(screen.getByTestId('file-diff-summary').textContent).toContain('src/a.ts');

    expand(container);
    expect(rowsOf(container, 'del').map((node) => node.textContent)).toEqual(['const a = 1;']);
    expect(rowsOf(container, 'add').map((node) => node.textContent)).toEqual(['const a = 2;']);
    expect(screen.getByText('同意')).toBeTruthy();
    expect(screen.getByText('拒绝')).toBeTruthy();
  });

  it('非工具类确认（computer_app_approval）不渲染 diff', () => {
    const { container } = render(
      <SessionConfirmationPrompt
        block={confirmationBlock({
          confirmId: 'conf-diff-2',
          kind: 'computer_app_approval',
          payload: { toolName: 'edit', params: { path: 'src/a.ts', edits: [] } },
        })}
      />,
    );

    expect(container.querySelector('[data-testid="file-diff-preview"]')).toBeNull();
  });
});

// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTranscript } from '../../components/chat/ChatTranscript';
import { MemoryReviewCard } from '../../components/chat/MemoryReviewCard';
import {
  isMemoryReviewRequest,
  parseMemoryFacts,
  serializeMemoryFacts,
} from '../../components/chat/memory-review-utils';
import { hanaFetch } from '../../hooks/use-hana-fetch';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response;
}

describe('memory review helpers', () => {
  it('detects direct memory review requests without matching unrelated messages', () => {
    expect(isMemoryReviewRequest('你现在记住了我哪些事？')).toBe(true);
    expect(isMemoryReviewRequest('你记住了什么')).toBe(true);
    expect(isMemoryReviewRequest('你还记得什么关于我')).toBe(true);
    expect(isMemoryReviewRequest('帮我写一个记忆系统计划')).toBe(false);
  });

  it('parses markdown facts as lightweight memory items', () => {
    expect(parseMemoryFacts('- 喜欢 TypeScript\n* 常用 Windows\n1. 正在做 Satori')).toEqual([
      '喜欢 TypeScript',
      '常用 Windows',
      '正在做 Satori',
    ]);
    expect(parseMemoryFacts('喜欢咖啡\n\n住在上海')).toEqual(['喜欢咖啡', '住在上海']);
  });

  it('serializes facts back to markdown bullets', () => {
    expect(serializeMemoryFacts(['喜欢 TypeScript', '常用 Windows'])).toBe('- 喜欢 TypeScript\n- 常用 Windows\n');
    expect(serializeMemoryFacts([])).toBe('');
  });
});

describe('MemoryReviewCard', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(window, { t: (key: string) => key });
  });

  it('loads compiled facts and renders each fact as one actionable item', async () => {
    vi.mocked(hanaFetch).mockResolvedValueOnce(jsonResponse({
      editableFactsEnabled: true,
      sections: { facts: '- 喜欢 TypeScript\n- 常用 Windows' },
    }));

    render(<MemoryReviewCard agentId="hana" />);

    expect(await screen.findByText('Satori 想到的事')).toBeInTheDocument();
    expect(screen.getByText('喜欢 TypeScript')).toBeInTheDocument();
    expect(screen.getByText('常用 Windows')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '置顶' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '不再记住' })).toHaveLength(2);
  });

  it('shows readonly guidance when editable facts experiment is disabled', async () => {
    vi.mocked(hanaFetch).mockResolvedValueOnce(jsonResponse({
      editableFactsEnabled: false,
      sections: { facts: '- 喜欢 TypeScript' },
    }));

    render(<MemoryReviewCard agentId="hana" />);

    expect(await screen.findByText('喜欢 TypeScript')).toBeInTheDocument();
    expect(screen.getByText('打开“可编辑记忆”实验后，可以在这里直接删除记忆。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '不再记住' })).not.toBeInTheDocument();
  });

  it('pins a fact through the existing pinned memory API without duplicating it', async () => {
    vi.mocked(hanaFetch)
      .mockResolvedValueOnce(jsonResponse({
        editableFactsEnabled: true,
        sections: { facts: '- 喜欢 TypeScript' },
      }))
      .mockResolvedValueOnce(jsonResponse({ pins: ['喜欢 TypeScript'] }));

    render(<MemoryReviewCard agentId="hana" />);

    fireEvent.click(await screen.findByRole('button', { name: '置顶' }));

    await waitFor(() => expect(hanaFetch).toHaveBeenCalledTimes(2));
    expect(hanaFetch).not.toHaveBeenCalledWith('/api/agents/hana/pinned', expect.objectContaining({ method: 'PUT' }));
  });

  it('appends a new pin through the existing pinned memory API', async () => {
    vi.mocked(hanaFetch)
      .mockResolvedValueOnce(jsonResponse({
        editableFactsEnabled: true,
        sections: { facts: '- 喜欢 TypeScript' },
      }))
      .mockResolvedValueOnce(jsonResponse({ pins: ['常用 Windows'] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    render(<MemoryReviewCard agentId="hana" />);

    fireEvent.click(await screen.findByRole('button', { name: '置顶' }));

    await waitFor(() => {
      expect(hanaFetch).toHaveBeenCalledWith('/api/agents/hana/pinned', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ pins: ['常用 Windows', '喜欢 TypeScript'] }),
      }));
    });
  });

  it('removes a fact by saving the remaining editable facts', async () => {
    vi.mocked(hanaFetch)
      .mockResolvedValueOnce(jsonResponse({
        editableFactsEnabled: true,
        sections: { facts: '- 喜欢 TypeScript\n- 常用 Windows' },
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, facts: '- 常用 Windows\n' }));

    render(<MemoryReviewCard agentId="hana" />);

    const removeButtons = await screen.findAllByRole('button', { name: '不再记住' });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(hanaFetch).toHaveBeenCalledWith('/api/memories/compiled/facts?agentId=hana', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ facts: '- 常用 Windows\n' }),
      }));
    });
    expect(screen.queryByText('喜欢 TypeScript')).not.toBeInTheDocument();
    expect(screen.getByText('常用 Windows')).toBeInTheDocument();
  });

  it('keeps the card visible and reports an inline error when saving fails', async () => {
    vi.mocked(hanaFetch)
      .mockResolvedValueOnce(jsonResponse({
        editableFactsEnabled: true,
        sections: { facts: '- 喜欢 TypeScript\n- 常用 Windows' },
      }))
      .mockRejectedValueOnce(new Error('save failed'));

    render(<MemoryReviewCard agentId="hana" />);

    const removeButtons = await screen.findAllByRole('button', { name: '不再记住' });
    fireEvent.click(removeButtons[0]);

    expect(await screen.findByText('save failed')).toBeInTheDocument();
    expect(screen.getByText('喜欢 TypeScript')).toBeInTheDocument();
  });
});

describe('ChatTranscript memory review entry', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(window, { t: (key: string) => key });
  });

  it('renders the memory review card below a user memory query', async () => {
    vi.mocked(hanaFetch).mockResolvedValueOnce(jsonResponse({
      editableFactsEnabled: true,
      sections: { facts: '- 喜欢 TypeScript' },
    }));

    render(
      <ChatTranscript
        items={[{
          type: 'message',
          data: {
            id: 'u1',
            role: 'user',
            text: '你现在记住了我哪些事？',
            textHtml: '<p>你现在记住了我哪些事？</p>',
          },
        }]}
        sessionPath="/session/a.jsonl"
        agentId="hana"
      />,
    );

    expect(await screen.findByText('Satori 想到的事')).toBeInTheDocument();
    expect(screen.getByText('喜欢 TypeScript')).toBeInTheDocument();
  });
});

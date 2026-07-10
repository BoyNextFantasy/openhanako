// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposeModeButton } from '../../components/input/ComposeModeButton';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { useStore } from '../../stores';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

describe('ComposeModeButton', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      pendingNewSession: false,
      currentSessionPath: '/tmp/hana-session.jsonl',
      sessionPermissionMode: 'auto',
      sessionWorkflowMode: 'normal',
    } as never);
  });

  it('toggles the active session workflow mode through the workflow API', async () => {
    vi.mocked(hanaFetch).mockResolvedValueOnce(jsonResponse({ ok: true, mode: 'compose', effectiveMode: 'compose' }));
    const onChange = vi.fn();

    render(<ComposeModeButton mode="normal" permissionMode="auto" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'input.composeModeNormal' }));

    await waitFor(() => {
      expect(hanaFetch).toHaveBeenCalledWith('/api/session-workflow-mode', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          mode: 'compose',
          pendingNewSession: false,
          sessionPath: '/tmp/hana-session.jsonl',
        }),
      }));
    });
    expect(onChange).toHaveBeenCalledWith('compose');
  });

  it('does not bubble clicks to the input container', async () => {
    vi.mocked(hanaFetch).mockResolvedValueOnce(jsonResponse({ ok: true, mode: 'compose', effectiveMode: 'compose' }));
    const parentClick = vi.fn();

    render(
      <div onClick={parentClick}>
        <ComposeModeButton mode="normal" permissionMode="auto" onChange={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'input.composeModeNormal' }));

    await waitFor(() => expect(hanaFetch).toHaveBeenCalled());
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('shows an inline notice when switching workflow mode fails', async () => {
    vi.mocked(hanaFetch).mockRejectedValueOnce(new Error('route missing'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notice = vi.fn();
    window.addEventListener('hana-inline-notice', notice);

    render(<ComposeModeButton mode="normal" permissionMode="auto" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'input.composeModeNormal' }));

    await waitFor(() => expect(notice).toHaveBeenCalled());
    expect((notice.mock.calls[0][0] as CustomEvent).detail).toEqual({
      text: 'input.composeModeSwitchFailed',
      type: 'error',
    });
    window.removeEventListener('hana-inline-notice', notice);
    consoleError.mockRestore();
  });

  it('is disabled in plan permission mode', () => {
    render(<ComposeModeButton mode="compose" permissionMode="plan" onChange={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'input.composeModeNormal' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('input.composeModeDisabledInPlan');
  });
});

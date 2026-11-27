// Card 4245bf3b: the "Setting up apps n/m" chip follows core's boot-status.
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ apiFetch: vi.fn(), socket: { onFrame: null, release: vi.fn() } }));
vi.mock('../auth', async (orig) => ({ ...(await orig()), apiFetch: h.apiFetch, wsUrl: (p) => `ws://t${p}` }));
vi.mock('../hooks/useSharedSocket', () => ({
  createSharedSocket: (o) => { h.socket.onFrame = o.onFrame; return { retain: () => h.socket.release }; },
}));

import BootStatusChip from '../components/BootStatusChip';

const ok = (b) => ({ ok: true, status: 200, json: async () => b });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => { vi.useFakeTimers(); h.apiFetch.mockReset(); h.socket.onFrame = null; });
afterEach(() => vi.useRealTimers());

describe('BootStatusChip', () => {
  it('shows counts from the endpoint, follows frames and polls, then disappears on done', async () => {
    h.apiFetch.mockResolvedValue(ok({ phase: 'reconciling', total: 14, loaded: 5 }));
    render(<BootStatusChip />);
    await flush();
    expect(screen.getByTestId('boot-status-chip').textContent).toBe('Setting up apps 5/14');

    act(() => h.socket.onFrame({ type: 'boot_progress', phase: 'reconciling', total: 14, loaded: 9 }));
    expect(screen.getByTestId('boot-status-chip').textContent).toBe('Setting up apps 9/14');

    // another worker's socket gets no frames: the poll still moves it
    h.apiFetch.mockResolvedValue(ok({ phase: 'reconciling', total: 14, loaded: 12 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(screen.getByTestId('boot-status-chip').textContent).toBe('Setting up apps 12/14');

    act(() => h.socket.onFrame({ type: 'boot_progress', phase: 'done', total: 14, loaded: 14 }));
    expect(screen.queryByTestId('boot-status-chip')).toBeNull();
  });

  it('is invisible when idle, unauthorised or on an older core, and shows a notice on failure', async () => {
    h.apiFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const { unmount } = render(<BootStatusChip />);
    await flush();
    expect(screen.queryByTestId('boot-status-chip')).toBeNull();
    expect(h.socket.onFrame).toBeNull(); // no socket before an authorised fetch
    unmount();

    h.apiFetch.mockResolvedValue(ok({ phase: 'failed', total: 3, loaded: 1 }));
    render(<BootStatusChip />);
    await flush();
    expect(screen.getByTestId('boot-status-chip').textContent).toMatch(/failed/);
  });
});

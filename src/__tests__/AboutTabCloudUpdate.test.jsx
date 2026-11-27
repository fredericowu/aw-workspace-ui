import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
vi.mock('../apiBase', () => ({
  isWorkspaceSpa: () => true, workspaceSlug: () => 'acme', centralApiUrl: (p) => p,
}));

import { apiFetch } from '../auth';
import AboutTab from '../components/AboutTab';

const json = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body,
});

let healthVersion;
let updateReply;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  healthVersion = '0.167.0';
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url, opts) => {
    if (opts?.method === 'POST') return updateReply();
    if (url.includes('/versions')) return json({ workspace: { current: '0.167.0', latest: '0.167.0'.replace('167', '167'), outdated: true } });
    if (url === '/api/health') return json({ version: healthVersion });
    return json({ version: { core: healthVersion } });
  });
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' } }));
});
afterEach(() => vi.useRealTimers());

describe('AboutTab cloud update', () => {
  it('reports the version actually installed when newer than the one offered', async () => {
    updateReply = () => { healthVersion = '0.168.0'; return json({ ok: true }); };
    render(<AboutTab />);
    fireEvent.click(await screen.findByText(/Update to/));
    fireEvent.click(await screen.findByText('Update now'));
    await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
    await waitFor(() => expect(screen.getByText(/now running 0\.168\.0/)).toBeTruthy());
    expect(screen.queryByText(/Update to/)).toBeNull();
  });

  it('discloses files omitted from the forced-update list', async () => {
    const files = Array.from({ length: 10 }, (_, i) => `f${i}.py`);
    updateReply = () => json({ error: 'uncommitted_host_edits', files, dirty_count: 11, truncated: true }, 409);
    render(<AboutTab />);
    fireEvent.click(await screen.findByText(/Update to/));
    fireEvent.click(await screen.findByText('Update now'));
    await waitFor(() => expect(screen.getByText(/1 more file not listed/)).toBeTruthy());
  });
});

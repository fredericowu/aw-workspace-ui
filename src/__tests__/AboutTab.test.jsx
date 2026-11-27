import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
vi.mock('../apiBase', () => ({
  isWorkspaceSpa: () => false, workspaceSlug: () => null, centralApiUrl: (p) => p,
}));

import { apiFetch } from '../auth';
import AboutTab, { renderFact } from '../components/AboutTab';

const json = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body,
});

beforeEach(() => {
  apiFetch.mockReset();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new Error('html'); } }));
});

describe('AboutTab', () => {
  it('loads with GETs only and renders core version + unlimited/none states', async () => {
    apiFetch.mockResolvedValue(json({
      version: { core: '9.9.9', git_head: 'abcdef1234567890' },
      container: { cpu_limit: { state: 'unlimited' }, memory_limit: { state: 'unlimited' }, memory_used: { state: 'ok', value: 1073741824 } },
      machine: { cpus: { state: 'ok', value: { total: 4, effective: 4 } }, memory: { state: 'unknown', reason: 'meminfo unreadable' } },
      storage: [{ roles: ['workspace'], path: '/w', state: 'ok', total: 2 * 1073741824, used: 1073741824, free: 1073741824 }],
      gpu: { state: 'none_visible' },
    }));
    render(<AboutTab />);
    await waitFor(() => expect(screen.getByText('9.9.9')).toBeTruthy());
    expect(screen.getAllByText(/No limit set/).length).toBe(2);
    expect(screen.getByText(/None exposed/)).toBeTruthy();
    expect(screen.getByText(/Unknown: meminfo unreadable/)).toBeTruthy();
    expect(screen.getByText('Not managed from here.')).toBeTruthy();
    for (const [, opts] of [...apiFetch.mock.calls, ...global.fetch.mock.calls]) {
      expect((opts?.method || 'GET').toUpperCase()).toBe('GET');
    }
  });

  it('falls back to /api/health on /api/about 404 and labels resources', async () => {
    apiFetch.mockImplementation(async (url) =>
      url === '/api/about' ? json({}, 404) : json({ version: '1.0.0' }));
    render(<AboutTab />);
    await waitFor(() => expect(screen.getByText('1.0.0')).toBeTruthy());
    expect(screen.getByText('Needs a newer workspace core')).toBeTruthy();
  });

  it('a failed core source leaves other sections rendered', async () => {
    apiFetch.mockRejectedValue(new Error('boom'));
    render(<AboutTab />);
    await waitFor(() => expect(screen.getAllByText(/Unavailable: boom/).length).toBeGreaterThan(0));
    expect(screen.getByText('Update')).toBeTruthy();
  });

  it('renderFact distinguishes states', () => {
    expect(renderFact({ state: 'unavailable', reason: 'x' })).toBe('Unavailable: x');
    expect(renderFact({ state: 'ok', value: 3 }, (v) => `${v}!`)).toBe('3!');
  });
});

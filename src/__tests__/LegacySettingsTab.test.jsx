import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../auth', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('../apps/appsApi', () => ({ listInstalledApps: vi.fn().mockResolvedValue([{ slug: 'mcp-tools' }]) }));

import LegacySettingsTab from '../components/LegacySettingsTab';

const reply = (status, body) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });

// A fake backend: rows keyed by URL; `mode` picks the response shape.
function backend({ mode, rows }) {
  const calls = [];
  apiFetch.mockImplementation((url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    const key = url.split('/').pop();
    if ((opts.method || 'GET') === 'PUT') {
      rows[key] = JSON.parse(opts.body);
      return reply(200, mode === 'backend' ? { success: true } : { ok: true });
    }
    return reply(200, mode === 'workspace' ? { key, value: rows[key] ?? null } : rows[key]);
  });
  return calls;
}

beforeEach(() => { apiFetch.mockReset(); });

const area = (key) => screen.getByTestId(`legacy-${key}`).querySelector('textarea');
const saveBtn = (key) => [...screen.getByTestId(`legacy-${key}`).querySelectorAll('button')].find((b) => b.textContent.startsWith('Save'));

describe('LegacySettingsTab: workspace store', () => {
  it('Not set: no write on open, Save disabled, distinct from Empty object', async () => {
    const calls = backend({ mode: 'workspace', rows: {} });
    render(<LegacySettingsTab />);
    await screen.findByTestId('legacy-mcp-state');
    expect(screen.getByTestId('legacy-mcp-state').textContent).toBe('Not set');
    expect(saveBtn('mcp').disabled).toBe(true);
    expect(saveBtn('aw').disabled).toBe(true);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('Empty object has its own state', async () => {
    backend({ mode: 'workspace', rows: { mcp: {} } });
    render(<LegacySettingsTab />);
    await waitFor(() => expect(screen.getByTestId('legacy-mcp-state').textContent).toBe('Empty object'));
  });

  for (const key of ['mcp', 'aw']) {
    it(`${key}: loads seed, saves exact body, shows server copy, remount persists`, async () => {
      const rows = { [key]: { marker: 'a' } };
      const calls = backend({ mode: 'workspace', rows });
      const { unmount } = render(<LegacySettingsTab />);
      await waitFor(() => expect(area(key).value).toContain('"marker": "a"'));
      fireEvent.change(area(key), { target: { value: '{"marker":"b"}' } });
      fireEvent.click(saveBtn(key));
      await waitFor(() => expect(screen.getByTestId(`legacy-${key}-msg`).textContent).toMatch(/Saved/));
      const puts = calls.filter((c) => c.method === 'PUT');
      expect(puts).toHaveLength(1);
      expect(puts[0].url).toBe(`/api/settings/${key}`);
      expect(JSON.parse(puts[0].body)).toEqual({ marker: 'b' });
      expect(area(key).value).toContain('"b"');
      unmount();
      render(<LegacySettingsTab />);
      await waitFor(() => expect(area(key).value).toContain('"marker": "b"'));
      expect(new Set(calls.map((c) => c.url))).toEqual(new Set(['/api/settings/mcp', '/api/settings/aw']));
    });
  }

  it('refuses invalid JSON, arrays and scalars without a PUT', async () => {
    const calls = backend({ mode: 'workspace', rows: { mcp: { a: 1 } } });
    render(<LegacySettingsTab />);
    await waitFor(() => expect(area('mcp').value).toContain('"a"'));
    for (const v of ['{', '[1]', '5']) {
      fireEvent.change(area('mcp'), { target: { value: v } });
      expect(saveBtn('mcp').disabled).toBe(true);
    }
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('stale guard: a changed stored document blocks the PUT', async () => {
    const rows = { mcp: { a: 1 } };
    const calls = backend({ mode: 'workspace', rows });
    render(<LegacySettingsTab />);
    await waitFor(() => expect(area('mcp').value).toContain('"a"'));
    rows.mcp = { a: 2 }; // someone else wrote
    fireEvent.change(area('mcp'), { target: { value: '{"a":3}' } });
    fireEvent.click(saveBtn('mcp'));
    await waitFor(() => expect(screen.getByTestId('legacy-mcp-msg').textContent).toMatch(/changed since/));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('states these rows are not MCP Tools / Feed Subscriber config and links to MCP Tools', async () => {
    backend({ mode: 'workspace', rows: {} });
    const onNavigate = vi.fn();
    render(<LegacySettingsTab onNavigate={onNavigate} />);
    await screen.findByText(/not the MCP Tools configuration/);
    expect(screen.getByText(/not Feed Subscriber configuration/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Settings > Apps > MCP Tools/ }));
    expect(onNavigate).toHaveBeenCalledWith('apps', 'mcp-tools');
  });
});

describe('LegacySettingsTab: aw-backend', () => {
  const rows = () => ({ mcp: { mcpServers: { a: { command: 'x' }, b: { url: 'u' } } }, aw: { feed_subscriber: { cards: [] }, value: 1 } });

  it('mcp loads the document; non-object entry blocks save; missing success is a failure', async () => {
    const r = rows();
    const calls = backend({ mode: 'backend', rows: r });
    render(<LegacySettingsTab />);
    await waitFor(() => expect(screen.getByTestId('legacy-mcp-state').textContent).toBe('2 servers'));
    fireEvent.change(area('mcp'), { target: { value: '{"mcpServers":{"a":5}}' } });
    expect(saveBtn('mcp').disabled).toBe(true);
    // success missing -> failure shown
    apiFetch.mockImplementation((url, opts = {}) => {
      if (opts.method === 'PUT') return reply(200, { ok: true });
      return reply(200, r.mcp);
    });
    fireEvent.change(area('mcp'), { target: { value: '{"mcpServers":{"a":{"command":"y"}}}' } });
    fireEvent.click(saveBtn('mcp'));
    await waitFor(() => expect(screen.getByTestId('legacy-mcp-msg').textContent).toMatch(/Save failed/));
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('aw has no textarea, no PUT, and the button opens General > AW', async () => {
    const calls = backend({ mode: 'backend', rows: rows() });
    const onNavigate = vi.fn();
    render(<LegacySettingsTab onNavigate={onNavigate} />);
    const btn = await screen.findByRole('button', { name: /Open General > AW/ });
    expect(screen.getByTestId('legacy-aw').querySelector('textarea')).toBeNull();
    fireEvent.click(btn);
    expect(onNavigate).toHaveBeenCalledWith('general', 'aw');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('LegacySettingsTab: errors', () => {
  it('a non-200 renders no editor and no Save', async () => {
    apiFetch.mockImplementation(() => reply(401, { detail: 'x' }));
    render(<LegacySettingsTab />);
    await waitFor(() => expect(screen.getAllByText(/Could not read/).length).toBe(2));
    expect(document.querySelector('textarea')).toBeNull();
  });
});

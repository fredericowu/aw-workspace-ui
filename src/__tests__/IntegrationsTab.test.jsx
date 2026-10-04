import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import IntegrationsTab from '../components/IntegrationsTab';

describe('IntegrationsTab — Workspace API Key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
  });

  it('loads and masks the key by default, revealing on Show', async () => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/settings/workspace-api-key') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'a'.repeat(64) }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ mcpServers: {} }) });
    });

    render(<IntegrationsTab />);

    const value = await screen.findByTestId('workspace-api-key-value');
    expect(value.textContent).toMatch(/^•+$/);
    expect(value.textContent).not.toContain('a');

    fireEvent.click(screen.getByRole('button', { name: /reveal api key/i }));
    expect(screen.getByTestId('workspace-api-key-value').textContent).toBe('a'.repeat(64));
  });

  it('regenerates the key on confirm and shows the new one', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/settings/workspace-api-key/regenerate' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'b'.repeat(64) }) });
      }
      if (url === '/api/settings/workspace-api-key') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'a'.repeat(64) }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ mcpServers: {} }) });
    });

    render(<IntegrationsTab />);
    await screen.findByTestId('workspace-api-key-value');

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

    await waitFor(() => {
      expect(screen.getByTestId('workspace-api-key-value').textContent).toBe('b'.repeat(64));
    });
    expect(window.confirm).toHaveBeenCalled();
  });

  it('does not regenerate if the confirm dialog is dismissed', async () => {
    window.confirm = vi.fn(() => false);
    apiFetch.mockImplementation((url) => {
      if (url === '/api/settings/workspace-api-key') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'a'.repeat(64) }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ mcpServers: {} }) });
    });

    render(<IntegrationsTab />);
    await screen.findByTestId('workspace-api-key-value');
    apiFetch.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

    expect(apiFetch).not.toHaveBeenCalledWith('/api/settings/workspace-api-key/regenerate', expect.anything());
  });
});

describe('IntegrationsTab — Scoped API Keys', () => {
  const SCOPE = {
    id: 'scope-1',
    name: 'xiaomi-tv',
    rules: [{ app: 'xiaomi', paths: ['/tv/*'] }],
  };
  const KEY = {
    id: 'key-1',
    name: 'alexa-lambda',
    scope_id: 'scope-1',
    scope_name: 'xiaomi-tv',
    key_hint: 'awsk_abcde',
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
  };

  let scopes;
  let keys;
  let posts;

  const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
    navigator.clipboard = { writeText: vi.fn(() => Promise.resolve()) };
    scopes = [SCOPE];
    keys = [KEY];
    posts = [];

    apiFetch.mockImplementation((url, opts) => {
      const method = opts?.method || 'GET';
      if (method !== 'GET') posts.push([method, url, opts?.body ? JSON.parse(opts.body) : null]);
      if (url === '/api/settings/api-scopes' && method === 'GET') return ok({ scopes });
      if (url === '/api/settings/api-keys' && method === 'GET') return ok({ keys });
      if (url === '/api/settings/api-scopes' && method === 'POST') return ok({ id: 'scope-2' });
      if (url === '/api/settings/api-keys' && method === 'POST') {
        return ok({ ...KEY, id: 'key-2', name: 'new-key', token: 'awsk_' + 'f'.repeat(64) });
      }
      if (url === '/api/settings/workspace-api-key') return ok({ key: 'a'.repeat(64) });
      return ok({ ok: true, mcpServers: {} });
    });
  });

  it('lists scopes with their rules and keys with scope + expiry', async () => {
    render(<IntegrationsTab />);

    const scopeRow = await screen.findByTestId('scope-row-xiaomi-tv');
    expect(scopeRow.textContent).toContain('xiaomi: /tv/*');

    const keyRow = screen.getByTestId('key-row-alexa-lambda');
    expect(keyRow.textContent).toContain('awsk_abcde');
    expect(keyRow.textContent).toContain('xiaomi-tv');
    expect(keyRow.textContent).toContain('Never expires');
    expect(keyRow.textContent).toContain('never used');
  });

  it('creates a scope from the rules editor, splitting paths and methods', async () => {
    render(<IntegrationsTab />);
    await screen.findByTestId('scope-row-xiaomi-tv');

    fireEvent.click(screen.getByRole('button', { name: /new scope/i }));
    fireEvent.change(screen.getByLabelText('Scope name'), { target: { value: 'xiaomi-light' } });
    fireEvent.change(screen.getByLabelText('Rule 1 app slug'), { target: { value: 'xiaomi' } });
    fireEvent.change(screen.getByLabelText('Rule 1 paths'), { target: { value: '/light/*, /light/power' } });
    fireEvent.change(screen.getByLabelText('Rule 1 methods'), { target: { value: 'post, get' } });
    fireEvent.click(screen.getByRole('button', { name: /create scope/i }));

    await waitFor(() => {
      expect(posts).toEqual(expect.arrayContaining([[
        'POST', '/api/settings/api-scopes',
        {
          name: 'xiaomi-light',
          rules: [{ app: 'xiaomi', paths: ['/light/*', '/light/power'], methods: ['post', 'get'] }],
        },
      ]]));
    });
  });

  it('omits methods entirely when the field is left blank (= all methods)', async () => {
    render(<IntegrationsTab />);
    await screen.findByTestId('scope-row-xiaomi-tv');

    fireEvent.click(screen.getByRole('button', { name: /new scope/i }));
    fireEvent.change(screen.getByLabelText('Scope name'), { target: { value: 'all-methods' } });
    fireEvent.change(screen.getByLabelText('Rule 1 app slug'), { target: { value: 'xiaomi' } });
    fireEvent.change(screen.getByLabelText('Rule 1 paths'), { target: { value: '/tv/*' } });
    fireEvent.click(screen.getByRole('button', { name: /create scope/i }));

    await waitFor(() => {
      const [, , body] = posts.find(([, url]) => url === '/api/settings/api-scopes');
      expect(body.rules[0]).toEqual({ app: 'xiaomi', paths: ['/tv/*'] });
    });
  });

  it('edits an existing scope through PUT, prefilled from its rules', async () => {
    render(<IntegrationsTab />);
    await screen.findByTestId('scope-row-xiaomi-tv');

    fireEvent.click(screen.getByRole('button', { name: /edit scope xiaomi-tv/i }));
    expect(screen.getByLabelText('Scope name').value).toBe('xiaomi-tv');
    expect(screen.getByLabelText('Rule 1 paths').value).toBe('/tv/*');

    fireEvent.change(screen.getByLabelText('Rule 1 paths'), { target: { value: '/tv/power' } });
    fireEvent.click(screen.getByRole('button', { name: /save scope/i }));

    await waitFor(() => {
      expect(posts).toEqual(expect.arrayContaining([[
        'PUT', '/api/settings/api-scopes/scope-1',
        { name: 'xiaomi-tv', rules: [{ app: 'xiaomi', paths: ['/tv/power'] }] },
      ]]));
    });
  });

  it('mints a key with the "never" expiry preset and reveals the token exactly once', async () => {
    render(<IntegrationsTab />);
    await screen.findByTestId('scope-row-xiaomi-tv');

    fireEvent.click(screen.getByRole('button', { name: /new key/i }));
    fireEvent.change(screen.getByLabelText('Key name'), { target: { value: 'new-key' } });
    // The default preset is "Never" — the first consumer is a long-lived Lambda.
    expect(screen.getByLabelText('Expiry').value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: /create key/i }));

    const revealed = await screen.findByTestId('minted-token-value');
    expect(revealed.textContent).toBe('awsk_' + 'f'.repeat(64));
    expect(posts).toEqual(expect.arrayContaining([[
      'POST', '/api/settings/api-keys',
      { name: 'new-key', scope_id: 'scope-1', expires_in_seconds: null },
    ]]));

    // Scoped to the reveal card — the master-key card above has its own Copy.
    fireEvent.click(within(screen.getByTestId('minted-token'))
      .getByRole('button', { name: /^copy$/i }));
    await waitFor(() => expect(navigator.clipboard.writeText)
      .toHaveBeenCalledWith('awsk_' + 'f'.repeat(64)));

    // Dismissed, the token is gone from the DOM — it is never re-fetchable.
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    await waitFor(() => expect(screen.queryByTestId('minted-token')).toBeNull());
  });

  it('sends the 1-hour preset as 3600 seconds', async () => {
    render(<IntegrationsTab />);
    await screen.findByTestId('scope-row-xiaomi-tv');

    fireEvent.click(screen.getByRole('button', { name: /new key/i }));
    fireEvent.change(screen.getByLabelText('Key name'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Expiry'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /create key/i }));

    await waitFor(() => {
      const [, , body] = posts.find(([, url]) => url === '/api/settings/api-keys');
      expect(body.expires_in_seconds).toBe(3600);
    });
  });

  it('revokes a key on confirm and offers no Revoke once already revoked', async () => {
    render(<IntegrationsTab />);
    await screen.findByTestId('key-row-alexa-lambda');

    keys = [{ ...KEY, revoked_at: 1759000000 }];
    fireEvent.click(screen.getByRole('button', { name: /revoke key alexa-lambda/i }));

    await waitFor(() => {
      expect(posts).toEqual(expect.arrayContaining([
        ['POST', '/api/settings/api-keys/key-1/revoke', null],
      ]));
    });
    await waitFor(() => {
      expect(screen.getByTestId('key-row-alexa-lambda').textContent).toContain('Revoked');
      expect(screen.queryByRole('button', { name: /revoke key alexa-lambda/i })).toBeNull();
    });
  });

  it('does not revoke if the confirm dialog is dismissed', async () => {
    window.confirm = vi.fn(() => false);
    render(<IntegrationsTab />);
    await screen.findByTestId('key-row-alexa-lambda');

    fireEvent.click(screen.getByRole('button', { name: /revoke key alexa-lambda/i }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(posts).toEqual([]);
  });

  it('surfaces the 409 a scope delete gets while keys still reference it', async () => {
    apiFetch.mockImplementation((url, opts) => {
      const method = opts?.method || 'GET';
      if (url === '/api/settings/api-scopes/scope-1' && method === 'DELETE') {
        return Promise.resolve({
          ok: false, status: 409,
          json: () => Promise.resolve({ detail: 'keys still reference this scope — delete them first' }),
        });
      }
      if (url === '/api/settings/api-scopes' && method === 'GET') return ok({ scopes });
      if (url === '/api/settings/api-keys' && method === 'GET') return ok({ keys });
      if (url === '/api/settings/workspace-api-key') return ok({ key: 'a'.repeat(64) });
      return ok({ mcpServers: {} });
    });

    render(<IntegrationsTab />);
    await screen.findByTestId('scope-row-xiaomi-tv');

    fireEvent.click(screen.getByRole('button', { name: /delete scope xiaomi-tv/i }));

    const err = await screen.findByTestId('scoped-api-keys-error');
    expect(err.textContent).toContain('keys still reference this scope');
  });

  it('disables New key while no scope exists to bind one to', async () => {
    scopes = [];
    keys = [];
    render(<IntegrationsTab />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new key/i })).toBeDisabled();
    });
    expect(screen.getByText(/no scopes yet/i)).toBeTruthy();
  });
});

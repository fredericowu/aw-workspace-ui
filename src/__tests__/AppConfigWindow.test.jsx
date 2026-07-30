import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import AppConfigWindow from '../components/AppConfigWindow';

const GIT_APP = {
  slug: 'git',
  name: 'Git + GitHub CLI',
  version: '0.1.0',
  config_schema: {
    type: 'object',
    properties: {
      auth_method: { type: 'string', enum: ['token', 'web'], default: 'token' },
      github_token: { type: 'string', 'x-secret': true, description: 'PAT' },
      git_user_name: { type: 'string' },
    },
  },
};

describe('AppConfigWindow — schema-driven config window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no settings_panel window for this app (the fetchContributions
    // call AppConfigWindow always fires on mount to check for one). Tests
    // that care about the settings-submit call override with their own
    // mockResolvedValue and read the RIGHT call by URL, not by index, since
    // this contributions fetch is always call #1.
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  });

  it('renders fields from config_schema (secret → password, enum → select)', async () => {
    render(<AppConfigWindow app={GIT_APP} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());
    // secret field is a password input
    const token = document.getElementById('appcfg-github_token');
    expect(token).toHaveAttribute('type', 'password');
    // enum is a select defaulting to "token"
    const method = document.getElementById('appcfg-auth_method');
    expect(method.tagName).toBe('SELECT');
    expect(method.value).toBe('token');
  });

  it('submits the whole config object to the framework config route and shows Saved', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, logged_in: true }) });
    const onSaved = vi.fn();
    render(<AppConfigWindow app={GIT_APP} onClose={() => {}} onSaved={onSaved} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    fireEvent.change(document.getElementById('appcfg-github_token'), { target: { value: 'ghp_x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/apps/git/config',
      expect.objectContaining({ method: 'POST' }),
    ));
    const settingsCall = apiFetch.mock.calls.find((c) => c[0] === '/api/apps/git/config');
    const body = JSON.parse(settingsCall[1].body);
    expect(body).toMatchObject({ config: { auth_method: 'token', github_token: 'ghp_x' } });
    expect(await screen.findByTestId('appcfg-msg')).toHaveTextContent('Saved');
    expect(onSaved).toHaveBeenCalled();
  });

  it('renders managed-app framework toggles and saves their booleans', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    render(<AppConfigWindow app={{
      slug: 'browser',
      name: 'Browser',
      version: '1.0.0',
      managed_app: true,
      config: { auto_start: true, auth_required: true, public: false },
      config_schema: {
        type: 'object',
        properties: {
          auto_start: { type: 'boolean', title: 'Auto-start' },
          auth_required: { type: 'boolean', title: 'Authentication required' },
          public: { type: 'boolean', title: 'Public' },
        },
      },
    }} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    const autoStart = screen.getByRole('switch', { name: 'Auto-start' });
    const publicSwitch = screen.getByRole('switch', { name: 'Public' });
    expect(autoStart).toHaveAttribute('aria-checked', 'true');
    expect(publicSwitch).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(autoStart);
    fireEvent.click(publicSwitch);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/apps/browser/config',
      expect.objectContaining({ method: 'POST' }),
    ));
    const configCall = apiFetch.mock.calls.find((c) => c[0] === '/api/apps/browser/config');
    expect(JSON.parse(configCall[1].body)).toMatchObject({
      config: { auto_start: false, auth_required: true, public: true },
    });
  });

  it('adds managed-app toggles in the app settings modal when the backend schema only has app fields', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    render(<AppConfigWindow app={{
      slug: 'browser',
      name: 'Browser',
      version: '0.7.4',
      tier: 'container',
      config: { window_width: 1440, window_height: 900 },
      config_schema: {
        type: 'object',
        properties: {
          window_width: { type: 'integer', default: 1440 },
          window_height: { type: 'integer', default: 900 },
        },
      },
    }} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    expect(screen.getByRole('switch', { name: 'Auto-start' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Authentication required' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Public' })).toHaveAttribute('aria-checked', 'false');
    expect(document.getElementById('appcfg-window_width')).toHaveValue(1440);
    expect(document.getElementById('appcfg-window_height')).toHaveValue(900);
  });

  it('renders MCP Gateway final config and saves custom MCP JSON', async () => {
    const gatewayPayload = {
      custom: { mcpServers: { custom: { type: 'stdio', command: 'mine' } } },
      scanned: { mcpServers: { scanned: { type: 'stdio', command: 'scan' } } },
      final: {
        mcpServers: {
          custom: { type: 'stdio', command: 'mine' },
          scanned: { type: 'stdio', command: 'scan' },
        },
      },
      sources: {
        custom: { source: 'custom' },
        scanned: { source: 'scanned', app: 'aw-app-tools' },
      },
    };
    apiFetch.mockImplementation((url, opts = {}) => {
      if (url === '/api/apps/-/contributions') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ settings: [], windows: [] }) });
      }
      if (url === '/api/apps/mcp-gateway/admin/config' && opts.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...gatewayPayload, restart_required: true }),
        });
      }
      if (url === '/api/apps/mcp-gateway/admin/config') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(gatewayPayload) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });

    render(<AppConfigWindow app={{
      slug: 'mcp-gateway',
      name: 'MCP Gateway',
      version: '0.1.0',
      tier: 'container',
      config_schema: { type: 'object', properties: {} },
    }} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());
    expect(await screen.findByTestId('mcpgw-editor')).toBeInTheDocument();
    expect(screen.getByText('scanned')).toBeInTheDocument();
    expect(screen.getByText('scanned: aw-app-tools')).toBeInTheDocument();

    fireEvent.change(document.getElementById('mcpgw-custom-json'), {
      target: { value: JSON.stringify({ mcpServers: { custom: { type: 'stdio', command: 'next' } } }) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save custom MCPs' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/apps/mcp-gateway/admin/config',
      expect.objectContaining({ method: 'PUT' }),
    ));
    const saveCall = apiFetch.mock.calls.find((c) => c[0] === '/api/apps/mcp-gateway/admin/config' && c[1]?.method === 'PUT');
    expect(JSON.parse(saveCall[1].body)).toMatchObject({
      custom: { mcpServers: { custom: { command: 'next' } } },
    });
    expect(await screen.findByTestId('mcpgw-msg')).toHaveTextContent(/restart MCP Gateway/i);
  });

  it('falls back to the legacy app settings route when the framework config route is missing', async () => {
    apiFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ status: 404, ok: false, json: () => Promise.reject(new Error('html 404')) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    render(<AppConfigWindow app={GIT_APP} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    fireEvent.change(document.getElementById('appcfg-github_token'), { target: { value: 'ghp_x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/apps/git/settings',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(JSON.parse(apiFetch.mock.calls[1][1].body)).toMatchObject({
      config: { auth_method: 'token', github_token: 'ghp_x' },
    });
    expect(JSON.parse(apiFetch.mock.calls[2][1].body)).toMatchObject({
      auth_method: 'token',
      github_token: 'ghp_x',
    });
  });

  it('shows the empty state for an app with no configurable settings', async () => {
    render(<AppConfigWindow app={{ slug: 'essentials', name: 'Essentials', version: '0.1.0', config_schema: {} }} onClose={() => {}} />);
    expect(await screen.findByText(/no configurable settings/i)).toBeInTheDocument();
  });

  it('shows a spinner instead of the empty state while resolving whether the app has a settings window', () => {
    // Regression: the panel used to render the fields.length===0 "no
    // configurable settings" message immediately, then pop to the real
    // window once fetchContributions resolved — a visible flash/restyle.
    // The loading state must be up before that resolves.
    render(<AppConfigWindow app={{ slug: 'essentials', name: 'Essentials', version: '0.1.0', config_schema: {} }} onClose={() => {}} />);
    expect(screen.getByTestId('appcfg-loading')).toBeInTheDocument();
    expect(screen.queryByText(/no configurable settings/i)).not.toBeInTheDocument();
  });
});

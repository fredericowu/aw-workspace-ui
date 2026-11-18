import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
vi.mock('../lib/networkingApi', () => ({ fetchRemoteHosts: vi.fn() }));
import { apiFetch } from '../auth';
import { fetchRemoteHosts } from '../lib/networkingApi';
import AppConfigWindow from '../components/AppConfigWindow';

const WINDOWS_HOSTS = [
  { id: 'c76c606b0a2a5a8b', os: 'windows', friendly_name: 'DESKTOP-DRMKFBT' },
  { id: 'noname-win', os: 'windows' },
  { id: 'linux-1', os: 'linux', friendly_name: 'linux-box' },
];

const WIN_APP = {
  slug: 'windows-pilot',
  name: 'Windows Pilot',
  version: '0.1.0',
  config: { remote_host_id: 'c76c606b0a2a5a8b' },
  config_schema: {
    type: 'object',
    properties: {
      remote_host_id: {
        type: 'string',
        default: 'c76c606b0a2a5a8b',
        'x-options': {
          source: 'remote-hosts',
          filter: { os: 'windows' },
          value: 'id',
          label: ['{id} ({friendly_name})', '{id}'],
        },
      },
      python_exe: { type: 'string', default: 'py -3' },
    },
  },
};

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

  it('applies schema input constraints and saves numbers as JSON numbers', async () => {
    const app = {
      slug: 'ollama',
      config_schema: {
        required: ['model', 'workers'],
        properties: {
          model: { type: 'string', pattern: '^llama:[0-9]+b$', minLength: 1 },
          workers: { type: 'integer', default: 2, minimum: 1, maximum: 8 },
          temperature: { type: 'number', default: 0.5, minimum: 0, maximum: 1 },
        },
      },
    };
    render(<AppConfigWindow app={app} onClose={() => {}} />);
    const model = await screen.findByLabelText('model');
    const workers = screen.getByLabelText('workers');
    const temperature = screen.getByLabelText('temperature');
    expect(model).toBeRequired();
    expect(model).toHaveAttribute('pattern', expect.stringContaining(app.config_schema.properties.model.pattern));
    expect(workers).toHaveAttribute('min', '1');
    expect(workers).toHaveAttribute('max', '8');
    expect(workers).toHaveAttribute('step', '1');
    expect(temperature).toHaveAttribute('step', 'any');

    fireEvent.change(model, { target: { value: 'llama:8b' } });
    fireEvent.change(workers, { target: { value: '4' } });
    fireEvent.change(temperature, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('appcfg-msg')).toHaveTextContent('Saved');
    const [, request] = apiFetch.mock.calls.find(([url]) => url === '/api/apps/ollama/config');
    expect(JSON.parse(request.body).config).toEqual({ model: 'llama:8b', workers: 4, temperature: null });
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

  it('locks the "Public" toggle true/disabled for a non-standalone managed app (x-disabled)', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    render(<AppConfigWindow app={{
      slug: 'notes',
      name: 'Notes',
      version: '1.0.0',
      managed_app: true,
      // Stale persisted config from before this app was locked — the
      // disabled toggle must not honor it.
      config: { auto_start: true, auth_required: true, public: false },
      config_schema: {
        type: 'object',
        properties: {
          auto_start: { type: 'boolean', title: 'Auto-start', default: true },
          auth_required: { type: 'boolean', title: 'Authentication required', default: true },
          public: {
            type: 'boolean', title: 'Public', default: true, 'x-disabled': true,
            description: "This app has no standalone process/subdomain of its own.",
          },
        },
      },
    }} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    const publicSwitch = screen.getByRole('switch', { name: 'Public' });
    expect(publicSwitch).toHaveAttribute('aria-checked', 'true');
    expect(publicSwitch).toBeDisabled();

    fireEvent.click(publicSwitch);
    expect(publicSwitch).toHaveAttribute('aria-checked', 'true'); // click is a no-op while locked
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

  it('renders a raw JSON editor for mcp-tools instead of the generated form, and saves valid JSON', async () => {
    apiFetch.mockImplementation((url, opts = {}) => {
      if (url === '/api/apps/-/contributions') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ settings: [], windows: [] }) });
      }
      if (url === '/api/apps/mcp-tools/config' && opts.method === 'POST') {
        const body = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, config: body.config }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });

    render(<AppConfigWindow app={{
      slug: 'mcp-tools',
      name: 'MCP Tools',
      version: '0.5.1',
      config: { tool_playwright_enabled: true, tool_echo_enabled: false },
      config_schema: {
        type: 'object',
        properties: {
          tool_playwright_enabled: { type: 'boolean', default: true },
          tool_echo_enabled: { type: 'boolean', default: true },
        },
      },
    }} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    expect(screen.getByTestId('appcfg-json-editor')).toBeInTheDocument();
    // The generated boolean-toggle form must NOT render for this app.
    expect(screen.queryByRole('switch')).toBeNull();

    fireEvent.change(document.getElementById('appcfg-json-text'), {
      target: { value: JSON.stringify({ tool_playwright_enabled: false, tool_echo_enabled: true }) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/apps/mcp-tools/config',
      expect.objectContaining({ method: 'POST' }),
    ));
    const saveCall = apiFetch.mock.calls.find((c) => c[0] === '/api/apps/mcp-tools/config');
    expect(JSON.parse(saveCall[1].body)).toMatchObject({
      config: { tool_playwright_enabled: false, tool_echo_enabled: true },
    });
    expect(await screen.findByTestId('appcfg-msg')).toHaveTextContent('Saved');
  });

  it('shows a JSON parse error for mcp-tools and does not call the save route', async () => {
    render(<AppConfigWindow app={{
      slug: 'mcp-tools',
      name: 'MCP Tools',
      version: '0.5.1',
      config: { tool_playwright_enabled: true },
      config_schema: {
        type: 'object',
        properties: { tool_playwright_enabled: { type: 'boolean', default: true } },
      },
    }} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    fireEvent.change(document.getElementById('appcfg-json-text'), {
      target: { value: '{ not valid json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByTestId('appcfg-msg')).toHaveTextContent(/Invalid JSON/i);
    expect(apiFetch).not.toHaveBeenCalledWith(
      '/api/apps/mcp-tools/config',
      expect.objectContaining({ method: 'POST' }),
    );
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

  it('renders a "More" button when onMore is provided, and calls it with no args', async () => {
    const onMore = vi.fn();
    render(<AppConfigWindow app={GIT_APP} onClose={() => {}} onMore={onMore} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('omits the "More" button when onMore is not provided', async () => {
    render(<AppConfigWindow app={GIT_APP} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('x-options renders a select filtered to os==="windows", labelled "<id> (<friendly_name>)"', async () => {
    fetchRemoteHosts.mockResolvedValue(WINDOWS_HOSTS);
    render(<AppConfigWindow app={WIN_APP} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    const select = document.getElementById('appcfg-remote_host_id');
    expect(select.tagName).toBe('SELECT');
    const optionTexts = [...select.options].map((o) => o.textContent);
    expect(optionTexts).toContain('c76c606b0a2a5a8b (DESKTOP-DRMKFBT)');
    // The non-windows host must not appear at all.
    expect(optionTexts.some((t) => t.startsWith('linux-1'))).toBe(false);
    // Stored value stays the bare id, never the decorated label.
    const winOpt = [...select.options].find((o) => o.textContent === 'c76c606b0a2a5a8b (DESKTOP-DRMKFBT)');
    expect(winOpt.value).toBe('c76c606b0a2a5a8b');
  });

  it('a windows host with no friendly_name labels as the bare id', async () => {
    fetchRemoteHosts.mockResolvedValue(WINDOWS_HOSTS);
    render(<AppConfigWindow app={WIN_APP} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    const select = document.getElementById('appcfg-remote_host_id');
    const optionTexts = [...select.options].map((o) => o.textContent);
    expect(optionTexts).toContain('noname-win');
  });

  it('submitting an x-options field posts the bare id, not the label', async () => {
    fetchRemoteHosts.mockResolvedValue(WINDOWS_HOSTS);
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    render(<AppConfigWindow app={WIN_APP} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    fireEvent.change(document.getElementById('appcfg-remote_host_id'), { target: { value: 'noname-win' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/apps/windows-pilot/config',
      expect.objectContaining({ method: 'POST' }),
    ));
    const configCall = apiFetch.mock.calls.find((c) => c[0] === '/api/apps/windows-pilot/config');
    const body = JSON.parse(configCall[1].body);
    expect(body.config.remote_host_id).toBe('noname-win');
  });

  it('a saved id absent from the resolved list is preserved, selected, and still posted', async () => {
    fetchRemoteHosts.mockResolvedValue(WINDOWS_HOSTS);
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
    const app = { ...WIN_APP, config: { remote_host_id: 'ghost-id' } };
    render(<AppConfigWindow app={app} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    const select = document.getElementById('appcfg-remote_host_id');
    expect(select.value).toBe('ghost-id');
    expect([...select.options].some((o) => o.value === 'ghost-id')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/apps/windows-pilot/config',
      expect.objectContaining({ method: 'POST' }),
    ));
    const configCall = apiFetch.mock.calls.find((c) => c[0] === '/api/apps/windows-pilot/config');
    expect(JSON.parse(configCall[1].body).config.remote_host_id).toBe('ghost-id');
  });

  it('falls back to the text input, saved value intact, when the resolved list is empty', async () => {
    fetchRemoteHosts.mockResolvedValue([]);
    render(<AppConfigWindow app={WIN_APP} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    const field = document.getElementById('appcfg-remote_host_id');
    expect(field.tagName).toBe('INPUT');
    expect(field.value).toBe('c76c606b0a2a5a8b');
  });

  it('falls back to the text input, without blanking the rest of the form, when the fetch throws', async () => {
    fetchRemoteHosts.mockRejectedValue(new Error('HTTP 500'));
    render(<AppConfigWindow app={WIN_APP} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    const field = document.getElementById('appcfg-remote_host_id');
    expect(field.tagName).toBe('INPUT');
    expect(field.value).toBe('c76c606b0a2a5a8b');
    // The other field on the same form must not have been blanked by the throw.
    expect(document.getElementById('appcfg-python_exe')).toHaveValue('py -3');
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

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import McpGatewayExternalUpstreams from '../components/McpGatewayExternalUpstreams';

const PAYLOAD = {
  upstreams: [
    {
      name: 'google-workspace',
      spec: { type: 'stdio', command: 'uvx', args: ['workspace-mcp', '--single-user'], env: { GOOGLE_OAUTH_CLIENT_ID: '${secret:google-workspace-GOOGLE_OAUTH_CLIENT_ID}' } },
      enabled: true,
      status: 'running',
      error: null,
      tools: 12,
    },
    {
      name: 'weather-http',
      spec: { type: 'http', url: 'https://weather.example/mcp' },
      enabled: true,
      status: 'stopped',
      error: null,
      tools: 0,
    },
  ],
};

function mockLoad(payload = PAYLOAD) {
  apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) });
}

async function renderLoaded() {
  render(<McpGatewayExternalUpstreams />);
  await waitFor(() => expect(screen.getByTestId('mcpgw-external-add')).toBeInTheDocument());
}

describe('McpGatewayExternalUpstreams', () => {
  beforeEach(() => { vi.clearAllMocks(); mockLoad(); });

  it('lists each registered upstream with its type, status and tool count', async () => {
    await renderLoaded();
    expect(screen.getByText('External upstreams (2)')).toBeInTheDocument();
    expect(screen.getByText('google-workspace')).toBeInTheDocument();
    expect(screen.getByText('weather-http')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('stopped')).toBeInTheDocument();
    expect(screen.getByText('12 tools')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is registered', async () => {
    mockLoad({ upstreams: [] });
    await renderLoaded();
    expect(screen.getByText('External upstreams (0)')).toBeInTheDocument();
    expect(screen.getByText('No external upstreams registered yet.')).toBeInTheDocument();
  });

  it('add flow: a secret-checked field is sent once via secrets, spec stores the placeholder', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId('mcpgw-external-add'));

    const form = screen.getByTestId('mcpgw-external-form');
    fireEvent.change(within(form).getByPlaceholderText('google-workspace'), { target: { value: 'new-http' } });
    fireEvent.change(within(form).getByText('Type').closest('.mcpgw-cfg-field').querySelector('select'), {
      target: { value: 'http' },
    });
    fireEvent.change(within(form).getByPlaceholderText('https://example.test/mcp'), {
      target: { value: 'https://api.example/mcp' },
    });

    fireEvent.click(within(form).getByText('+ Add header'));
    fireEvent.change(within(form).getByPlaceholderText('key'), { target: { value: 'Authorization' } });
    const secretCheckbox = within(form).getByText('secret').closest('label').querySelector('input');
    fireEvent.click(secretCheckbox);
    fireEvent.change(within(form).getByPlaceholderText('value'), { target: { value: 'Bearer super-secret' } });

    apiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        name: 'new-http', spec: { type: 'http', url: 'https://api.example/mcp', headers: { Authorization: '${secret:new-http-Authorization}' } },
        enabled: true, status: 'running', error: null, tools: 3,
      }),
    });
    fireEvent.click(within(form).getByTestId('mcpgw-external-save'));

    await waitFor(() => expect(screen.getByTestId('mcpgw-external-msg')).toBeInTheDocument());
    const put = apiFetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
    expect(put[0]).toBe('/api/apps/mcp-gateway/admin/external-upstreams/new-http');
    const body = JSON.parse(put[1].body);
    expect(body.secrets).toEqual({ 'new-http-Authorization': 'Bearer super-secret' });
    expect(body.spec.headers).toEqual({ Authorization: '${secret:new-http-Authorization}' });
  });

  it('editing an existing entry never shows the secret value, only the ref chip', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText('google-workspace'));

    const form = screen.getByTestId('mcpgw-external-form');
    expect(within(form).getByTestId('mcpgw-external-ref-GOOGLE_OAUTH_CLIENT_ID'))
      .toHaveTextContent('${secret:google-workspace-GOOGLE_OAUTH_CLIENT_ID}');
    expect(within(form).getByText('Replace value')).toBeInTheDocument();
    // The ref renders as a <code> chip, not an input — nothing to leak a real value into.
    expect(within(form).queryByPlaceholderText('value')).not.toBeInTheDocument();
  });

  it('a failed start surfaces inline in the still-open form', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByText('weather-http'));
    const form = screen.getByTestId('mcpgw-external-form');

    apiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        name: 'weather-http', spec: { type: 'http', url: 'https://weather.example/mcp' },
        enabled: true, status: 'error', error: 'connection refused', tools: 0,
      }),
    });
    fireEvent.click(within(form).getByTestId('mcpgw-external-save'));

    await waitFor(() =>
      expect(screen.getByTestId('mcpgw-external-form-error')).toHaveTextContent('connection refused'));
    // Form stayed open — not silently closed on a failed start.
    expect(screen.getByTestId('mcpgw-external-form')).toBeInTheDocument();
  });

  it('a name colliding with a scanned app upstream surfaces the 409 message, not swallowed', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId('mcpgw-external-add'));
    const form = screen.getByTestId('mcpgw-external-form');
    fireEvent.change(within(form).getByPlaceholderText('google-workspace'), { target: { value: 'aw-crispal' } });
    fireEvent.change(within(form).getByPlaceholderText('uvx'), { target: { value: 'uvx' } });

    apiFetch.mockResolvedValue({
      ok: false, status: 409,
      json: () => Promise.resolve({ error: "'aw-crispal' is provided by an installed app — cannot be overridden here" }),
    });
    fireEvent.click(within(form).getByTestId('mcpgw-external-save'));

    await waitFor(() =>
      expect(screen.getByTestId('mcpgw-external-form-error')).toHaveTextContent(/provided by an installed app/));
  });

  it('delete flow: two-step confirm, then DELETE and remove from the list', async () => {
    await renderLoaded();
    const row = screen.getByText('weather-http').closest('.mcpgw-cfg');

    fireEvent.click(within(row).getByText('Delete'));
    expect(screen.getByText('weather-http')).toBeInTheDocument();

    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, reload: {} }) });
    fireEvent.click(within(row).getByText('Confirm'));

    await waitFor(() => expect(screen.queryByText('weather-http')).not.toBeInTheDocument());
    const del = apiFetch.mock.calls.find(([, opts]) => opts?.method === 'DELETE');
    expect(del[0]).toBe('/api/apps/mcp-gateway/admin/external-upstreams/weather-http');
  });
});

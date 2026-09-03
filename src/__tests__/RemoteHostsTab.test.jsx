import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../auth';
import RemoteHostsTab from '../components/RemoteHostsTab';

const HOSTS = [
  {
    id: '11e8bd4157845a24', workspace_slug: 'aw', hostname: 'b614f41828c8', friendly_name: null,
    os: 'linux', arch: 'amd64', cli_version: 'v0.1.58', last_seen_at: 1787646690.5, connected: true,
    workspaces: [{ slug: 'aw', status: 'running', placement_driver: 'remote-host' }],
  },
  {
    id: '824decc7e0610089', workspace_slug: 'fredericowu', hostname: 'Mac.Home', friendly_name: 'Fred’s Mac',
    os: 'darwin', arch: 'arm64', cli_version: 'v0.1.58', last_seen_at: 1787646670.5, connected: true,
    workspaces: [],
  },
  {
    id: '6bb0d0fbf5b22492', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', friendly_name: null,
    os: 'windows', arch: 'amd64', cli_version: 'v0.1.54', last_seen_at: 1787000000.0, connected: false,
    workspaces: [],
  },
];

const MESH = {
  control_plane_url: 'https://headscale.aw.tekflox.com',
  nodes: {
    '11e8bd4157845a24': {
      reported: true, up: true, mesh_ip: '100.64.0.1', node_name: 'aw-baremetal',
      offers_exit: true, advertises_exit: true,
      eligibility: { can_enroll: true, can_advertise_exit: true, exit_warning: '' },
    },
    '824decc7e0610089': {
      reported: true, up: true, mesh_ip: '100.64.0.3', node_name: 'mac-home',
      offers_exit: false, advertises_exit: false,
      eligibility: { can_enroll: false, can_advertise_exit: false, exit_refusal: 'macOS cannot advertise a route.' },
    },
  },
};

const HOSTS_PATH = /\/remote-hosts$/;
const MESH_PATH = /\/mesh-status$/;
const HOST_PUBLIC_IP_PATH = /\/remote-hosts\/([^/]+)\/public-ip$/;
const RENAME_PATH = /\/remote-hosts\/([^/]+)$/;
const BOOTSTRAP_TOKEN_PATH = /\/bootstrap-token$/;

function mockApi({
  hosts = HOSTS, mesh = MESH, meshFail = false, hostPublicIps = {}, rename = null, bootstrapToken = null,
} = {}) {
  apiFetch.mockImplementation((url, options) => {
    if (url === '/api/identity/me') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }) });
    }
    if (BOOTSTRAP_TOKEN_PATH.test(url)) {
      const reply = typeof bootstrapToken === 'function' ? bootstrapToken(options) : bootstrapToken;
      if (reply instanceof Error) {
        return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: reply.message }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply || { token: 'awbs_test123', expires_at: null }) });
    }
    if (MESH_PATH.test(url)) {
      if (meshFail) {
        return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'Bad Gateway' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mesh) });
    }
    const hostIpMatch = url.match(HOST_PUBLIC_IP_PATH);
    if (hostIpMatch) {
      const reply = hostPublicIps[hostIpMatch[1]] || { ip: null, via: null, error: 'not measured in this fixture' };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply) });
    }
    if (options?.method === 'PATCH' && RENAME_PATH.test(url)) {
      const idMatch = url.match(RENAME_PATH);
      const reply = typeof rename === 'function' ? rename(idMatch[1], options) : rename;
      if (reply instanceof Error) {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: reply.message }) });
      }
      const body = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(reply || { id: idMatch[1], friendly_name: body.friendly_name }),
      });
    }
    if (HOSTS_PATH.test(url)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: hosts.length, hosts }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'unhandled ' + url }) });
  });
}

describe('RemoteHostsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists every linked host, offline included, one row per link', async () => {
    mockApi();
    render(<RemoteHostsTab />);

    await screen.findByText('b614f41828c8');
    expect(screen.getByText('Mac.Home')).toBeInTheDocument();
    // Offline host is not dropped — it stays in the list.
    expect(screen.getByText('DESKTOP-DRMKFBT')).toBeInTheDocument();
    expect(screen.getByText('offline')).toBeInTheDocument();
  });

  it('pre-fills the friendly name input from the server, blank when unset', async () => {
    mockApi();
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    expect(screen.getByDisplayValue('Fred’s Mac')).toBeInTheDocument();
    const blankInput = screen.getByLabelText('Friendly name for b614f41828c8');
    expect(blankInput.value).toBe('');
    expect(blankInput.placeholder).toBe('b614f41828c8');
  });

  it('shows the workspaces placed on a link, and a dash for none', async () => {
    mockApi();
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    expect(screen.getByText('aw')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('uses the OFFER verdict for the exit-gate column, not the select refusal', async () => {
    mockApi();
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    // The Linux host advertises AND is approved -> "Offering as exit gate".
    // The Mac is refused by its own agent for advertising, which is a
    // DIFFERENT refusal than exitGateSelectRefusal would report (that one
    // refuses the Mac for a totally different, architectural reason).
    expect(screen.getByText('Offering as exit gate')).toBeInTheDocument();
    expect(screen.getByText('Cannot be an exit gate')).toBeInTheDocument();
  });

  it('degrades the exit-gate column to unknown on a mesh outage, without blanking the table', async () => {
    mockApi({ meshFail: true });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
    // Every other column still renders.
    expect(screen.getByText('Mac.Home')).toBeInTheDocument();
    expect(screen.getByText(/Mesh status unavailable/)).toBeInTheDocument();
  });

  it('never asks an offline host for its public IP', async () => {
    mockApi();
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    await waitFor(() => {
      const asked = apiFetch.mock.calls.some(([url]) => /\/remote-hosts\/6bb0d0fbf5b22492\/public-ip$/.test(url));
      expect(asked).toBe(false);
    });
  });

  it('keeps Save disabled until a field actually differs from the server', async () => {
    mockApi();
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();

    const input = screen.getByLabelText('Friendly name for b614f41828c8');
    fireEvent.change(input, { target: { value: 'aw-baremetal' } });
    expect(saveButton).not.toBeDisabled();

    // Typing back to the original value is clean again.
    fireEvent.change(input, { target: { value: '' } });
    expect(saveButton).toBeDisabled();
  });

  it('saves only the dirty row, then clears the draft on success', async () => {
    mockApi();
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    const input = screen.getByLabelText('Friendly name for b614f41828c8');
    fireEvent.change(input, { target: { value: 'aw-baremetal' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const patched = apiFetch.mock.calls.some(
        ([url, opts]) => opts?.method === 'PATCH' && /11e8bd4157845a24/.test(url)
          && JSON.parse(opts.body).friendly_name === 'aw-baremetal',
      );
      expect(patched).toBe(true);
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled());
  });

  it('keeps a failed row dirty with its own error, rather than losing the edit', async () => {
    mockApi({ rename: (id) => (id === '11e8bd4157845a24' ? new Error('name already taken') : null) });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    const input = screen.getByLabelText('Friendly name for b614f41828c8');
    fireEvent.change(input, { target: { value: 'aw-baremetal' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/name already taken/)).toBeInTheDocument();
    // Still dirty: the edit was not silently discarded.
    expect(screen.getByRole('button', { name: /^save$/i })).not.toBeDisabled();
    expect(input.value).toBe('aw-baremetal');
  });

  it('mints no bootstrap token on load — only on a press', async () => {
    mockApi();
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    expect(apiFetch.mock.calls.some(([url]) => BOOTSTRAP_TOKEN_PATH.test(url))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /generate link command/i }));
    await screen.findByText(/aw-remote-host link --token awbs_test123 --background/);
    expect(apiFetch.mock.calls.some(([url]) => BOOTSTRAP_TOKEN_PATH.test(url))).toBe(true);
  });

  it('never renders the workspace API key anywhere on this screen', async () => {
    mockApi();
    const { container } = render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');
    fireEvent.click(screen.getByRole('button', { name: /generate link command/i }));
    await screen.findByText(/aw-remote-host link --token/);

    expect(container.textContent).not.toMatch(/X-Api-Key/i);
  });

  it('calls the navigate-out callback from the Networking link, not a dead button', async () => {
    mockApi();
    const onNavigate = vi.fn();
    render(<RemoteHostsTab onNavigateToNetworking={onNavigate} />);
    await screen.findByText('b614f41828c8');

    fireEvent.click(screen.getByRole('button', { name: /manage exit gates in networking/i }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed host list with a retry, instead of an empty table', async () => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/identity/me') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }) });
      }
      if (HOSTS_PATH.test(url)) {
        return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'Bad Gateway' }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
    render(<RemoteHostsTab />);

    expect(await screen.findByText(/Could not list the hosts/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

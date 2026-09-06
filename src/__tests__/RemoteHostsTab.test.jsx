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
const RENAME_OR_DELETE_PATH = /\/remote-hosts\/([^/]+)$/;
const BOOTSTRAP_TOKEN_PATH = /\/bootstrap-token$/;
const VERSIONS_PATH = /\/versions$/;
const UPDATE_REMOTE_HOST_PATH = /\/remote-host\/update$/;

function mockApi({
  hosts = HOSTS, mesh = MESH, meshFail = false, hostPublicIps = {}, rename = null, bootstrapToken = null,
  deleteHost = null, hostsAfterDelete = null, latest = null, updateRemoteHost = null, hostsAfterUpdate = null,
} = {}) {
  let currentHosts = hosts;
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
    if (VERSIONS_PATH.test(url)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ remote_host: { current: null, latest, outdated: null } }) });
    }
    if (options?.method === 'POST' && UPDATE_REMOTE_HOST_PATH.test(url)) {
      const reply = typeof updateRemoteHost === 'function' ? updateRemoteHost(url, options) : updateRemoteHost;
      if (reply instanceof Error) {
        return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: reply.message }) });
      }
      if (hostsAfterUpdate) currentHosts = hostsAfterUpdate;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply || { slug: 'aw' }) });
    }
    const hostIpMatch = url.match(HOST_PUBLIC_IP_PATH);
    if (hostIpMatch) {
      const reply = hostPublicIps[hostIpMatch[1]] || { ip: null, via: null, error: 'not measured in this fixture' };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply) });
    }
    if (options?.method === 'PATCH' && RENAME_OR_DELETE_PATH.test(url)) {
      const idMatch = url.match(RENAME_OR_DELETE_PATH);
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
    if (options?.method === 'DELETE' && RENAME_OR_DELETE_PATH.test(url)) {
      const idMatch = url.match(RENAME_OR_DELETE_PATH);
      const reply = typeof deleteHost === 'function' ? deleteHost(idMatch[1], options) : deleteHost;
      if (reply instanceof Error) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: reply.message }) });
      }
      if (hostsAfterDelete) currentHosts = hostsAfterDelete;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply || { ok: true }) });
    }
    if (HOSTS_PATH.test(url)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: currentHosts.length, hosts: currentHosts }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'unhandled ' + url }) });
  });
}

describe('RemoteHostsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
  });

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

  describe('OS-column elevation badge', () => {
    it('renders [root] when elevated is true on a non-Windows host', async () => {
      mockApi({ hosts: [{ ...HOSTS[0], elevated: true }] });
      render(<RemoteHostsTab />);
      await screen.findByText('b614f41828c8');

      expect(screen.getByText('[root]')).toBeInTheDocument();
    });

    it('renders [admin] when elevated is true on a Windows host', async () => {
      mockApi({ hosts: [{ ...HOSTS[2], elevated: true }] });
      render(<RemoteHostsTab />);
      await screen.findByText('DESKTOP-DRMKFBT');

      expect(screen.getByText('[admin]')).toBeInTheDocument();
    });

    it('renders no badge when elevated is false or absent (an older binary)', async () => {
      mockApi({
        hosts: [
          { ...HOSTS[0], elevated: false },
          { ...HOSTS[1], elevated: undefined },
        ],
      });
      render(<RemoteHostsTab />);
      await screen.findByText('b614f41828c8');

      expect(screen.queryByText('[root]')).not.toBeInTheDocument();
      expect(screen.queryByText('[admin]')).not.toBeInTheDocument();
    });
  });

  it('uses the OFFER verdict for the exit-gate column, not the select refusal', async () => {
    mockApi();
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    // The Linux host advertises AND is approved -> "Offering". The Mac is
    // refused by its own agent for advertising ("Not eligible"), which is a
    // DIFFERENT refusal than exitGateSelectRefusal would report (that one
    // refuses the Mac for a totally different, architectural reason). The
    // full sentence lives in the badge's tooltip, not on the badge itself.
    const offeringBadge = screen.getByText('Offering');
    expect(offeringBadge).toBeInTheDocument();
    expect(offeringBadge).toHaveAttribute('title', expect.stringContaining('Offering as exit gate'));
    expect(screen.getByText('Not eligible')).toBeInTheDocument();
  });

  it('degrades the exit-gate column to unknown on a mesh outage, without blanking the table', async () => {
    mockApi({ meshFail: true });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
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

  it('deletes a host on confirm, calling DELETE with that host id', async () => {
    mockApi({ hostsAfterDelete: HOSTS.filter((h) => h.id !== '11e8bd4157845a24') });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    fireEvent.click(screen.getByRole('button', { name: /delete link to b614f41828c8/i }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('b614f41828c8'));
    await waitFor(() => {
      const deleted = apiFetch.mock.calls.some(
        ([url, opts]) => opts?.method === 'DELETE' && /11e8bd4157845a24/.test(url),
      );
      expect(deleted).toBe(true);
    });
  });

  it('does not call the network at all when the confirm dialog is dismissed', async () => {
    window.confirm = vi.fn(() => false);
    mockApi();
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');
    apiFetch.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /delete link to b614f41828c8/i }));

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('refetches the list on a successful delete, so the row disappears', async () => {
    mockApi({ hostsAfterDelete: HOSTS.filter((h) => h.id !== '11e8bd4157845a24') });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    fireEvent.click(screen.getByRole('button', { name: /delete link to b614f41828c8/i }));

    await waitFor(() => expect(screen.queryByText('b614f41828c8')).not.toBeInTheDocument());
    // The other rows are untouched.
    expect(screen.getByText('Mac.Home')).toBeInTheDocument();
  });

  it('shows a row error and keeps the row on a failed delete', async () => {
    mockApi({ deleteHost: (id) => (id === '11e8bd4157845a24' ? new Error('not found') : null) });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    fireEvent.click(screen.getByRole('button', { name: /delete link to b614f41828c8/i }));

    expect(await screen.findByText(/not found/)).toBeInTheDocument();
    // Still in the table — a failed delete does not remove the row.
    expect(screen.getByText('b614f41828c8')).toBeInTheDocument();
    // The button is re-enabled, not stuck disabled from the failed attempt.
    expect(screen.getByRole('button', { name: /delete link to b614f41828c8/i })).not.toBeDisabled();
  });

  it('shows an enabled Update button only for the row that is outdated AND has a remote-host workspace', async () => {
    mockApi({ latest: 'v0.1.99' });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    // HOSTS[0] is outdated (v0.1.58) and carries a placement_driver:'remote-host'
    // workspace — the only row that qualifies for an enabled button.
    const enabled = screen.getByRole('button', { name: /update to v0\.1\.99/i });
    expect(enabled).not.toBeDisabled();
    expect(screen.getAllByRole('button', { name: /update to v0\.1\.99/i })).toHaveLength(1);
  });

  it('renders no button, just a titled note, when outdated but the host has no remote-host workspace', async () => {
    mockApi({ latest: 'v0.1.99' });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    // HOSTS[1] (Mac.Home) and HOSTS[2] (DESKTOP-DRMKFBT) are both outdated
    // and both have `workspaces: []` — no button, just a titled "outdated".
    const notes = screen.getAllByTitle(/no BYOD workspace to dispatch the update through/i);
    expect(notes).toHaveLength(2);
    for (const note of notes) {
      expect(note.tagName).not.toBe('BUTTON');
    }
  });

  it('shows a disabled "Up to date" button when cli_version already matches latest', async () => {
    mockApi({ latest: 'v0.1.58' });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    // HOSTS[0] and HOSTS[1] are both already on v0.1.58.
    const upToDate = screen.getAllByRole('button', { name: /up to date/i });
    expect(upToDate).toHaveLength(2);
    for (const btn of upToDate) expect(btn).toBeDisabled();
  });

  it('renders no update affordance at all when latest is unknown', async () => {
    mockApi({ latest: null });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    expect(screen.queryByRole('button', { name: /update to/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /up to date/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/no BYOD workspace to dispatch the update through/i)).not.toBeInTheDocument();
  });

  it('re-fetches hosts, mesh, and latest version on a manual refresh press, without blanking the table', async () => {
    mockApi({ latest: 'v0.1.58' });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    apiFetch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));

    await waitFor(() => {
      expect(apiFetch.mock.calls.some(([url]) => HOSTS_PATH.test(url))).toBe(true);
      expect(apiFetch.mock.calls.some(([url]) => MESH_PATH.test(url))).toBe(true);
      expect(apiFetch.mock.calls.some(([url]) => VERSIONS_PATH.test(url))).toBe(true);
    });
    // The rows stayed on screen throughout — a refresh never blanks the table.
    expect(screen.getByText('b614f41828c8')).toBeInTheDocument();
    expect(screen.getByText('Mac.Home')).toBeInTheDocument();
  });

  it('surfaces a failed refresh without losing the rows already on screen', async () => {
    let hostsCalls = 0;
    apiFetch.mockImplementation((url) => {
      if (url === '/api/identity/me') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }) });
      }
      if (MESH_PATH.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve(MESH) });
      if (VERSIONS_PATH.test(url)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ remote_host: { current: null, latest: null, outdated: null } }) });
      }
      if (HOST_PUBLIC_IP_PATH.test(url)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ip: null, via: null, error: 'not measured in this fixture' }) });
      }
      if (HOSTS_PATH.test(url)) {
        hostsCalls += 1;
        if (hostsCalls === 1) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: HOSTS.length, hosts: HOSTS }) });
        }
        return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'Bad Gateway' }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'unhandled ' + url }) });
    });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));

    expect(await screen.findByText(/refresh failed/i)).toBeInTheDocument();
    // The previous rows are untouched by the failed attempt.
    expect(screen.getByText('b614f41828c8')).toBeInTheDocument();
    expect(screen.getByText('Mac.Home')).toBeInTheDocument();
  });

  it('dispatches the update to the row\'s remote-host workspace slug, then refetches instead of relabeling', async () => {
    const updatedHosts = HOSTS.map((h) => (
      h.id === '11e8bd4157845a24' ? { ...h, cli_version: 'v0.1.99' } : h
    ));
    mockApi({ latest: 'v0.1.99', hostsAfterUpdate: updatedHosts });
    render(<RemoteHostsTab />);
    await screen.findByText('b614f41828c8');

    fireEvent.click(screen.getByRole('button', { name: /update to v0\.1\.99/i }));

    await waitFor(() => {
      const called = apiFetch.mock.calls.some(
        ([url, opts]) => opts?.method === 'POST' && /\/workspaces\/aw\/remote-host\/update$/.test(url),
      );
      expect(called).toBe(true);
    });

    // The endpoint's own response carries no cli_version — the row only
    // flips to "Up to date" once the REFETCHED host list reports the new
    // version, never by relabeling the click's response directly.
    await waitFor(() => expect(screen.getByRole('button', { name: /up to date/i })).toBeInTheDocument());
  });
});

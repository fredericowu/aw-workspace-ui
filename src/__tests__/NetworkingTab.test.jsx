import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import NetworkingTab from '../components/NetworkingTab';
import { bootstrapEligibility } from '../lib/networkingApi';

// Real payload, captured 2026-08-25 from
// `aw-workspace-cli remote-hosts hosts` — same route the tab calls. Trimmed to
// the rows that carry the cases this screen has to get right: two ineligible
// OSes, a Linux host, and the duplicate hostname/offline links.
const HOSTS = [
  { id: '11e8bd4157845a24', workspace_slug: 'aw', hostname: 'b614f41828c8', os: 'linux', arch: 'amd64', last_seen_at: 1787646690.5, connected: true },
  { id: 'c76c606b0a2a5a8b', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'windows', arch: 'amd64', last_seen_at: 1787646684.5, connected: true },
  { id: 'caf475b7032ee441', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'linux', arch: 'amd64', last_seen_at: 1787646678.5, connected: true },
  { id: '824decc7e0610089', workspace_slug: 'fredericowu', hostname: 'Mac.Home', os: 'darwin', arch: 'arm64', last_seen_at: 1787646670.5, connected: true },
  { id: '6bb0d0fbf5b22492', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'linux', arch: 'amd64', last_seen_at: 1787000000.0, connected: false },
  { id: '8435edb900436230', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'linux', arch: 'amd64', last_seen_at: 1787000000.0, connected: false },
];

// The mesh-status payload as aw-backend's `mesh_status` builds it — snake_case
// on the wire, keyed by remote-host id. Values are the real mesh measured
// 2026-08-25: the Mac reaches the bare-metal directly, and the Surface's WSL2
// link relays through Madrid even from the same home network.
const MESH = {
  control_plane_url: 'https://headscale.aw.tekflox.com',
  nodes: {
    '11e8bd4157845a24': {
      reported: true, up: true, mesh_ip: '100.64.0.1', node_name: 'aw-baremetal',
      path: 'direct', via: '65.109.66.88:41641', exit_node: null, offers_exit: true,
    },
    caf475b7032ee441: {
      reported: true, up: true, mesh_ip: '100.64.0.2', node_name: 'aw-surface-wsl',
      path: 'relay', via: 'DERP(mad)', exit_node: null, offers_exit: false,
    },
    // Answered, and what it said was "no tailscale here".
    c76c606b0a2a5a8b: {
      reported: true, up: false,
      reason: 'the tailscale CLI is not installed on this host',
    },
    // Never answered — the honest-unknown. No address, no up/down.
    '824decc7e0610089': {
      reported: false,
      reason: 'the host did not answer within 25s',
    },
  },
};

const MESH_PATH = /\/mesh-status$/;

function mockApi({ hosts = HOSTS, hostsFail = false, mesh = MESH, meshFail = false } = {}) {
  apiFetch.mockImplementation((url) => {
    if (url === '/api/identity/me') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }) });
    }
    if (MESH_PATH.test(url)) {
      if (meshFail) {
        return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'Bad Gateway' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mesh) });
    }
    if (url.startsWith('/api/workspaces/')) {
      if (hostsFail) {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not Found' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: hosts.length, hosts }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

describe('bootstrapEligibility', () => {
  it('refuses non-Linux with the OS named in the reason', () => {
    const win = bootstrapEligibility({ os: 'windows' });
    expect(win.state).toBe('no');
    expect(win.reason).toMatch(/windows/i);

    const mac = bootstrapEligibility({ os: 'darwin' });
    expect(mac.state).toBe('no');
    expect(mac.reason).toMatch(/root/i);
  });

  it('never claims a Linux host is eligible off the OS alone', () => {
    // Root and /dev/net/tun are what actually decide it and nothing reports
    // them yet — answering 'yes' here would be inventing both.
    const linux = bootstrapEligibility({ os: 'linux' });
    expect(linux.state).toBe('unknown');
    expect(linux.reason).toMatch(/no agent data/i);
  });

  it('always carries a reason, whatever the verdict', () => {
    for (const os of ['linux', 'windows', 'darwin', '']) {
      expect(bootstrapEligibility({ os }).reason).toBeTruthy();
    }
  });
});

describe('NetworkingTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the connected links and keeps duplicate hostnames as separate rows', async () => {
    mockApi();
    render(<NetworkingTab />);

    await screen.findByText('b614f41828c8');
    // The Surface's Windows link and its WSL2 link share a hostname and are
    // two different links — collapsing them would hide that one is ineligible.
    expect(screen.getAllByText('DESKTOP-DRMKFBT')).toHaveLength(2);
    expect(screen.getByText('Mac.Home')).toBeInTheDocument();
    // Offline links are present but folded away, not dropped.
    expect(screen.getByRole('button', { name: /offline links \(2\)/i })).toBeInTheDocument();
  });

  it('writes the ineligibility reason as text, not only in a tooltip', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('Mac.Home');

    expect(screen.getAllByText(/Not Linux \(windows\)/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/macOS — automatic bootstrap is Linux-only/i).length).toBeGreaterThan(0);
  });

  it('shows each reporting host its own mesh IP and direct/relay badge', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('b614f41828c8');

    expect(screen.getByText('100.64.0.1')).toBeInTheDocument();
    expect(screen.getByText('65.109.66.88:41641', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('direct')).toBeInTheDocument();
    // The whole reason this column exists: same home network, still relayed.
    expect(screen.getByText('100.64.0.2')).toBeInTheDocument();
    expect(screen.getByText('relay')).toBeInTheDocument();
    expect(screen.getByText(/via DERP\(mad\)/)).toBeInTheDocument();
  });

  it('publishes the control plane from the API, not from a constant', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('b614f41828c8');

    expect(screen.getByText('https://headscale.aw.tekflox.com')).toBeInTheDocument();
    // The install commands now carry the real URL instead of the placeholder.
    expect(screen.queryByText(/<tenant-control-plane>/)).not.toBeInTheDocument();
  });

  it('leaves a host that reported nothing UNKNOWN, with no invented address', async () => {
    // Mac.Home (824decc7e0610089) timed out. The other hosts' rows carry real
    // 100.64.x.x addresses, so "no mesh IP anywhere" is not the assertion —
    // "no mesh IP on the row of the host that never spoke" is.
    mockApi();
    render(<NetworkingTab />);
    const macRow = (await screen.findByText('Mac.Home')).closest('div.py-3');

    expect(macRow.textContent).toMatch(/no agent data/i);
    expect(macRow.textContent).toMatch(/did not answer within 25s/);
    expect(macRow.textContent).not.toMatch(/100\.\d+\.\d+\.\d+/);
    // Unknown is not offline. Neither word may appear as a mesh verdict.
    expect(macRow.textContent).not.toMatch(/mesh offline|disconnected|not on the mesh/i);
  });

  it('keeps "the host said it is not on the mesh" apart from "the host said nothing"', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('b614f41828c8');
    // The Windows link answered: tailscale simply is not installed there.
    const windowsRow = screen.getAllByText('DESKTOP-DRMKFBT')[0].closest('div.py-3');

    expect(windowsRow.textContent).toMatch(/not on the mesh/i);
    expect(windowsRow.textContent).toMatch(/tailscale CLI is not installed/);
    expect(windowsRow.textContent).not.toMatch(/no agent data/i);
  });

  it('a failed mesh call degrades to unknown WITHOUT taking the host list down', async () => {
    // The two fetches share a Promise.all. A throw from the mesh one would
    // report a mesh outage as "could not list the hosts" and blank the table.
    mockApi({ meshFail: true });
    render(<NetworkingTab />);

    await screen.findByText('b614f41828c8');
    expect(screen.queryByText(/Could not list the hosts/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Tailscale state unavailable/i)).toBeInTheDocument();
    expect(screen.getAllByText(/no agent data/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/100\.\d+\.\d+\.\d+/);
    expect(document.body.textContent).not.toContain('headscale.aw.tekflox.com');
  });

  it('says the path was never measured rather than guessing one', async () => {
    mockApi({
      mesh: {
        control_plane_url: 'https://headscale.aw.tekflox.com',
        nodes: {
          '11e8bd4157845a24': {
            reported: true, up: true, mesh_ip: '100.64.0.1',
            node_name: 'aw-baremetal', path: null, via: null,
          },
        },
      },
    });
    render(<NetworkingTab />);
    const row = (await screen.findByText('b614f41828c8')).closest('div.py-3');

    expect(row.textContent).toMatch(/path unmeasured/i);
    expect(row.textContent).not.toMatch(/\bdirect\b|\brelay\b/);
  });

  it('keeps every bootstrap button disabled — the real one is another card', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('b614f41828c8');

    const buttons = screen.getAllByRole('button', { name: /join mesh/i });
    expect(buttons.length).toBe(4);
    buttons.forEach((b) => expect(b).toBeDisabled());
  });

  it('surfaces a failed host list instead of rendering an empty one', async () => {
    mockApi({ hostsFail: true });
    render(<NetworkingTab />);

    await screen.findByText(/Could not list the hosts/i);
    expect(screen.getByText(/Not Found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows the offline links when the group is expanded', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('b614f41828c8');

    fireEvent.click(screen.getByRole('button', { name: /offline links \(2\)/i }));
    await waitFor(() => expect(screen.getAllByText('DESKTOP-DRMKFBT')).toHaveLength(4));
  });
});

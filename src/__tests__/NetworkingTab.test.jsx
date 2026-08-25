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

function mockApi({ hosts = HOSTS, hostsFail = false } = {}) {
  apiFetch.mockImplementation((url) => {
    if (url === '/api/identity/me') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }) });
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

  it('reports the tailscale state as unknown, never as disconnected', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('b614f41828c8');

    expect(screen.getByText(/Tailscale state unavailable/i)).toBeInTheDocument();
    expect(screen.getAllByText(/no agent data/i).length).toBeGreaterThan(0);
    // No invented mesh IP anywhere on the screen.
    expect(document.body.textContent).not.toMatch(/100\.\d+\.\d+\.\d+/);
  });

  it('never hardcodes a control plane URL while none is published', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('b614f41828c8');

    expect(document.body.textContent).not.toContain('headscale.aw.tekflox.com');
    expect(screen.getAllByText(/<tenant-control-plane>/).length).toBeGreaterThan(0);
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

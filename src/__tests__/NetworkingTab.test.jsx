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
      // The agent's own verdict, as `aw-remote-host vpn` prints it on this
      // host: root with /dev/net/tun, but nothing to keep tailscaled alive.
      eligibility: {
        can_enroll: false,
        enroll_refusal: '/run/systemd/system does not exist, so systemd is not managing '
          + 'this host and this module has no other way to keep tailscaled running '
          + 'across reboots.',
        can_advertise_exit: false,
        exit_refusal: 'this host cannot join the mesh at all: /run/systemd/system does not exist.',
        installer: '',
      },
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
const PUBLIC_IP_PATH = /\/public-ip$/;
const EXIT_GATE_PATH = /\/exit-gate$/;
const EXIT_OFFER_PATH = /\/exit-offer$/;

function mockApi({
  hosts = HOSTS, hostsFail = false, mesh = MESH, meshFail = false,
  publicIp = { ip: '188.250.165.236', via: 'https://api.ipify.org', host_id: '11e8bd4157845a24', host_name: 'b614f41828c8' },
  exitGate = null, exitOffer = null,
} = {}) {
  apiFetch.mockImplementation((url, options) => {
    if (url === '/api/identity/me') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }) });
    }
    if (MESH_PATH.test(url)) {
      if (meshFail) {
        return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: 'Bad Gateway' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mesh) });
    }
    if (PUBLIC_IP_PATH.test(url)) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(publicIp) });
    }
    if (EXIT_OFFER_PATH.test(url)) {
      const reply = typeof exitOffer === 'function' ? exitOffer(options) : exitOffer;
      if (reply instanceof Error) {
        return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: reply.message }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply || {}) });
    }
    if (EXIT_GATE_PATH.test(url)) {
      const reply = typeof exitGate === 'function' ? exitGate(options) : exitGate;
      if (reply instanceof Error) {
        return Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: reply.message }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply || {}) });
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

  // The three branches the agent's verdict introduces. The third is the one
  // that must not move: a host that never reported is NOT a host that
  // reported "no".
  it("prefers the agent's refusal, with the agent's own sentence", () => {
    const verdict = bootstrapEligibility({ os: 'linux' }, {
      eligibility: {
        canEnroll: false,
        enrollRefusal: '/run/systemd/system does not exist, so systemd is not managing '
          + 'this host and this module has no other way to keep tailscaled running '
          + 'across reboots.',
        canAdvertiseExit: false,
      },
    });

    expect(verdict.state).toBe('no');
    // Verbatim — the sentence names what to fix; a generic "not eligible"
    // does not, which is the whole reason it is carried across three repos.
    expect(verdict.reason).toMatch(/\/run\/systemd\/system does not exist/);
    expect(verdict.reason).not.toMatch(/no agent data/i);
  });

  it("says 'yes' only when the agent said so", () => {
    const verdict = bootstrapEligibility({ os: 'linux' }, {
      eligibility: { canEnroll: true, enrollRefusal: '', installer: 'tailscale.com/install.sh' },
    });

    expect(verdict.state).toBe('yes');
    expect(verdict.reason).toMatch(/tailscale\.com\/install\.sh/);
  });

  it('leaves a host that reported no verdict exactly as it was', () => {
    // Every shape of "no verdict here": no node at all, a node that reported
    // nothing, and a node on the mesh whose agent predates the field. All
    // three are the honest-unknown, none of them is a refusal.
    for (const node of [
      undefined,
      null,
      { reported: false, reason: 'the host did not answer within 25s' },
      { reported: true, up: true, meshIp: '100.64.0.1', eligibility: null },
    ]) {
      const verdict = bootstrapEligibility({ os: 'linux' }, node);
      expect(verdict.state).toBe('unknown');
      expect(verdict.label).toBe('Eligibility unconfirmed');
      expect(verdict.reason).toMatch(/no agent data/i);
    }
  });

  it('does not let a non-Linux host be refused for the wrong reason when it reported', () => {
    // The OS rules below are a fallback for hosts that never answered. An
    // agent that measured the machine outranks them — including a macOS one
    // that says it CAN enrol, which the os === 'darwin' rule would deny.
    const mac = bootstrapEligibility({ os: 'darwin' }, {
      eligibility: { canEnroll: true, enrollRefusal: '', installer: 'brew install tailscale' },
    });

    expect(mac.state).toBe('yes');
    expect(mac.reason).toMatch(/brew install tailscale/);
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

  it("renders the agent's verdict on the row, and leaves a silent host unconfirmed", async () => {
    // Both halves in one assertion pair, because the bug was the two being
    // confused: the host that ANSWERED reads as a refusal with its own
    // sentence, the host that never answered still reads as unknown.
    mockApi();
    render(<NetworkingTab />);
    const awRow = (await screen.findByText('b614f41828c8')).closest('div.py-3');

    expect(awRow.textContent).toMatch(/Not eligible/);
    expect(awRow.textContent).toMatch(/\/run\/systemd\/system does not exist/);
    expect(awRow.textContent).not.toMatch(/Eligibility unconfirmed/);

    // An offline Linux link — in the mesh-status response, but with nothing
    // to say. Still 'unconfirmed', and no sentence borrowed from the host
    // above that DID answer.
    fireEvent.click(screen.getByRole('button', { name: /offline links \(2\)/i }));
    const silentRow = screen.getAllByText('DESKTOP-DRMKFBT').at(-1).closest('div.py-3');

    expect(silentRow.textContent).toMatch(/Eligibility unconfirmed/);
    expect(silentRow.textContent).toMatch(/no agent data/i);
    expect(silentRow.textContent).not.toMatch(/\/run\/systemd\/system does not exist/);
    expect(silentRow.textContent).not.toMatch(/Not eligible/);
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

// ─────────────────────────────────────────────────────────────────────────────
// The public IP at the top, and the exit-gate picker under each host.
//
// These two are one feature: the address is the only honest evidence that
// picking a gate did anything. So the tests that matter are the ones about
// what happens when the truth is NOT known — a screen that guesses here is
// worse than one that shows nothing, because somebody flips a route and reads
// this to find out whether it worked.
// ─────────────────────────────────────────────────────────────────────────────
describe('public IP', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  it('shows the address AND says whose machine it is', async () => {
    mockApi();
    render(<NetworkingTab />);
    expect(await screen.findByText('188.250.165.236')).toBeInTheDocument();
    // A number with no owner is worse than no number. The host that measured
    // it is on screen, not only in the payload.
    expect(screen.getByText(/measured on b614f41828c8/)).toBeInTheDocument();
  });

  it('says it does not know rather than showing a stale address', async () => {
    mockApi({ publicIp: { ip: null, error: 'this host is not connected, so it could not be asked' } });
    render(<NetworkingTab />);
    expect(await screen.findByText('not known')).toBeInTheDocument();
    expect(screen.getByText(/not connected, so it could not be asked/)).toBeInTheDocument();
    expect(screen.queryByText('188.250.165.236')).not.toBeInTheDocument();
  });

  it('blanks the old address while re-measuring, instead of leaving it up', async () => {
    // THE failure this guards: the instant after a route change is the one
    // moment anybody is looking, and the old IP still on screen would read as
    // "nothing happened" — or worse, a new IP arriving later would look like
    // it had been there all along.
    let resolveSecond;
    mockApi();
    render(<NetworkingTab />);
    expect(await screen.findByText('188.250.165.236')).toBeInTheDocument();

    apiFetch.mockImplementation((url) => {
      if (PUBLIC_IP_PATH.test(url)) {
        return new Promise((r) => { resolveSecond = () => r({ ok: true, json: () => Promise.resolve({ ip: '65.109.66.88' }) }); });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    fireEvent.click(screen.getByRole('button', { name: /re-measure/i }));
    await waitFor(() => {
      expect(screen.queryByText('188.250.165.236')).not.toBeInTheDocument();
    });
    resolveSecond();
    expect(await screen.findByText('65.109.66.88')).toBeInTheDocument();
  });
});

describe('exit gate picker', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  const gateSelect = () => screen.getAllByLabelText(/^Exit gate for /)[0];

  it('only ever offers a node whose exit route headscale has APPROVED', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    // aw-baremetal is offers_exit:true; aw-surface-wsl is offers_exit:false
    // (it advertises, but no admin approved the route). Offering the second
    // would move a default route onto a gate that cannot forward.
    const options = Array.from(gateSelect().querySelectorAll('option')).map((o) => o.textContent);
    expect(options.join(' ')).toMatch(/aw-baremetal/);
    expect(options.join(' ')).not.toMatch(/aw-surface-wsl/);
  });

  it('never offers a host itself as its own exit', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText(/measured on b614f41828c8/);

    // aw-baremetal is the ONLY approved gate in this fixture, so its own row
    // has nothing to offer — a host cannot route through itself. It says so
    // instead of rendering an empty dropdown.
    expect(screen.queryByLabelText('Exit gate for b614f41828c8')).not.toBeInTheDocument();
    expect(screen.getAllByText(/no exit gate available/i).length).toBeGreaterThan(0);
  });

  it('requires a confirmation that names the route change and the exclusions', async () => {
    // Changing a default route can island a machine. The dead-man's switch
    // covers the machine; this covers the user, who has to know what the
    // button does BEFORE pressing it.
    mockApi({
      exitGate: (options) => {
        const body = JSON.parse(options.body);
        if (body.plan) {
          return {
            plan: true, gate: 'aw-baremetal', gate_ip: '100.64.0.1',
            exclusions: [{ prefix: '65.109.66.88/32', reason: 'the control plane / /link tunnel endpoint' }],
          };
        }
        return { applied: true, confirmed: true, gate: 'aw-baremetal', egress_before: '188.250.165.236', egress_after: '65.109.66.88' };
      },
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    const sel = screen.getByLabelText('Exit gate for DESKTOP-DRMKFBT');
    fireEvent.change(sel, { target: { value: 'aw-baremetal' } });
    fireEvent.click(screen.getAllByRole('button', { name: /review change/i })[0]);

    expect(await screen.findByText(/DEFAULT ROUTE/)).toBeInTheDocument();
    expect(screen.getByText('65.109.66.88/32')).toBeInTheDocument();
    // Nothing has been applied yet — an Apply button is still waiting.
    expect(screen.getByRole('button', { name: /apply aw-baremetal/i })).toBeInTheDocument();
  });

  it('shows the before and the after once applied — the point of the feature', async () => {
    mockApi({
      exitGate: (options) => (JSON.parse(options.body).plan
        ? { plan: true, gate: 'aw-baremetal', exclusions: [] }
        : { applied: true, confirmed: true, gate: 'aw-baremetal', egress_before: '188.250.165.236', egress_after: '65.109.66.88' }),
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.change(screen.getByLabelText('Exit gate for DESKTOP-DRMKFBT'), { target: { value: 'aw-baremetal' } });
    fireEvent.click(screen.getAllByRole('button', { name: /review change/i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /apply aw-baremetal/i }));

    expect(await screen.findByText(/exit gate in force/i)).toBeInTheDocument();
    expect(screen.getByText('before')).toBeInTheDocument();
    expect(screen.getByText('→ after')).toBeInTheDocument();
  });

  it('renders an unconfirmed-and-reverted gate as its own state, not as an error', async () => {
    // The host reverted itself and is perfectly fine. Showing this as a
    // failure of the request would send the reader looking for a broken host
    // instead of a gate that does not forward.
    mockApi({
      exitGate: (options) => (JSON.parse(options.body).plan
        ? { plan: true, gate: 'aw-baremetal', exclusions: [] }
        : {
          applied: false, confirmed: false, reverted: true, gate: 'aw-baremetal',
          egress_before: '188.250.165.236', egress_after: '188.250.165.236',
          reason: 'egress is still 188.250.165.236, the same address as before the switch',
        }),
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.change(screen.getByLabelText('Exit gate for DESKTOP-DRMKFBT'), { target: { value: 'aw-baremetal' } });
    fireEvent.click(screen.getAllByRole('button', { name: /review change/i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /apply aw-baremetal/i }));

    expect(await screen.findByText(/not confirmed — reverted/i)).toBeInTheDocument();
    expect(screen.getByText(/same address as before the switch/)).toBeInTheDocument();
  });

  it('says why there is no picker rather than rendering nothing', async () => {
    // A silent absence reads as a screen that failed to render, and the fix —
    // approve the route in headscale — lives somewhere nobody would look.
    const noGates = {
      ...MESH,
      nodes: { ...MESH.nodes, '11e8bd4157845a24': { ...MESH.nodes['11e8bd4157845a24'], offers_exit: false } },
    };
    mockApi({ mesh: noGates });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.getAllByText(/no exit gate available/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/approved in\s+headscale/i).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Offering a host AS a gate, and being told what choosing one costs.
//
// The measured state on 2026-08-26 is the fixture these run against: exactly
// one node on the mesh had an approved route, so the picker listed exactly one
// gate and was right to. Nothing was broken — the capability to CREATE a
// second gate had never been built.
// ─────────────────────────────────────────────────────────────────────────────

// The Surface's WSL2 link as its agent reports it once it knows about gates:
// it CAN forward, and choosing it costs something.
const WSL_WARNING = 'this is a WSL2 distro. It can forward, but its network is NATed again by '
  + 'the Windows host it runs inside, so every byte leaves through that host and this node '
  + 'cannot hole-punch.';

const SURFACE_ELIGIBLE = {
  can_enroll: true,
  enroll_refusal: '',
  can_advertise_exit: true,
  exit_refusal: '',
  exit_warning: WSL_WARNING,
  installer: 'upstream-script',
};

function meshWithSurface(over = {}) {
  return {
    ...MESH,
    nodes: {
      ...MESH.nodes,
      caf475b7032ee441: {
        ...MESH.nodes.caf475b7032ee441,
        eligibility: SURFACE_ELIGIBLE,
        ...over,
      },
    },
  };
}

describe('offering a host as an exit gate', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  it('never offers a host on one click when its agent attached a warning', async () => {
    // The whole point: a WSL2 gate works and is a bad idea, and the user has
    // to have READ that before anything is advertised. A single-click offer
    // would put a relayed gate on the mesh with nobody told.
    const calls = [];
    mockApi({ mesh: meshWithSurface(), exitOffer: (o) => { calls.push(o); return { offering: true }; } });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.click(screen.getByRole('button', { name: /offer as exit gate…/i }));

    expect(calls).toHaveLength(0);
    expect(await screen.findByText(WSL_WARNING)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /offer anyway/i })).toBeInTheDocument();
  });

  it('offers once the warning has been accepted, and says it is offering', async () => {
    const calls = [];
    mockApi({
      mesh: meshWithSurface(),
      exitOffer: (o) => { calls.push(JSON.parse(o.body)); return { offering: true, node_name: 'aw-surface-wsl' }; },
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.click(screen.getByRole('button', { name: /offer as exit gate…/i }));
    fireEvent.click(await screen.findByRole('button', { name: /offer anyway/i }));

    expect(await screen.findByText(/now offering as an exit gate/i)).toBeInTheDocument();
    expect(calls).toEqual([{ acknowledge_warning: true }]);
  });

  it('names the half-done state instead of calling it "not a gate"', async () => {
    // Advertising with nothing approved looks armed and forwards nothing.
    // Rendering it the same as "never advertised" hides the one state where
    // the fix is on the control plane rather than on the machine.
    mockApi({ mesh: meshWithSurface({ advertises_exit: true, offers_exit: false }) });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(await screen.findByText(/advertising, not approved/i)).toBeInTheDocument();
    expect(screen.getByText(/looks armed and forwards nothing/i)).toBeInTheDocument();
  });

  it('offers a withdrawal, not another offer, for a host that is already a gate', async () => {
    mockApi({ mesh: meshWithSurface({ offers_exit: true }) });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.getAllByRole('button', { name: /stop offering/i }).length).toBeGreaterThan(0);
  });

  it('refuses with the agent’s own sentence, never a bare greyed control', async () => {
    // Windows link c76c606b… is the real case: same physical machine as the
    // WSL2 one, no tailscale at all. A legitimate "no" with a real reason.
    const refusal = 'This is the Windows side of the host. aw-remote-host runs the workspace '
      + 'inside its WSL2 distro, and that distro enrols in the mesh as an ordinary Linux node.';
    const mesh = {
      ...MESH,
      nodes: {
        ...MESH.nodes,
        c76c606b0a2a5a8b: {
          reported: true, up: true, mesh_ip: '100.64.0.9', node_name: 'aw-surface-win',
          offers_exit: false, advertises_exit: false,
          eligibility: {
            can_enroll: false, enroll_refusal: refusal,
            can_advertise_exit: false, exit_refusal: refusal, exit_warning: '',
          },
        },
      },
    };
    mockApi({ mesh });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(await screen.findByText(/cannot be an exit gate/i)).toBeInTheDocument();
    expect(screen.getAllByText(refusal).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^offer as exit gate$/i })).toBeNull();
  });

  it('warns, before the user confirms, what routing through a relayed gate means', async () => {
    // The Surface relays through DERP(mad) even from the same home network.
    // Selecting it sends ALL of the workspace's traffic through a public
    // relay in Madrid — a real performance and privacy consequence that the
    // dead-man's switch cannot catch, because traffic does flow.
    const mesh = meshWithSurface({ offers_exit: true });
    mockApi({
      mesh,
      exitGate: (options) => (JSON.parse(options.body).plan
        ? { plan: true, gate: 'aw-surface-wsl', exclusions: [] }
        : { applied: true, gate: 'aw-surface-wsl' }),
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.change(screen.getByLabelText('Exit gate for b614f41828c8'), { target: { value: 'aw-surface-wsl' } });
    fireEvent.click(screen.getAllByRole('button', { name: /review change/i })[0]);

    expect(await screen.findByText(/this gate works, and it costs you something/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp('measured path to this gate is a relay \\(DERP\\(mad\\)\\)'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(WSL_WARNING.slice(0, 40)))).toBeInTheDocument();
  });

  it('lets a NON-workspace host be pointed at a gate, not just the workspace’s own', async () => {
    // Gap 2 on the card. The per-host route has existed since aw-backend
    // 4313ca6; what was missing was a second gate to point anything at. This
    // pins the behaviour so a future refactor cannot quietly narrow it back
    // to "the workspace's own host only".
    const mesh = meshWithSurface({ offers_exit: true });
    const posted = [];
    mockApi({
      mesh,
      exitGate: (options) => {
        posted.push(JSON.parse(options.body));
        return JSON.parse(options.body).plan
          ? { plan: true, gate: 'aw-surface-wsl', exclusions: [] }
          : { applied: true, gate: 'aw-surface-wsl' };
      },
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    // The Mac's row is the honest-unknown one; the bare-metal row is a host
    // that is NOT this workspace's own and still gets a working picker.
    const picker = screen.getByLabelText('Exit gate for b614f41828c8');
    fireEvent.change(picker, { target: { value: 'aw-surface-wsl' } });
    fireEvent.click(screen.getAllByRole('button', { name: /review change/i })[0]);

    await screen.findByRole('button', { name: /apply aw-surface-wsl/i });
    const url = apiFetch.mock.calls.map((c) => c[0]).find((u) => /exit-gate$/.test(u));
    expect(url).toMatch(/remote-hosts\/11e8bd4157845a24\/exit-gate$/);
    expect(posted[0]).toEqual({ node: 'aw-surface-wsl', plan: true });
  });
});

describe('a host that cannot be pointed at a gate says so', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  // The live case, measured 2026-08-26: b614f41828c8 (link 11e8bd41…) is the
  // aw workspace's own container — no tailscale, no systemd, no `ip`. It can
  // never select a gate however many the mesh has, and a picker there would
  // 409 after the click instead of explaining itself.
  it('renders the refusal instead of a picker that would fail', async () => {
    const refusal = 'tailscale is not installed on this host, so there is no mesh to route '
      + 'through — enrol it first.';
    const mesh = {
      ...MESH,
      nodes: {
        ...MESH.nodes,
        '11e8bd4157845a24': {
          ...MESH.nodes['11e8bd4157845a24'],
          eligibility: {
            ...MESH.nodes['11e8bd4157845a24'].eligibility,
            can_select_exit: false,
            select_exit_refusal: refusal,
          },
        },
      },
    };
    mockApi({ mesh });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(await screen.findByText(/cannot use an exit gate/i)).toBeInTheDocument();
    expect(screen.getByText(refusal)).toBeInTheDocument();
    expect(screen.queryByLabelText('Exit gate for b614f41828c8')).toBeNull();
  });

  // `null` is not `false`. An agent too old for the verdict said nothing, and
  // hiding the picker on that basis would remove a working control from every
  // host that has not been updated yet. The Surface's WSL2 link is the row
  // that legitimately gets one — aw-baremetal is a candidate for it.
  it('still offers the picker when no verdict was reported', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.getByLabelText('Exit gate for DESKTOP-DRMKFBT')).toBeInTheDocument();
    expect(screen.queryByText(/cannot use an exit gate/i)).toBeNull();
  });
});

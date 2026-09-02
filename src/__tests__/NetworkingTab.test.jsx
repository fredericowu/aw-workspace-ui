import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../auth';
import NetworkingTab from '../components/NetworkingTab';
import { bootstrapEligibility } from '../lib/networkingApi';

// The aw-remote-host release whose exit gate routes the CONTAINER networks
// rather than the machine. A host below it is refused by the screen and by the
// API — see `exitGateSelectRefusal` — so the fixtures below have to carry a
// version, and which version they carry is the whole difference between "may
// be offered a gate" and "must not be".
const CONTAINER_SCOPED = 'v0.1.58';
const HOST_SCOPED = 'v0.1.54';

// Real payload, captured 2026-08-25 from
// `aw-workspace-cli remote-hosts hosts` — same route the tab calls. Trimmed to
// the rows that carry the cases this screen has to get right: two ineligible
// OSes, a Linux host, and the duplicate hostname/offline links. `cli_version`
// joined the route on 2026-08-26 for the refusal above.
const HOSTS = [
  { id: '11e8bd4157845a24', workspace_slug: 'aw', hostname: 'b614f41828c8', os: 'linux', arch: 'amd64', cli_version: CONTAINER_SCOPED, last_seen_at: 1787646690.5, connected: true },
  { id: 'c76c606b0a2a5a8b', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'windows', arch: 'amd64', cli_version: CONTAINER_SCOPED, last_seen_at: 1787646684.5, connected: true },
  { id: 'caf475b7032ee441', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'linux', arch: 'amd64', cli_version: CONTAINER_SCOPED, last_seen_at: 1787646678.5, connected: true },
  { id: '824decc7e0610089', workspace_slug: 'fredericowu', hostname: 'Mac.Home', os: 'darwin', arch: 'arm64', cli_version: CONTAINER_SCOPED, last_seen_at: 1787646670.5, connected: true },
  { id: '6bb0d0fbf5b22492', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'linux', arch: 'amd64', cli_version: CONTAINER_SCOPED, last_seen_at: 1787000000.0, connected: false },
  { id: '8435edb900436230', workspace_slug: 'surface', hostname: 'DESKTOP-DRMKFBT', os: 'linux', arch: 'amd64', cli_version: CONTAINER_SCOPED, last_seen_at: 1787000000.0, connected: false },
];

/** The same host list with `cli_version` overridden on every row — the
 *  "nobody has updated their agent yet" fleet. */
const hostsOnVersion = (version) => HOSTS.map((h) => ({ ...h, cli_version: version }));

/** A refusal renders as a badge, and its paragraph only after a click (see
 *  `Disclosure`). Tests that assert on the WORDS have to ask for them the
 *  way a reader does — which is itself the property being protected. */
const revealEveryRefusal = () => {
  screen.getAllByRole('button', { name: /^why\?$/ }).forEach((b) => fireEvent.click(b));
};

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
const EXTERNAL_ROUTE_PATH = /\/external-route$/;
const EXIT_OFFER_PATH = /\/exit-offer$/;
const JOIN_KEY_PATH = /\/mesh-join-key$/;
const MESH_JOIN_PATH = /\/mesh-join$/;

function mockApi({
  hosts = HOSTS, hostsFail = false, mesh = MESH, meshFail = false,
  publicIp = { ip: '188.250.165.236', via: 'https://api.ipify.org', host_id: '11e8bd4157845a24', host_name: 'b614f41828c8' },
  exitGate = null, exitOffer = null, joinKey = null, meshJoin = null,
  externalRoute = null,
} = {}) {
  apiFetch.mockImplementation((url, options) => {
    if (url === '/api/identity/me') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ memberships: [{ workspace: 'aw', role: 'owner' }] }) });
    }
    // Both of these live under /api/workspaces/, so they have to be matched
    // before the host-list catch-all below — which would otherwise answer a
    // mint with a list of hosts and the assertion would pass on nonsense.
    if (JOIN_KEY_PATH.test(url)) {
      const reply = typeof joinKey === 'function' ? joinKey(options) : joinKey;
      if (reply instanceof Error) {
        return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: reply.message }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply || {}) });
    }
    if (MESH_JOIN_PATH.test(url)) {
      const reply = typeof meshJoin === 'function' ? meshJoin(options) : meshJoin;
      if (reply instanceof Error) {
        return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: reply.message }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply || {}) });
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
    if (EXTERNAL_ROUTE_PATH.test(url)) {
      const reply = typeof externalRoute === 'function' ? externalRoute(options) : externalRoute;
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

// ─────────────────────────────────────────────────────────────────────────────
// The scope refusal — the screen's half of it, now that it is NARROW.
//
// It used to be blanket, and rightly: `use-exit` moved the whole MACHINE's
// default route. v0.1.58 inverted that, so the safe path is offered — and what
// is still refused is a host that would move its own route anyway: an agent
// too old to have the container-scoped code, and macOS, which has no scope
// narrower than the machine at all.
//
// The binding refusals are aw-backend's 409 and the host's own; this is about
// the screen not offering a button that would be refused.
// ─────────────────────────────────────────────────────────────────────────────
describe('selecting a gate is refused for a host that would move its own route', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  it('offers no picker to an agent older than the container-scoped release', async () => {
    // The one the control plane must refuse ON THE HOST'S BEHALF: an old
    // binary still carries the host-scoped code and cannot refuse for itself,
    // because that refusal only arrives with the update.
    mockApi({ hosts: hostsOnVersion(HOST_SCOPED) });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.queryByLabelText(/^Exit gate for /)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review change/i })).not.toBeInTheDocument();
    // The badge names the refusal AND the version to update to, without
    // costing a click — a refusal that names neither leaves the reader with
    // nothing to do about it.
    expect(screen.getAllByText(/needs agent v0\.1\.58/i).length).toBeGreaterThan(0);
    // The paragraph is the same one it always was, on request.
    expect(screen.queryByText(/reports v0\.1\.54/)).toBeNull();
    revealEveryRefusal();
    expect(screen.getAllByText(/reports v0\.1\.54/).length).toBeGreaterThan(0);
  });

  it('treats a host that reported no version as too old, not as fine', async () => {
    // A version nobody can compare proves nothing about what is in the binary,
    // and the destructive code is what an unknown one is assumed to carry.
    mockApi({ hosts: hostsOnVersion(null) });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.queryByLabelText(/^Exit gate for /)).not.toBeInTheDocument();
    revealEveryRefusal();
    expect(screen.getAllByText(/has not reported a version/).length).toBeGreaterThan(0);
  });

  // THE COMPLAINT THIS ANSWERS, stated as a count. With every host refused,
  // the tab rendered as three paragraphs per row and the controls disappeared
  // into them. A refused row now says one short thing; the paragraph is a
  // click away and word for word what it always was.
  it('says a refusal in a badge, and keeps the paragraph behind a click', async () => {
    mockApi({ hosts: hostsOnVersion(HOST_SCOPED) });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    // Not a sentence of it, anywhere, until asked.
    expect(screen.queryByText(/still carries the host-scoped code/)).toBeNull();
    expect(screen.queryByText(/Clearing a gate is never refused/)).toBeNull();

    const why = screen.getAllByRole('button', { name: /^why\?$/ });
    expect(why.length).toBeGreaterThan(0);
    expect(why[0]).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(why[0]);
    expect(why[0]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText(/still carries the host-scoped code/).length).toBe(1);

    // And it folds back — a reader who opened one row is not stuck with it.
    fireEvent.click(why[0]);
    expect(screen.queryByText(/still carries the host-scoped code/)).toBeNull();
  });

  it('never sends the request for a refused host', async () => {
    mockApi({ hosts: hostsOnVersion(HOST_SCOPED) });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(apiFetch.mock.calls.some(([url]) => EXIT_GATE_PATH.test(url))).toBe(false);
  });

  it('refuses macOS for architecture, and names the thing that would work', async () => {
    // Not "not supported yet": a Mac's containers sit behind a VM that NATs
    // them to its own address, and macOS has no source-prefix policy routing
    // to key a rule with. The alternative has to be named, or the refusal is a
    // dead end. The Mac has to be UP on the mesh for the control to render at
    // all — an unreported host is an honest unknown, not a refusal — so this
    // is the Mac the fixture leaves silent, brought online.
    const macOnMesh = {
      ...MESH,
      nodes: {
        ...MESH.nodes,
        '824decc7e0610089': {
          reported: true, up: true, mesh_ip: '100.64.0.3', node_name: 'mac-home',
          path: 'direct', exit_node: null, offers_exit: false,
        },
      },
    };
    mockApi({ mesh: macOnMesh });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    // The badge says which refusal this is — a Mac is not a stale agent, and
    // the two must not read alike. The alternative that WOULD work is in the
    // paragraph, which is where a dead end would otherwise be.
    expect(await screen.findByText(/macOS cannot select/i)).toBeInTheDocument();
    revealEveryRefusal();
    expect(screen.getByText(/run aw-remote-host INSIDE the VM/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Exit gate for Mac.Home')).not.toBeInTheDocument();
  });

  // THE ONE ACTION THAT SURVIVES. A host that took a selection before this
  // landed is stuck on it, and this screen is where anyone would go to undo
  // that. Removing the whole control would strand exactly those machines.
  it('still lets a refused host already on a gate be cleared', async () => {
    const onGate = {
      ...MESH,
      nodes: {
        ...MESH.nodes,
        caf475b7032ee441: { ...MESH.nodes.caf475b7032ee441, exit_node: 'aw-baremetal' },
      },
    };
    mockApi({
      hosts: hostsOnVersion(HOST_SCOPED),
      mesh: onGate,
      exitGate: { cleared: true, egress: '188.250.165.236' },
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    const clear = await screen.findByRole('button', { name: /clear \(aw-baremetal\)/i });
    fireEvent.click(clear);

    expect(await screen.findByText(/exit gate cleared/i)).toBeInTheDocument();
    const [url, options] = apiFetch.mock.calls.find(([u]) => EXIT_GATE_PATH.test(u));
    expect(url).toMatch(/caf475b7032ee441/);
    expect(options.method).toBe('DELETE');
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

  it('requires a confirmation that names the containers, the exclusions, and the invariant', async () => {
    // Rewriting routing policy on a live machine can island it. The dead-man's
    // switch covers the machine; this covers the user, who has to know what
    // the button does BEFORE pressing it — including the half that is a
    // promise, that the host's own address will not move.
    mockApi({
      exitGate: (options) => {
        const body = JSON.parse(options.body);
        if (body.plan) {
          return {
            plan: true, gate: 'aw-baremetal', gate_ip: '100.64.0.1', runtime: 'docker',
            container_routes: [{ prefix: '172.17.0.0/16', networks: ['bridge'] }],
            exclusions: [{ prefix: '65.109.66.88/32', reason: 'the control plane / /link tunnel endpoint' }],
          };
        }
        return { applied: true, confirmed: true, gate: 'aw-baremetal' };
      },
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    const sel = screen.getByLabelText('Exit gate for DESKTOP-DRMKFBT');
    fireEvent.change(sel, { target: { value: 'aw-baremetal' } });
    fireEvent.click(screen.getAllByRole('button', { name: /review change/i })[0]);

    expect(await screen.findByText(/moves the CONTAINERS/)).toBeInTheDocument();
    // The invariant, stated before the click rather than discovered after it.
    expect(screen.getByText(/public IP must NOT/)).toBeInTheDocument();
    // WHICH networks, named off the plan the host just computed — not a
    // promise about "your containers".
    expect(screen.getByText('172.17.0.0/16')).toBeInTheDocument();
    expect(screen.getByText('65.109.66.88/32')).toBeInTheDocument();
    // Nothing has been applied yet — an Apply button is still waiting.
    expect(screen.getByRole('button', { name: /apply aw-baremetal/i })).toBeInTheDocument();
  });

  it('shows BOTH pairs once applied — the containers moved and the host did not', async () => {
    // The whole difference between this feature and the bug it replaced. A
    // container pair alone would hide a host that moved too; a host pair alone
    // would prove nothing happened at all.
    mockApi({
      exitGate: (options) => (JSON.parse(options.body).plan
        ? { plan: true, gate: 'aw-baremetal', exclusions: [] }
        : {
          applied: true, confirmed: true, gate: 'aw-baremetal',
          egress_before: '188.250.165.236', egress_after: '188.250.165.236',
          host_held: true, host_moved: false,
          container_egress_before: { ip: '188.250.165.236', network: 'bridge' },
          container_egress_after: { ip: '65.109.66.88', network: 'bridge' },
        }),
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.change(screen.getByLabelText('Exit gate for DESKTOP-DRMKFBT'), { target: { value: 'aw-baremetal' } });
    fireEvent.click(screen.getAllByRole('button', { name: /review change/i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /apply aw-baremetal/i }));

    expect(await screen.findByText(/exit gate in force/i)).toBeInTheDocument();
    expect(screen.getByText('containers')).toBeInTheDocument();
    expect(screen.getByText('host')).toBeInTheDocument();
    expect(screen.getByText('65.109.66.88')).toBeInTheDocument();
    expect(screen.getByText(/host held its own address/i)).toBeInTheDocument();
  });

  it('calls out a host whose OWN address moved as the failure it is', async () => {
    // The one outcome that damages the box. It has to read as a failure even
    // though the container's egress looks perfectly healthy.
    mockApi({
      exitGate: (options) => (JSON.parse(options.body).plan
        ? { plan: true, gate: 'aw-baremetal', exclusions: [] }
        : {
          applied: false, confirmed: false, reverted: true, gate: 'aw-baremetal',
          egress_before: '188.250.165.236', egress_after: '65.109.66.88',
          host_held: false, host_moved: true,
          container_egress_before: { ip: '188.250.165.236' },
          container_egress_after: { ip: '65.109.66.88' },
        }),
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.change(screen.getByLabelText('Exit gate for DESKTOP-DRMKFBT'), { target: { value: 'aw-baremetal' } });
    fireEvent.click(screen.getAllByRole('button', { name: /review change/i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /apply aw-baremetal/i }));

    expect(await screen.findByText(/HOST's own address moved/i)).toBeInTheDocument();
    expect(screen.getByText(/not confirmed — reverted/i)).toBeInTheDocument();
  });

  it('says a host that ADVERTISES a gate cannot select one, before the attempt', async () => {
    // Measured and unfixable on the host side: tailscale refuses to advertise
    // an exit node and select one at the same time. The Surface is in exactly
    // this state. Until now the user found out halfway through a mutation.
    const advertising = {
      ...MESH,
      nodes: {
        ...MESH.nodes,
        caf475b7032ee441: { ...MESH.nodes.caf475b7032ee441, advertises_exit: true },
      },
    };
    mockApi({ mesh: advertising });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    // Beside the picker, with no click at all — the badge, because the picker
    // stays usable and a paragraph beside a usable control is what buried this
    // screen. One click gets the sentence, still word for word.
    expect(await screen.findByText(/advertising a gate/i)).toBeInTheDocument();
    revealEveryRefusal();
    expect(screen.getByText(/tailscale refuses to advertise one and select one/i))
      .toBeInTheDocument();
    expect(apiFetch.mock.calls.some(([url]) => EXIT_GATE_PATH.test(url))).toBe(false);
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
    revealEveryRefusal();
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

  it('keeps saying what a gate costs after it is already offering', async () => {
    // Caught by screenshotting the live screen: the Surface's row read
    // "Offering as exit gate" and nothing else, which invites picking it from
    // the list above without ever meeting the sentence.
    mockApi({ mesh: meshWithSurface({ offers_exit: true }) });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(await screen.findByText(/Costly gate:/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(WSL_WARNING.slice(0, 40)))).toBeInTheDocument();
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
    // Twice on purpose: once on the gate's own row ("Costly gate: …"), once
    // inside the confirmation the selecting host is about to accept.
    expect(screen.getAllByText(new RegExp(WSL_WARNING.slice(0, 40)))).toHaveLength(2);
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
    // The host's OWN words, kept verbatim — the disclosure changed when they
    // are read, not what they say.
    revealEveryRefusal();
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

// ─────────────────────────────────────────────────────────────────────────────
// Getting a machine ONTO the mesh. Two paths, and the difference between them
// is where the credential goes: a linked host is driven over its own link and
// never sees one rendered, while an unlinked machine needs a command with a
// real key in it. What both must never do is show `--authkey=<key>`, which is
// a command that reads as if it works and cannot.
// ─────────────────────────────────────────────────────────────────────────────

// Mac.Home, connected, not on the mesh, and its agent says it CAN join — the
// one row in HOSTS that should get a live Join mesh button.
const MESH_WITH_ENROLLABLE = {
  ...MESH,
  nodes: {
    ...MESH.nodes,
    '824decc7e0610089': {
      reported: true,
      up: false,
      reason: 'the tailscale CLI is not installed on this host',
      eligibility: { can_enroll: true, installer: 'brew install tailscale', can_advertise_exit: false },
    },
  },
};

describe('the join command carries a real key', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  it('mints nothing on load, and shows no <key> placeholder anywhere', async () => {
    mockApi();
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    // A screen that mints a mesh credential because somebody opened the tab
    // hands one out to anybody who opens the tab.
    const minted = apiFetch.mock.calls.filter(([url]) => JOIN_KEY_PATH.test(url));
    expect(minted).toHaveLength(0);
    expect(document.body.textContent).not.toContain('--authkey=<key>');
    expect(document.body.textContent).not.toContain('<name>');
    expect(screen.getByRole('button', { name: /Generate join command/ })).toBeInTheDocument();
  });

  it('builds a command that would actually work when pasted', async () => {
    mockApi({
      joinKey: {
        key: 'hskey-auth-1a2b3c-realkeyvalue',
        expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
        reusable: false,
        control_plane_url: 'https://headscale.aw.tekflox.com',
      },
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.click(screen.getByRole('button', { name: /Generate join command/ }));

    const block = await screen.findByText(/tailscale up --login-server=/);
    expect(block.textContent).toContain('--authkey=hskey-auth-1a2b3c-realkeyvalue');
    expect(block.textContent).toContain('--login-server=https://headscale.aw.tekflox.com');
    // A default that the target machine resolves for itself, not a hole the
    // reader has to know to fill.
    expect(block.textContent).toContain('--hostname=$(hostname -s)');
    expect(block.textContent).not.toContain('<key>');
    expect(block.textContent).not.toContain('<name>');

    // It is a credential, and the screen says so rather than leaving the
    // reader to assume it can be shared.
    expect(screen.getByText(/single use/)).toBeInTheDocument();
    // Pressing again is a REGENERATE, not a second stale copy of the first.
    expect(screen.getByRole('button', { name: /Regenerate join command/ })).toBeInTheDocument();
  });

  it('reports a missing admin credential instead of falling back to <key>', async () => {
    const reason = 'this workspace holds no admin credential for https://headscale.aw.tekflox.com, '
      + 'so it cannot approve an exit route there. Add one under `mesh.control_planes`.';
    mockApi({ joinKey: new Error(reason) });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.click(screen.getByRole('button', { name: /Generate join command/ }));

    expect(await screen.findByText(new RegExp('mesh.control_planes'))).toBeInTheDocument();
    // The bug this whole path replaces must not reappear on the error path.
    expect(document.body.textContent).not.toContain('--authkey=<key>');
    expect(screen.queryByText(/tailscale up --login-server=/)).toBeNull();
  });
});

describe('Join mesh enrols a linked host for real', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  it('is live only where the agent said the host can enrol', async () => {
    mockApi({ mesh: MESH_WITH_ENROLLABLE });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    const buttons = screen.getAllByRole('button', { name: 'Join mesh' });
    const enabled = buttons.filter((b) => !b.disabled);
    expect(enabled).toHaveLength(1);
    // ...and it is Mac.Home's row, the only host whose agent said yes.
    expect(enabled[0].closest('div.py-3').textContent).toContain('Mac.Home');
    // Nothing on the page still says the button is a placeholder.
    expect(document.body.textContent).not.toContain('not built yet');
  });

  it('drives the host over its link, without minting a key in the browser', async () => {
    mockApi({
      mesh: MESH_WITH_ENROLLABLE,
      meshJoin: { enrolled: true, changed: true, node_name: 'aw-mac-2', mesh_ip: '100.64.0.7' },
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    const button = screen.getAllByRole('button', { name: 'Join mesh' }).find((b) => !b.disabled);
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText(/enrolled — aw-mac-2/)).toBeInTheDocument());
    // The whole point of this path: the key stayed inside aw-backend.
    expect(apiFetch.mock.calls.filter(([url]) => JOIN_KEY_PATH.test(url))).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/hskey-/);
  });

  it("renders the host's own refusal when the enrolment is declined", async () => {
    // Not the same sentence 11e8bd41's row already carries: the point of this
    // assertion is that the OUTCOME renders the host's words, and a string
    // that is on the page twice would pass without proving that.
    const refusal = 'this host has no /dev/net/tun, so tailscale cannot open the interface it '
      + 'needs — load the tun module and try again.';
    mockApi({
      mesh: MESH_WITH_ENROLLABLE,
      meshJoin: { enrolled: false, refused: true, refusal },
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.click(screen.getAllByRole('button', { name: 'Join mesh' }).find((b) => !b.disabled));

    await waitFor(() => expect(screen.getByText(/not enrolled/)).toBeInTheDocument());
    expect(screen.getByText(refusal)).toBeInTheDocument();
  });

  it('refuses a host already on the mesh, and says so in a sentence', async () => {
    mockApi({ mesh: MESH_WITH_ENROLLABLE });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    // aw-surface-wsl is up on the mesh — a greyed button there needs a reason
    // as much as an ineligible one does.
    expect(screen.getByText(/already on the mesh as aw-surface-wsl/)).toBeInTheDocument();
  });
});

// ─────────────────────────── External VPNs ───────────────────────────
//
// The OTHER kind of gate: a WireGuard tunnel a host terminates itself, which
// has nothing to do with this tenant's mesh. Two things are being protected
// here and they pull in opposite directions:
//
//   - a host that could not LOOK for tunnels must never render as a host with
//     none. That is the honest-unknown discipline the rest of this screen
//     already keeps, and it is the reason `external_tunnels` is forwarded
//     byte-for-byte from the host all the way to this component.
//   - a host that is NOT on the mesh must still be offerable an external
//     tunnel. Every mesh refusal on this screen is about a mechanism the
//     external route does not use — the machine that owns the tunnel writes
//     the rule — and the host that most needs this is refused by all of them.

/** The workspace as it really is: a CONTAINER with its own link, whose
 *  hostname is the id the machine hosting it knows it by (measured on the
 *  live pair 2026-09-02). No tailscale, no `wg`, no runtime — it can write no
 *  rule for itself, which is the whole reason the acting host is a different
 *  row. */
const WORKSPACE_CONTAINER = {
  id: 'e91aacf5a3a39a17', workspace_slug: 'aw', hostname: 'e91aacf5a3a3',
  os: 'linux', arch: 'amd64', cli_version: 'v0.1.66',
  last_seen_at: 1787646690.5, connected: true,
};

const HOSTS_WITH_CONTAINER = [...HOSTS, WORKSPACE_CONTAINER];

/** Two peers of the production hub's `wg0`, as `wg show all dump` reports
 *  them: the GL.iNet that dials in, and one that is configured and has never
 *  completed a handshake. 0/0 next to "never" is the entire diagnostic for the
 *  second one and must survive to the screen unsmoothed. */
const WG0_TUNNELS = [
  {
    interface: 'wg0', peer_public_key: 'lAY93J69DBD8ZHX7IoYhzfyLocKQMNiuRUluM9a7Hwc=',
    endpoint: '24.90.8.255:51820', allowed_ips: ['10.8.0.2/32'],
    transfer_rx_bytes: 5242880, transfer_tx_bytes: 1048576,
    last_handshake_never: false, last_handshake_age_seconds: 42,
  },
  {
    interface: 'wg0', peer_public_key: 'Kx2n0pQ7yV1sT4uW9bC3dE5fG6hJ8kL0mN1oP2qR3sU=',
    endpoint: '', allowed_ips: ['10.8.0.9/32'],
    transfer_rx_bytes: 0, transfer_tx_bytes: 0,
    last_handshake_never: true, last_handshake_age_seconds: null,
  },
];

/** The bare metal terminates the tunnel; the workspace container cannot even
 *  look for one. Both halves matter: one produces the candidate, the other is
 *  the honest-unknown that must not read as "no external VPN". */
const MESH_WITH_EXTERNAL = {
  ...MESH,
  nodes: {
    ...MESH.nodes,
    '11e8bd4157845a24': {
      ...MESH.nodes['11e8bd4157845a24'],
      external_tunnels: { supported: true, tunnels: WG0_TUNNELS },
    },
    e91aacf5a3a39a17: {
      reported: true, up: false,
      reason: 'the tailscale CLI is not installed on this host',
      external_tunnels: { supported: false, reason: 'the wg CLI is not installed on this host' },
    },
  },
};

describe('External VPNs section', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  it("renders each interface once, with the peers' handshake age and counters", async () => {
    // `wg show all dump` emits one line per (interface, peer): the production
    // hub arrives as nine rows of `wg0` and there is ONE tunnel. Nine rows
    // rendered as nine VPNs would invent eight.
    mockApi({ hosts: HOSTS_WITH_CONTAINER, mesh: MESH_WITH_EXTERNAL });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.getByText('External VPNs')).toBeInTheDocument();
    expect(screen.getAllByText('wg0')).toHaveLength(1);
    expect(screen.getByText('2 peers')).toBeInTheDocument();
    expect(screen.getByText('24.90.8.255:51820')).toBeInTheDocument();
    expect(screen.getByText(/handshake 42s ago/)).toBeInTheDocument();
    expect(screen.getByText(/rx 5\.0 MiB · tx 1\.0 MiB/)).toBeInTheDocument();
  });

  it('says "never" and 0/0 for a peer that has never handshaked', async () => {
    // The pair that says "configured, and nothing has ever come through". An
    // age computed from a zero timestamp would print an age since the epoch,
    // and a counter defaulted to 0 would hide a counter that never arrived.
    mockApi({ hosts: HOSTS_WITH_CONTAINER, mesh: MESH_WITH_EXTERNAL });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.getByText(/handshake never/)).toBeInTheDocument();
    expect(screen.getByText(/rx 0 B · tx 0 B/)).toBeInTheDocument();
  });

  it('keeps "could not look" apart from "there is none", with the host\'s own sentence', async () => {
    // The failure this whole block exists to prevent: a host with no `wg`
    // binary rendered as a host with no external VPN is a claim nobody made.
    mockApi({ hosts: HOSTS_WITH_CONTAINER, mesh: MESH_WITH_EXTERNAL });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.getByText('could not look')).toBeInTheDocument();
    expect(screen.getByText('the wg CLI is not installed on this host')).toBeInTheDocument();
    // Never a verdict about the tunnel itself.
    expect(screen.queryByText(/no external VPN/i)).not.toBeInTheDocument();
  });

  it('reports a host that answered nothing at all as unanswered, not as empty', async () => {
    // The default fixture has no `external_tunnels` anywhere — every agent on
    // it predates the field. That is a third state, and it is not "none".
    mockApi({ hosts: HOSTS_WITH_CONTAINER });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.getAllByText('no answer').length).toBeGreaterThan(0);
    expect(screen.queryByText('none found')).not.toBeInTheDocument();
  });

  it('offers no way to create a tunnel or read a config back', async () => {
    // §3.2/§3.6: the config and its private key stay on the machine that
    // dials. A form here would be a second source of truth and a place for a
    // key to land.
    mockApi({ hosts: HOSTS_WITH_CONTAINER, mesh: MESH_WITH_EXTERNAL });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.queryByRole('button', { name: /add (a )?vpn|new vpn|connect/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/PrivateKey/);
  });
});

describe('external tunnel as an exit gate', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  /** The one host row's gate control, so a click lands on the machine under
   *  test rather than on whichever row rendered first. */
  const gateRow = (hostname) => screen.getByLabelText(`Exit gate for ${hostname}`).closest('div.grid');

  it('offers the tunnel in the SAME picker as the mesh gates', async () => {
    mockApi({ hosts: HOSTS_WITH_CONTAINER, mesh: MESH_WITH_EXTERNAL });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    // The row that can take BOTH kinds — one control, because they answer the
    // same question and two pickers is how a user stops knowing which one is
    // in force. The grouping is what makes them distinguishable inside it.
    const picker = screen.getAllByLabelText(/^Exit gate for /).find((s) => s.querySelector('optgroup'));
    expect(picker).toBeDefined();
    expect(Array.from(picker.querySelectorAll('optgroup')).map((g) => g.label))
      .toEqual(['Mesh exit nodes', 'External VPN tunnels']);
    const options = Array.from(picker.querySelectorAll('option')).map((o) => o.textContent);
    expect(options.join(' ')).toMatch(/aw-baremetal/);
    expect(options.join(' ')).toMatch(/wg0 on b614f41828c8/);
  });

  it('gives a host that is NOT on the mesh a picker it would otherwise never get', async () => {
    // The regression this feature is. Every mesh refusal on this screen is
    // about tailscale; an external route needs none of it, because the
    // machine that terminates the tunnel writes the rule.
    mockApi({ hosts: HOSTS_WITH_CONTAINER, mesh: MESH_WITH_EXTERNAL });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.getByLabelText('Exit gate for e91aacf5a3a3')).toBeInTheDocument();
    // And the mesh refusal is not swallowed by the picker appearing.
    revealEveryRefusal();
    expect(screen.getAllByText('not on the mesh').length).toBeGreaterThan(0);
  });

  it('renders nothing for that host when no host reports a tunnel', async () => {
    // The control appears BECAUSE of the tunnel, not despite it — without one
    // this row is exactly as silent as it was before this feature.
    mockApi({ hosts: HOSTS_WITH_CONTAINER });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    expect(screen.queryByLabelText('Exit gate for e91aacf5a3a3')).toBeNull();
  });

  it('reviews against the machine that owns the tunnel, and names the exact rule', async () => {
    const posted = [];
    mockApi({
      hosts: HOSTS_WITH_CONTAINER,
      mesh: MESH_WITH_EXTERNAL,
      externalRoute: (options) => {
        posted.push(JSON.parse(options.body));
        return {
          planned: true,
          plan: {
            container: 'e91aacf5a3a3', container_id: 'e91aacf5a3a39a17...', source_ip: '172.18.0.4',
            table: 200, priority: 5399, runtime: 'docker', tunnel_via: '10.8.0.2', tunnel_dev: 'wg0',
            exclusions: ['185.12.64.1/32', '185.12.64.2/32'],
            main_gateway: '65.109.66.65', main_dev: 'enp41s0',
          },
        };
      },
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.change(screen.getByLabelText('Exit gate for e91aacf5a3a3'), {
      target: { value: 'external:11e8bd4157845a24:wg0' },
    });
    // Scoped to THIS row: every host with an external candidate now has a
    // Review button, and pressing the first one on the page would review a
    // different machine.
    fireEvent.click(within(gateRow('e91aacf5a3a3')).getByRole('button', { name: /review change/i }));

    expect(await screen.findByText(/moves ONE container/)).toBeInTheDocument();
    // TWO HOSTS IN ONE CALL: the container that moves is in the path, the
    // machine that acts is in the body. Getting that backwards routes the
    // wrong workload.
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ via_host: '11e8bd4157845a24', plan: true });
    const [url] = apiFetch.mock.calls.find(([u]) => EXTERNAL_ROUTE_PATH.test(u));
    expect(url).toMatch(/remote-hosts\/e91aacf5a3a39a17\/external-route$/);
    // The `/32` is the safety property of the whole verb — one address out of
    // the runtime, never a network — so it is in front of the person
    // confirming, not only in a log.
    expect(screen.getByText(/ip rule add from 172\.18\.0\.4\/32 lookup 200 priority 5399/)).toBeInTheDocument();
    expect(screen.getByText('185.12.64.1/32')).toBeInTheDocument();
    // And nothing has happened yet.
    expect(screen.getByRole('button', { name: /apply wg0/i })).toBeInTheDocument();
  });

  it('shows both pairs once applied — the container moved and the machine did not', async () => {
    mockApi({
      hosts: HOSTS_WITH_CONTAINER,
      mesh: MESH_WITH_EXTERNAL,
      externalRoute: (options) => (JSON.parse(options.body).plan
        ? { planned: true, plan: { container: 'e91aacf5a3a3', source_ip: '172.18.0.4', table: 200, priority: 5399, tunnel_dev: 'wg0', exclusions: [] } }
        : {
          container: 'e91aacf5a3a3', source_ip: '172.18.0.4', table: 200, priority: 5399,
          tunnel_dev: 'wg0', exclusions: [],
          host_before: '65.109.66.88', host_after: '65.109.66.88', host_held: true, host_moved: false,
          container_before: '65.109.66.88', container_after: '24.90.8.255',
          confirmed: true, reverted: false,
        }),
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.change(screen.getByLabelText('Exit gate for e91aacf5a3a3'), {
      target: { value: 'external:11e8bd4157845a24:wg0' },
    });
    // Scoped to THIS row: every host with an external candidate now has a
    // Review button, and pressing the first one on the page would review a
    // different machine.
    fireEvent.click(within(gateRow('e91aacf5a3a3')).getByRole('button', { name: /review change/i }));
    fireEvent.click(await screen.findByRole('button', { name: /apply wg0/i }));

    expect(await screen.findByText(/exit gate in force — wg0/i)).toBeInTheDocument();
    // The measured acceptance criterion of the whole card, on the screen.
    expect(screen.getByText('24.90.8.255')).toBeInTheDocument();
    expect(screen.getByText(/host held its own address/i)).toBeInTheDocument();
  });

  it('sends the acting host on the undo too — only that machine can remove the rule', async () => {
    const seen = [];
    mockApi({
      hosts: HOSTS_WITH_CONTAINER,
      mesh: MESH_WITH_EXTERNAL,
      externalRoute: (options) => {
        seen.push({ method: options.method, body: JSON.parse(options.body) });
        return { container: 'e91aacf5a3a3', container_after: '65.109.66.88' };
      },
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.change(screen.getByLabelText('Exit gate for e91aacf5a3a3'), {
      target: { value: 'external:11e8bd4157845a24:wg0' },
    });
    fireEvent.click(screen.getByRole('button', { name: /clear route via b614f41828c8/i }));

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0].method).toBe('DELETE');
    expect(seen[0].body).toEqual({ via_host: '11e8bd4157845a24' });
  });

  it('says what an external route needs before the press, not after it', async () => {
    // This screen cannot resolve a container — only the runtime on the acting
    // machine can — so the requirement is written down and Review is the
    // answer. A control that 409s after the click reads as broken.
    mockApi({ hosts: HOSTS_WITH_CONTAINER, mesh: MESH_WITH_EXTERNAL });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.change(screen.getByLabelText('Exit gate for e91aacf5a3a3'), {
      target: { value: 'external:11e8bd4157845a24:wg0' },
    });
    revealEveryRefusal();
    expect(screen.getByText('routed by another machine')).toBeInTheDocument();
    expect(screen.getByText(/runs as a container on it/)).toBeInTheDocument();
  });

  it("carries the tunnel's own cost into the confirmation", async () => {
    // A tunnel nothing has ever come through is usable-looking and would
    // black-hole the container. Same bargain as a relayed mesh gate: eligible
    // and wise are different questions.
    const deadHub = {
      ...MESH_WITH_EXTERNAL,
      nodes: {
        ...MESH_WITH_EXTERNAL.nodes,
        '11e8bd4157845a24': {
          ...MESH.nodes['11e8bd4157845a24'],
          external_tunnels: { supported: true, tunnels: [WG0_TUNNELS[1]] },
        },
      },
    };
    mockApi({
      hosts: HOSTS_WITH_CONTAINER,
      mesh: deadHub,
      externalRoute: () => ({ planned: true, plan: { container: 'e91aacf5a3a3', tunnel_dev: 'wg0', exclusions: [] } }),
    });
    render(<NetworkingTab />);
    await screen.findByText('188.250.165.236');

    fireEvent.change(screen.getByLabelText('Exit gate for e91aacf5a3a3'), {
      target: { value: 'external:11e8bd4157845a24:wg0' },
    });
    // Scoped to THIS row: every host with an external candidate now has a
    // Review button, and pressing the first one on the page would review a
    // different machine.
    fireEvent.click(within(gateRow('e91aacf5a3a3')).getByRole('button', { name: /review change/i }));

    expect(await screen.findByText(/has EVER completed a handshake/)).toBeInTheDocument();
  });
});

// Topbar VPN icon (VpnNav.jsx) — reads the SAME /api/vpn/status VpnsTab.jsx
// does; there is one VPN subsystem reachable from this SPA, not two (see
// vpnApi.js's header, and the Architect's decision on the Kanban card for
// this fix). These assert the things that were actually broken:
//   1. dns_tunneled / kill_switch / warnings render with VpnsTab's same
//      tri-state discipline — an explicit false renders a line, null
//      renders nothing, never an all-clear.
//   2. state: "unknown" is a third, distinct, calm shield state — never
//      folded into "disconnected".
//   3. Connect/Disconnect dial /api/vpn/connect and /api/vpn/disconnect
//      (never the nonexistent/404-by-contract /api/vpn/start, /stop,
//      /public-ip, /settings/vpn-only, /settings/auto-start), and their
//      three outcomes — refusal, failure, timeout — never collapse into
//      one generic shape.
//   4. the external-IP row and both toggles are gone.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi, beforeEach, describe } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import VpnNav from '../components/VpnNav';

function jsonRes(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

const DISCONNECTED_STATUS = { state: 'disconnected', connected: false, active: null };
const ONE_WIREGUARD_CONFIG = [{ name: 'client_1', type: 'wireguard' }];

function baseImpl({ status = DISCONNECTED_STATUS, configs = ONE_WIREGUARD_CONFIG } = {}) {
  return (url) => {
    if (url === '/api/vpn/status') return jsonRes(status);
    if (url === '/api/vpn/configs') return jsonRes({ configs });
    return jsonRes({});
  };
}

function openPopover(container) {
  fireEvent.mouseEnter(container.firstChild);
}

async function pickConnect() {
  fireEvent.click(await screen.findByRole('button', { name: 'Connect…' }));
  fireEvent.click(await screen.findByText('client_1'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VpnNav — reads the same /api/vpn/status VpnsTab does', () => {
  it('fetches status via a relative path, never a start/stop/public-ip/settings route', async () => {
    apiFetch.mockImplementation(baseImpl());
    render(<VpnNav />);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/vpn/status', expect.anything()));
    const urls = apiFetch.mock.calls.map(([url]) => url);
    ['/api/vpn/start', '/api/vpn/stop', '/api/vpn/public-ip', '/api/vpn/settings/vpn-only', '/api/vpn/settings/auto-start']
      .forEach((forbidden) => expect(urls).not.toContain(forbidden));
  });
});

describe('VpnNav — shield state', () => {
  it('shows Disconnected when nothing is dialed', async () => {
    apiFetch.mockImplementation(baseImpl());
    const { container } = render(<VpnNav />);
    openPopover(container);
    expect(await screen.findByText('Disconnected')).toBeInTheDocument();
  });

  it('shows Connected · <profile> and the egress IP', async () => {
    apiFetch.mockImplementation(baseImpl({
      status: { state: 'connected', connected: true, active: 'client_1', egress_ip: '185.12.64.7' },
    }));
    const { container } = render(<VpnNav />);
    openPopover(container);
    expect(await screen.findByText('Connected · client_1')).toBeInTheDocument();
    expect(screen.getByText('185.12.64.7')).toBeInTheDocument();
  });

  it('renders "unknown" as a third, calm, distinct state — never folded into disconnected', async () => {
    apiFetch.mockImplementation(baseImpl({
      status: { state: 'unknown', connected: false, active: null, detail: 'no AW_BACKEND_URL configured' },
    }));
    const { container } = render(<VpnNav />);
    openPopover(container);
    expect(await screen.findByText('VPN status unknown')).toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
    expect(screen.getByText(/no AW_BACKEND_URL configured/)).toBeInTheDocument();
  });

  it('a malformed/empty status payload also reads as unknown, never smoothed into disconnected', async () => {
    apiFetch.mockImplementation(baseImpl({ status: {} }));
    const { container } = render(<VpnNav />);
    openPopover(container);
    expect(await screen.findByText('VPN status unknown')).toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
  });
});

describe('VpnNav — dns_tunneled / kill_switch / warnings are tri-state, never smoothed over', () => {
  it('dns_tunneled: false renders the limitation', async () => {
    apiFetch.mockImplementation(baseImpl({
      status: { state: 'connected', connected: true, active: 'client_1', dns_tunneled: false },
    }));
    const { container } = render(<VpnNav />);
    openPopover(container);
    expect(await screen.findByText(/DNS is not tunneled/)).toBeInTheDocument();
  });

  it('dns_tunneled: null renders no claim either way', async () => {
    apiFetch.mockImplementation(baseImpl({
      status: { state: 'connected', connected: true, active: 'client_1', dns_tunneled: null },
    }));
    const { container } = render(<VpnNav />);
    openPopover(container);
    await screen.findByText('Connected · client_1');
    expect(screen.queryByText(/DNS.*tunneled/i)).not.toBeInTheDocument();
  });

  it('kill_switch: false renders a caution', async () => {
    apiFetch.mockImplementation(baseImpl({
      status: { state: 'connected', connected: true, active: 'client_1', kill_switch: false },
    }));
    const { container } = render(<VpnNav />);
    openPopover(container);
    expect(await screen.findByText(/kill switch unavailable/)).toBeInTheDocument();
  });

  it('kill_switch: null renders no claim either way', async () => {
    apiFetch.mockImplementation(baseImpl({
      status: { state: 'connected', connected: true, active: 'client_1', kill_switch: null },
    }));
    const { container } = render(<VpnNav />);
    openPopover(container);
    await screen.findByText('Connected · client_1');
    expect(screen.queryByText(/kill switch/)).not.toBeInTheDocument();
  });

  it('renders every warnings[] sentence verbatim, still visible while connected', async () => {
    const w1 = 'DNS is not tunneled: podman 4.3.1 has no network update.';
    apiFetch.mockImplementation(baseImpl({
      status: { state: 'connected', connected: true, active: 'client_1', warnings: [w1] },
    }));
    const { container } = render(<VpnNav />);
    openPopover(container);
    expect(await screen.findByText('Connected · client_1')).toBeInTheDocument();
    expect(screen.getByText(w1)).toBeInTheDocument();
  });
});

describe('VpnNav — connect/disconnect outcomes never collapse into one shape', () => {
  it('Connect dials /api/vpn/connect, not the nonexistent /api/vpn/start', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/vpn/connect' && opts?.method === 'POST') return jsonRes({ ok: true });
      return baseImpl()(url, opts);
    });
    const { container } = render(<VpnNav />);
    openPopover(container);
    await pickConnect();

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/api/vpn/connect', expect.objectContaining({ method: 'POST' })),
    );
    expect(apiFetch.mock.calls.map(([u]) => u)).not.toContain('/api/vpn/start');
  });

  it('renders a refusal verbatim and does not claim connected', async () => {
    const refusal = 'This host declined: no single endpoint pinned.';
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/vpn/connect' && opts?.method === 'POST') return jsonRes({ refused: true, refusal });
      return baseImpl()(url, opts);
    });
    const { container } = render(<VpnNav />);
    openPopover(container);
    await pickConnect();

    expect(await screen.findByText('Refused — nothing changed')).toBeInTheDocument();
    expect(screen.getByText(refusal)).toBeInTheDocument();
    expect(screen.queryByText(/^Connected/)).not.toBeInTheDocument();
  });

  it('renders a failure distinctly from a refusal', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/vpn/connect' && opts?.method === 'POST') {
        return jsonRes({ detail: 'wg-quick exited 1: device busy' }, false, 500);
      }
      return baseImpl()(url, opts);
    });
    const { container } = render(<VpnNav />);
    openPopover(container);
    await pickConnect();

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/device busy/)).toBeInTheDocument();
    expect(screen.queryByText('Refused — nothing changed')).not.toBeInTheDocument();
  });

  it('a timeout never claims a connected or disconnected verdict', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/vpn/connect' && opts?.method === 'POST') {
        return Promise.reject(new Error('the connection dropped mid-dial'));
      }
      return baseImpl()(url, opts);
    });
    const { container } = render(<VpnNav />);
    openPopover(container);
    await pickConnect();

    expect(await screen.findByText('Timed out — unknown state')).toBeInTheDocument();
    expect(screen.queryByText('Refused — nothing changed')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
  });

  it('Disconnect dials /api/vpn/disconnect, not the nonexistent /api/vpn/stop', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/vpn/disconnect' && opts?.method === 'POST') return jsonRes({ ok: true });
      return baseImpl({ status: { state: 'connected', connected: true, active: 'client_1' } })(url, opts);
    });
    const { container } = render(<VpnNav />);
    openPopover(container);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/api/vpn/disconnect', expect.objectContaining({ method: 'POST' })),
    );
    expect(apiFetch.mock.calls.map(([u]) => u)).not.toContain('/api/vpn/stop');
  });
});

describe('VpnNav — dead UI removed', () => {
  it('does not render an external-IP row or the vpn-only/auto-start toggles', async () => {
    apiFetch.mockImplementation(baseImpl({
      status: { state: 'connected', connected: true, active: 'client_1', egress_ip: '185.12.64.7' },
    }));
    const { container } = render(<VpnNav />);
    openPopover(container);
    await screen.findByText('Connected · client_1');

    expect(screen.queryByText('External IP')).not.toBeInTheDocument();
    expect(screen.queryByText('Allow VPN traffic only')).not.toBeInTheDocument();
    expect(screen.queryByText('Auto-start on boot')).not.toBeInTheDocument();
  });
});

describe('VpnNav — "Open VPN settings" navigates via the prop, not a dead hash', () => {
  // Regression for card 3d65bf3b-9510-810c-a8e6-ea56376647fc: this used to
  // write window.location.hash = '#settings/vpn', which nothing has
  // listened to since Settings moved to a floating window — the button did
  // nothing. App.jsx now passes openSettingsPanelNew(...) in as this prop.
  it('calls onOpenSettings and does not touch the hash', async () => {
    apiFetch.mockImplementation(baseImpl());
    const onOpenSettings = vi.fn();
    const originalHash = window.location.hash;
    const { container } = render(<VpnNav onOpenSettings={onOpenSettings} />);
    openPopover(container);

    fireEvent.click(await screen.findByTitle('Open Settings → VPN'));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe(originalHash);
    window.location.hash = originalHash;
  });

  it('does not blow up when no onOpenSettings prop is given', async () => {
    apiFetch.mockImplementation(baseImpl());
    const { container } = render(<VpnNav />);
    openPopover(container);
    expect(() => fireEvent.click(screen.getByTitle('Open Settings → VPN'))).not.toThrow();
  });
});

describe('VpnNav — hover is debounced against the live shellout', () => {
  it('does not refetch status on a second mouseenter shortly after the first', async () => {
    apiFetch.mockImplementation(baseImpl());
    const { container } = render(<VpnNav />);

    await waitFor(() => expect(apiFetch.mock.calls.filter(([u]) => u === '/api/vpn/status')).toHaveLength(1));

    fireEvent.mouseLeave(container.firstChild);
    fireEvent.mouseEnter(container.firstChild);
    fireEvent.mouseLeave(container.firstChild);
    fireEvent.mouseEnter(container.firstChild);

    expect(apiFetch.mock.calls.filter(([u]) => u === '/api/vpn/status')).toHaveLength(1);
  });
});

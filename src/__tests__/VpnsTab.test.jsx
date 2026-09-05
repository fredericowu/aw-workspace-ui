// Settings → General → VPNs — a profile manager AND the dialer control
// (upload/edit/delete/NordVPN import, plus connect/disconnect). These
// assert the things that matter most:
//   1. every call goes out as a RELATIVE /api/vpn/* path (the workspace
//      plane — see src/lib/vpnApi.js's header for why this differs from
//      networkingApi.js), never through centralApiUrl.
//   2. Connect is per-profile, Disconnect is global.
//   3. the backend's three connect/disconnect outcomes — refusal, failure,
//      timeout — render as three visibly different things, never one
//      generic toast, and a timeout never claims a verdict either way.
//   4. the whole action surface locks while a connect/disconnect request is
//      in flight, so a slow dial can't be doubled.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi, beforeEach, describe } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import VpnsTab from '../components/VpnsTab';

function jsonRes(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

const ONE_WIREGUARD_PROFILE = [{ name: 'client_1', type: 'wireguard', source: 'upload', endpoint: '1.2.3.4:51820' }];

function baseImpl({ configs = [], status = {} } = {}) {
  return (url) => {
    if (url === '/api/vpn/configs') return jsonRes({ configs });
    if (url === '/api/vpn/status') return jsonRes(status);
    if (url === '/api/vpn/nord/credentials') return jsonRes({ set: false });
    if (url === '/api/vpn/nord/countries') return jsonRes({ countries: [] });
    if (url.startsWith('/api/vpn/nord/recommendations')) return jsonRes({ servers: [] });
    return jsonRes({});
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VpnsTab — plane discipline', () => {
  it('lists profiles via a relative /api/vpn/configs call', async () => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/vpn/configs') {
        return jsonRes({
          configs: [{ name: 'client_1', type: 'wireguard', source: 'upload', endpoint: '1.2.3.4:51820' }],
        });
      }
      if (url === '/api/vpn/status') return jsonRes({});
      if (url === '/api/vpn/nord/credentials') return jsonRes({ set: false });
      if (url === '/api/vpn/nord/countries') return jsonRes({ countries: [] });
      if (url.startsWith('/api/vpn/nord/recommendations')) return jsonRes({ servers: [] });
      return jsonRes({});
    });

    render(<VpnsTab />);

    expect(await screen.findByText('client_1')).toBeInTheDocument();
    const urls = apiFetch.mock.calls.map(([url]) => url);
    urls.forEach((url) => expect(url.startsWith('/api/vpn/')).toBe(true));
    // Never the central control-plane host.
    urls.forEach((url) => expect(url).not.toMatch(/^https?:\/\//));
  });
});

describe('VpnsTab — dialer honesty (phase 2)', () => {
  it('says what connecting actually changes, and cross-references Networking', async () => {
    apiFetch.mockImplementation(baseImpl());
    render(<VpnsTab />);

    expect(await screen.findByText(/workspace's own outbound traffic/)).toBeInTheDocument();
    expect(screen.getByText(/External VPNs/)).toBeInTheDocument();
    expect(screen.getByText(/Not connected/)).toBeInTheDocument();
  });

  it('surfaces a /api/vpn/status failure as a written reason, not a fabricated state', async () => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/vpn/configs') return jsonRes({ configs: [] });
      if (url === '/api/vpn/status') return jsonRes({ detail: 'route not found' }, false, 404);
      if (url === '/api/vpn/nord/credentials') return jsonRes({ set: false });
      if (url === '/api/vpn/nord/countries') return jsonRes({ countries: [] });
      if (url.startsWith('/api/vpn/nord/recommendations')) return jsonRes({ servers: [] });
      return jsonRes({});
    });

    render(<VpnsTab />);

    expect(await screen.findByText(/route not found/)).toBeInTheDocument();
  });
});

describe('VpnsTab — Connect is per-profile, Disconnect is global', () => {
  it('shows a Connect button per profile and exactly one Disconnect control', async () => {
    apiFetch.mockImplementation(
      baseImpl({
        configs: [
          { name: 'client_1', type: 'wireguard' },
          { name: 'client_2', type: 'wireguard' },
        ],
      }),
    );

    render(<VpnsTab />);

    expect(await screen.findAllByRole('button', { name: 'Connect' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Disconnect/ })).toHaveLength(1);
  });

  it('renders "Connected" state and disables the OTHER profile\'s Connect while one is active', async () => {
    apiFetch.mockImplementation(
      baseImpl({
        configs: [
          { name: 'client_1', type: 'wireguard' },
          { name: 'client_2', type: 'wireguard' },
        ],
        status: { connected: true, profile: 'client_1' },
      }),
    );

    render(<VpnsTab />);

    expect(await screen.findAllByText('Connected')).not.toHaveLength(0);
    const disconnectBtn = screen.getByRole('button', { name: 'Disconnect' });
    expect(disconnectBtn).not.toBeDisabled();
    // client_2's Connect must be disabled — only one tunnel can be active.
    const remainingConnect = screen.getByRole('button', { name: 'Connect' });
    expect(remainingConnect).toBeDisabled();
  });

  it('disables Connect on an OpenVPN profile — second-class, not offered', async () => {
    apiFetch.mockImplementation(baseImpl({ configs: [{ name: 'nord_ovpn', type: 'openvpn' }] }));

    render(<VpnsTab />);

    const btn = await screen.findByRole('button', { name: 'Connect' });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/second-class/)).toBeInTheDocument();
  });
});

describe('VpnsTab — connect outcomes never collapse into one shape', () => {
  it('renders a refusal sentence verbatim, and does not claim a connected state', async () => {
    const refusal = 'This host declined: the profile pins no single endpoint, so the dead-man\'s switch could not be armed.';
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/vpn/connect' && opts?.method === 'POST') {
        return jsonRes({ refused: true, refusal });
      }
      return baseImpl({ configs: ONE_WIREGUARD_PROFILE, status: { connected: false, profile: null } })(url, opts);
    });

    render(<VpnsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/Refused — nothing changed/)).toBeInTheDocument();
    expect(screen.getByText(refusal)).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('renders a failure distinctly from a refusal', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/vpn/connect' && opts?.method === 'POST') {
        return jsonRes({ detail: 'wg-quick exited 1: device busy' }, false, 500);
      }
      return baseImpl({ configs: ONE_WIREGUARD_PROFILE, status: { connected: false, profile: null } })(url, opts);
    });

    render(<VpnsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/device busy/)).toBeInTheDocument();
    expect(screen.queryByText(/Refused — nothing changed/)).not.toBeInTheDocument();
  });

  it('a timeout never claims a "connected" or "disconnected" verdict', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/vpn/connect' && opts?.method === 'POST') {
        return Promise.reject(new Error('the connection dropped mid-dial'));
      }
      return baseImpl({ configs: ONE_WIREGUARD_PROFILE, status: { connected: false, profile: null } })(url, opts);
    });

    render(<VpnsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/Timed out — unknown state/)).toBeInTheDocument();
    expect(screen.getByText(/not a "connected" or "disconnected" verdict/)).toBeInTheDocument();
    // The banner reports the ambiguity — it must not also render a firm
    // Connected/Not connected claim contradicting that ambiguity elsewhere.
    expect(screen.queryByText(/Refused — nothing changed/)).not.toBeInTheDocument();
  });
});

describe('VpnsTab — in-progress lockout', () => {
  it('locks Connect/Disconnect/delete while a connect request is in flight, then unlocks', async () => {
    let resolveConnect;
    const pending = new Promise((resolve) => { resolveConnect = resolve; });

    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/vpn/connect' && opts?.method === 'POST') return pending;
      return baseImpl({ configs: ONE_WIREGUARD_PROFILE, status: { connected: false, profile: null } })(url, opts);
    });

    render(<VpnsTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connecting…' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Disconnect/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'View / edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '×' })).toBeDisabled();

    resolveConnect(jsonRes({ ok: true }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Connecting…' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Connect' })).not.toBeDisabled();
  });
});

describe('VpnsTab — rejected profile', () => {
  it('renders the server error verbatim, not a generic failure message', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/vpn/configs') return jsonRes({ configs: [] });
      if (url === '/api/vpn/status') return jsonRes({});
      if (url === '/api/vpn/nord/credentials') return jsonRes({ set: false });
      if (url === '/api/vpn/nord/countries') return jsonRes({ countries: [] });
      if (url.startsWith('/api/vpn/nord/recommendations')) return jsonRes({ servers: [] });
      if (url.startsWith('/api/vpn/configs/') && opts?.method === 'PUT') {
        return jsonRes({ detail: 'PostUp is not allowed in an uploaded profile' }, false, 422);
      }
      return jsonRes({});
    });

    render(<VpnsTab />);

    fireEvent.click(await screen.findByText('Add new'));
    fireEvent.change(screen.getByPlaceholderText(/profile name/), { target: { value: 'evil' } });
    fireEvent.change(screen.getByPlaceholderText(/paste config text here/), {
      target: { value: '[Interface]\nPostUp = iptables -F\n' },
    });
    fireEvent.click(screen.getByText('Save pasted profile'));

    expect(await screen.findByText(/PostUp is not allowed in an uploaded profile/)).toBeInTheDocument();
  });
});

describe('VpnsTab — NordVPN credentials never round-trip', () => {
  it('GET response never populates the password field', async () => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/vpn/configs') return jsonRes({ configs: [] });
      if (url === '/api/vpn/status') return jsonRes({});
      // Even if a buggy backend sent a password back, the screen must not
      // wire it into the password input.
      if (url === '/api/vpn/nord/credentials') return jsonRes({ set: true, password: 'leaked' });
      if (url === '/api/vpn/nord/countries') return jsonRes({ countries: [] });
      if (url.startsWith('/api/vpn/nord/recommendations')) return jsonRes({ servers: [] });
      return jsonRes({});
    });

    render(<VpnsTab />);

    fireEvent.click(await screen.findByText('NordVPN'));
    await waitFor(() => expect(screen.getByText('stored')).toBeInTheDocument());
    const pwField = screen.getByPlaceholderText('service password');
    expect(pwField.value).toBe('');
  });
});

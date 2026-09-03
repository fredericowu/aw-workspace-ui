// Settings → General → VPNs — a profile manager (upload/edit/delete/NordVPN
// import), NOT a dialer. These assert the two things that matter most:
//   1. every call goes out as a RELATIVE /api/vpn/* path (the workspace
//      plane — see src/lib/vpnApi.js's header for why this differs from
//      networkingApi.js), never through centralApiUrl.
//   2. the screen never renders a Connect/Disconnect action or a fabricated
//      connected/disconnected state — phase 1 cannot dial anything.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi, beforeEach, describe } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import VpnsTab from '../components/VpnsTab';

function jsonRes(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
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

describe('VpnsTab — phase 1 honesty', () => {
  beforeEach(() => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/vpn/configs') return jsonRes({ configs: [] });
      if (url === '/api/vpn/status') return jsonRes({});
      if (url === '/api/vpn/nord/credentials') return jsonRes({ set: false });
      if (url === '/api/vpn/nord/countries') return jsonRes({ countries: [] });
      if (url.startsWith('/api/vpn/nord/recommendations')) return jsonRes({ servers: [] });
      return jsonRes({});
    });
  });

  it('says nothing dials yet, and renders no Connect/Disconnect action', async () => {
    render(<VpnsTab />);

    expect(await screen.findByText(/Nothing here dials a tunnel yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Connect/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Disconnect/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument();
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

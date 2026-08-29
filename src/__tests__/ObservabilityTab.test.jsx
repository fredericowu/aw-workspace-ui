import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import ObservabilityTab from '../components/ObservabilityTab';

function getJson(body) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

describe('ObservabilityTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to Desligado selected', async () => {
    apiFetch.mockImplementation(() => getJson({
      mode: 'off', local_available: true, custom: { endpoint: '', api_key: '' },
      resolved: null, warning: null,
    }));

    render(<ObservabilityTab />);

    const off = await screen.findByRole('radio', { name: /Desligado/i });
    expect(off.checked).toBe(true);
  });

  it('disables Local when aw-app-signoz is not installed', async () => {
    apiFetch.mockImplementation(() => getJson({
      mode: 'off', local_available: false, custom: { endpoint: '', api_key: '' },
      resolved: null, warning: null,
    }));

    render(<ObservabilityTab />);

    const local = await screen.findByRole('radio', { name: /Local \(auto\)/i });
    expect(local.disabled).toBe(true);
    expect(screen.getByText(/Requires aw-app-signoz installed/i)).toBeTruthy();
  });

  it('selecting Local saves immediately and shows the resolved endpoint', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/settings/observability' && opts?.method === 'PUT') {
        return getJson({
          mode: 'local', local_available: true, custom: { endpoint: '', api_key: '' },
          resolved: { endpoint: 'https://signoz.app.ws.example.com', api_key: 'k', source: 'local' },
          warning: null,
        });
      }
      return getJson({
        mode: 'off', local_available: true, custom: { endpoint: '', api_key: '' },
        resolved: null, warning: null,
      });
    });

    render(<ObservabilityTab />);
    const local = await screen.findByRole('radio', { name: /Local \(auto\)/i });
    fireEvent.click(local);

    await waitFor(() => {
      expect(screen.getByTestId('observability-resolved-endpoint').textContent)
        .toBe('https://signoz.app.ws.example.com');
    });
    expect(apiFetch).toHaveBeenCalledWith('/api/settings/observability', expect.objectContaining({
      method: 'PUT',
    }));
  });

  it('selecting Custom does not save until the form is submitted', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (opts?.method === 'PUT') throw new Error('should not save before clicking Save');
      return getJson({
        mode: 'off', local_available: true, custom: { endpoint: '', api_key: '' },
        resolved: null, warning: null,
      });
    });

    render(<ObservabilityTab />);
    const custom = await screen.findByRole('radio', { name: /^Custom$/i });
    fireEvent.click(custom);

    expect(await screen.findByPlaceholderText(/signoz.app/i)).toBeTruthy();
  });

  it('saves custom endpoint and key on Save click', async () => {
    let putBody = null;
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/settings/observability' && opts?.method === 'PUT') {
        putBody = JSON.parse(opts.body);
        return getJson({
          mode: 'custom', local_available: true,
          custom: { endpoint: 'https://other.example.com', api_key: 'k' },
          resolved: { endpoint: 'https://other.example.com', api_key: 'k', source: 'custom' },
          warning: null,
        });
      }
      return getJson({
        mode: 'off', local_available: true, custom: { endpoint: '', api_key: '' },
        resolved: null, warning: null,
      });
    });

    render(<ObservabilityTab />);
    fireEvent.click(await screen.findByRole('radio', { name: /^Custom$/i }));

    fireEvent.change(screen.getByPlaceholderText(/signoz.app/i), {
      target: { value: 'https://other.example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/X-Api-Key/i), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(putBody).toEqual({
      mode: 'custom', custom: { endpoint: 'https://other.example.com', api_key: 'k' },
    }));
  });

  it('shows the fallback warning when Local was reset to Desligado', async () => {
    apiFetch.mockImplementation(() => getJson({
      mode: 'off', local_available: false, custom: { endpoint: '', api_key: '' },
      resolved: null,
      warning: 'aw-app-signoz was uninstalled — Observability mode reset to Desligado (was Local).',
    }));

    render(<ObservabilityTab />);

    expect(await screen.findByText(/reset to Desligado/i)).toBeTruthy();
  });
});

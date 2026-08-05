import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import IntegrationsTab from '../components/IntegrationsTab';

describe('IntegrationsTab — Workspace API Key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
  });

  it('loads and masks the key by default, revealing on Show', async () => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/settings/workspace-api-key') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'a'.repeat(64) }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ mcpServers: {} }) });
    });

    render(<IntegrationsTab />);

    const value = await screen.findByTestId('workspace-api-key-value');
    expect(value.textContent).toMatch(/^•+$/);
    expect(value.textContent).not.toContain('a');

    fireEvent.click(screen.getByRole('button', { name: /reveal api key/i }));
    expect(screen.getByTestId('workspace-api-key-value').textContent).toBe('a'.repeat(64));
  });

  it('regenerates the key on confirm and shows the new one', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/settings/workspace-api-key/regenerate' && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'b'.repeat(64) }) });
      }
      if (url === '/api/settings/workspace-api-key') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'a'.repeat(64) }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ mcpServers: {} }) });
    });

    render(<IntegrationsTab />);
    await screen.findByTestId('workspace-api-key-value');

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

    await waitFor(() => {
      expect(screen.getByTestId('workspace-api-key-value').textContent).toBe('b'.repeat(64));
    });
    expect(window.confirm).toHaveBeenCalled();
  });

  it('does not regenerate if the confirm dialog is dismissed', async () => {
    window.confirm = vi.fn(() => false);
    apiFetch.mockImplementation((url) => {
      if (url === '/api/settings/workspace-api-key') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ key: 'a'.repeat(64) }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ mcpServers: {} }) });
    });

    render(<IntegrationsTab />);
    await screen.findByTestId('workspace-api-key-value');
    apiFetch.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

    expect(apiFetch).not.toHaveBeenCalledWith('/api/settings/workspace-api-key/regenerate', expect.anything());
  });
});

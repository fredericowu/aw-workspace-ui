import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
vi.mock('../lib/networkingApi', () => ({ currentWorkspaceSlug: vi.fn() }));

import { apiFetch } from '../auth';
import { currentWorkspaceSlug } from '../lib/networkingApi';
import LocalDnsTab from '../components/LocalDnsTab';

const UNAVAILABLE = 'Local Network access is not available for this workspace.';

function jsonRes(status, body) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('LocalDnsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows one plain unavailable state when the slug lookup rejects (standalone workspace)', async () => {
    currentWorkspaceSlug.mockRejectedValue(new Error('HTTP 404'));
    render(<LocalDnsTab />);
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText('HTTP 404')).toBeNull();
    expect(screen.queryByText('Local Network Access')).toBeNull();
    expect(screen.queryByText(/When enabled, this workspace publishes/)).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('shows the unavailable state when the slug resolves empty', async () => {
    currentWorkspaceSlug.mockResolvedValue('');
    render(<LocalDnsTab />);
    expect(await screen.findByText(UNAVAILABLE)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('keeps an error state (not unavailable) when a known slug fails to load', async () => {
    currentWorkspaceSlug.mockResolvedValue('acme');
    apiFetch.mockResolvedValue(jsonRes(503, { error: 'backend down' }));
    render(<LocalDnsTab />);
    expect(await screen.findByText('backend down')).toBeTruthy();
    expect(screen.getByText('Local Network Access')).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });

  it('renders the managed eligible state with a toggle', async () => {
    currentWorkspaceSlug.mockResolvedValue('acme');
    apiFetch.mockResolvedValue(
      jsonRes(200, { eligible: true, publications: [{ kind: 'lan', enabled: false }] }),
    );
    render(<LocalDnsTab />);
    expect(await screen.findByText('Off')).toBeTruthy();
    expect(screen.getByText('Local Network Access')).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

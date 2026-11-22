import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
vi.mock('../lib/networkingApi', () => ({ currentWorkspaceSlug: vi.fn() }));

import { apiFetch } from '../auth';
import { currentWorkspaceSlug } from '../lib/networkingApi';
import LocalDnsTab from '../components/LocalDnsTab';

describe('LocalDnsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leaves Loading and shows the error when the slug lookup rejects (standalone workspace)', async () => {
    currentWorkspaceSlug.mockRejectedValue(new Error('HTTP 404'));
    render(<LocalDnsTab />);
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.getByText('HTTP 404')).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

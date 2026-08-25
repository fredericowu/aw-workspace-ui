import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import UsersTab from '../components/UsersTab';

function mockApi({ guestUsersResponse }) {
  apiFetch.mockImplementation((url) => {
    if (url === '/api/guest-users') return Promise.resolve(guestUsersResponse);
    // getAwConfig() — irrelevant to these cases, keep it inert.
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

describe('UsersTab — load() array guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders users when /api/guest-users returns a real list', async () => {
    mockApi({
      guestUsersResponse: {
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ id: '1', username: 'alice', allowed_apps: [] }]),
      },
    });

    render(<UsersTab />);

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.queryByTestId('users-load-error')).not.toBeInTheDocument();
  });

  it('shows a visible error and an empty (not crashed) list on a 200 with a non-list body', async () => {
    mockApi({
      guestUsersResponse: {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ detail: 'not a list' }),
      },
    });

    render(<UsersTab />);

    expect(await screen.findByTestId('users-load-error')).toHaveTextContent(/unexpected response/i);
    expect(screen.getByText(/no guest users yet/i)).toBeInTheDocument();
  });

  it('shows a visible error when the request fails (!res.ok)', async () => {
    mockApi({
      guestUsersResponse: {
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'boom' }),
      },
    });

    render(<UsersTab />);

    const err = await screen.findByTestId('users-load-error');
    expect(err).toHaveTextContent(/failed to load users/i);
    expect(err).toHaveTextContent(/500/);
    expect(screen.getByText(/no guest users yet/i)).toBeInTheDocument();
  });

  it('does not get stuck on "Loading…" after a failed load', async () => {
    mockApi({
      guestUsersResponse: { ok: false, status: 500, json: () => Promise.resolve({}) },
    });

    render(<UsersTab />);

    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
  });
});

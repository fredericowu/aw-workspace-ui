import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import AppWindow from '../components/AppWindow';

// The PoC app's windows/main.json (kept in sync with
// aw-workspace/examples/apps/hello/windows/main.json).
const HELLO_SPEC = {
  title: 'Hello App',
  layout: 'single',
  regions: [
    {
      id: 'body',
      widgets: [
        { type: 'markdown', value: '# Hello 👋\nrendered from a declarative spec.' },
        { type: 'button', label: 'Ping backend', action: { call: 'GET /api/apps/hello/' } },
        { type: 'list', title: 'What this proves', items: ['a', 'b', 'c'] },
      ],
    },
  ],
};

describe('AppWindow (declarative renderer)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the window title and declarative widgets', () => {
    render(<AppWindow spec={HELLO_SPEC} />);
    expect(screen.getByRole('heading', { name: 'Hello App' })).toBeInTheDocument();
    // markdown heading
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello');
    // list items
    expect(screen.getByText('What this proves')).toBeInTheDocument();
    ['a', 'b', 'c'].forEach((t) => expect(screen.getByText(t)).toBeInTheDocument());
    // button
    expect(screen.getByRole('button', { name: 'Ping backend' })).toBeInTheDocument();
  });

  it('button action calls the app backend and shows the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ app: 'hello', ok: true, version: '1.0.0' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={HELLO_SPEC} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ping backend' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/apps/hello/', { method: 'GET' });
      expect(screen.getByTestId('appwin-result')).toHaveTextContent('"app": "hello"');
    });
  });

  it('renders nothing when spec is missing', () => {
    const { container } = render(<AppWindow spec={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('AppWindow button auto-poll (device-flow-style)', () => {
  const POLL_SPEC = {
    title: 'Git',
    regions: [
      {
        id: 'device-login',
        widgets: [
          {
            type: 'button',
            label: 'Sign in with GitHub',
            action: {
              call: 'POST /api/apps/git/device/start',
              poll: {
                call: 'POST /api/apps/git/device/poll',
                interval_ms: 10,
                timeout_ms: 100,
                done_field: 'status',
                done_values: ['success', 'expired_token', 'access_denied', 'error'],
                pending_text: 'Waiting for authorization…',
                timeout_text: 'Timed out.',
              },
            },
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('polls until a terminal status arrives, updating the UI along the way', async () => {
    const fetchMock = vi
      .fn()
      // initial /device/start call
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user_code: 'ABCD-1234' }) })
      // poll #1 — pending
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'authorization_pending' }) })
      // poll #2 — pending
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'authorization_pending' }) })
      // poll #3 — terminal success
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'success', logged_in: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={POLL_SPEC} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/apps/git/device/start', { method: 'POST' });
    await waitFor(() => expect(screen.getByTestId('appwin-poll-pending')).toHaveTextContent('Waiting for authorization…'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(screen.getByTestId('appwin-result')).toHaveTextContent('"status": "success"');
    // polling stopped: no pending indicator, button re-enabled
    expect(screen.queryByTestId('appwin-poll-pending')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).not.toBeDisabled();
  });

  it('stops and shows a timeout message when the deadline elapses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user_code: 'ABCD-1234' }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'authorization_pending' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={POLL_SPEC} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // timeout_ms is 100ms — poll interval is 10ms, so it trips well within the test timeout
    await waitFor(
      () => {
        expect(screen.getByTestId('appwin-result')).toHaveTextContent('Timed out.');
      },
      { timeout: 2000 },
    );
    expect(screen.queryByTestId('appwin-poll-pending')).not.toBeInTheDocument();
  });

  it('does not start polling if the initial call fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={POLL_SPEC} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('appwin-poll-pending')).not.toBeInTheDocument();
  });
});

describe('AppWindow collapsible widget', () => {
  const SPEC = {
    regions: [
      {
        id: 'advanced',
        widgets: [
          {
            type: 'collapsible',
            title: 'Advanced / other sign-in method',
            collapsed: true,
            widgets: [{ type: 'markdown', value: 'hidden by default' }],
          },
        ],
      },
    ],
  };

  it('hides its child widgets behind a closed disclosure by default', () => {
    render(<AppWindow spec={SPEC} />);
    const summary = screen.getByText('Advanced / other sign-in method');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('hidden by default')).toBeInTheDocument();
  });

  it('respects collapsed: false to render open', () => {
    const openSpec = {
      regions: [
        {
          id: 'r',
          widgets: [{ ...SPEC.regions[0].widgets[0], collapsed: false }],
        },
      ],
    };
    render(<AppWindow spec={openSpec} />);
    expect(screen.getByText('Advanced / other sign-in method').closest('details')).toHaveAttribute('open');
  });
});

describe('AppWindow form widget', () => {
  const SPEC = {
    regions: [
      {
        id: 'advanced',
        widgets: [
          {
            type: 'form',
            id: 'advanced_settings',
            submit: { call: 'POST /api/apps/git/settings' },
            submit_label: 'Save',
            fields: [
              {
                key: 'auth_method',
                label: 'Sign-in method',
                input: 'select',
                options: ['web', 'token'],
                default: 'web',
              },
              {
                key: 'github_token',
                label: 'GitHub personal access token',
                input: 'password',
                visible_when: { field: 'auth_method', equals: 'token' },
              },
            ],
          },
        ],
      },
    ],
  };

  it('hides a conditional field until its condition is met, then shows it', () => {
    render(<AppWindow spec={SPEC} />);
    expect(screen.queryByLabelText('GitHub personal access token')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Sign-in method'), { target: { value: 'token' } });
    expect(screen.getByLabelText('GitHub personal access token')).toBeInTheDocument();
  });

  it('submits all field values as JSON to the submit call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={SPEC} />);
    fireEvent.change(screen.getByLabelText('Sign-in method'), { target: { value: 'token' } });
    fireEvent.change(screen.getByLabelText('GitHub personal access token'), { target: { value: 'ghp_abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/apps/git/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_method: 'token', github_token: 'ghp_abc' }),
      });
    });
  });
});

describe('AppWindow auth_status widget', () => {
  const SPEC = {
    regions: [
      {
        id: 'status',
        widgets: [
          {
            type: 'auth_status',
            bind: 'GET /api/apps/git/status',
            logout_action: { call: 'POST /api/apps/git/logout' },
            loading_text: 'Checking…',
            logged_in_text: 'Logged in as {username}',
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the logged-in state with a Logout button', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ logged_in: true, username: 'octocat' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={SPEC} />);
    await waitFor(() => expect(screen.getByText('Logged in as octocat')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  it('renders nothing extra when logged out and no logged_out_text is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ logged_in: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={SPEC} />);
    await waitFor(() => expect(screen.queryByText('Checking…')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
  });

  it('calls the logout action and re-fetches status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ logged_in: true, username: 'octocat' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ logged_in: false }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={SPEC} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/apps/git/logout', { method: 'POST' });
    expect(screen.queryByText('Logged in as octocat')).not.toBeInTheDocument();
  });
});

describe('AppWindow cross-widget refresh + hide_when_logged_in', () => {
  // Mirrors the real git app window: an auth_status widget plus a
  // hide_when_logged_in sign-in button in a sibling region.
  const SPEC = {
    regions: [
      {
        id: 'status',
        widgets: [
          { type: 'auth_status', bind: 'GET /api/apps/git/status', logged_in_text: 'Logged in as {username}' },
        ],
      },
      {
        id: 'device-login',
        widgets: [
          { type: 'markdown', hide_when_logged_in: true, value: 'Sign in instructions' },
          {
            type: 'button',
            hide_when_logged_in: true,
            label: 'Sign in with GitHub',
            action: {
              call: 'POST /api/apps/git/device/start',
              poll: {
                call: 'POST /api/apps/git/device/poll',
                interval_ms: 10,
                timeout_ms: 1000,
                done_field: 'status',
                done_values: ['success'],
              },
            },
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the sign-in button visible while logged out', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ logged_in: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={SPEC} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument();
    expect(screen.getByText('Sign in instructions')).toBeInTheDocument();
  });

  it('hides the sign-in section and refreshes auth_status once the device-flow poll succeeds', async () => {
    const fetchMock = vi
      .fn()
      // auth_status initial fetch — logged out
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ logged_in: false }) })
      // /device/start
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user_code: 'ABCD-1234' }) })
      // /device/poll — terminal success
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: 'success' }) })
      // auth_status re-fetch triggered by the poll's success (RefreshContext bump)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ logged_in: true, username: 'octocat' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={SPEC} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));

    await waitFor(() => expect(screen.getByText('Logged in as octocat')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole('button', { name: 'Sign in with GitHub' })).not.toBeInTheDocument();
    expect(screen.queryByText('Sign in instructions')).not.toBeInTheDocument();
  });
});

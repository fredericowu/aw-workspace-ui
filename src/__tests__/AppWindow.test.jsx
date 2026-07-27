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

import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/appEventsSocket', () => ({ subscribeAppEvents: vi.fn() }));
import { subscribeAppEvents } from '../lib/appEventsSocket';
import AppWindow from '../components/AppWindow';

const AUTH_SPEC = {
  title: 'Settings',
  regions: [
    {
      id: 'body',
      widgets: [
        { type: 'auth_status', bind: 'GET /api/apps/google-workspace-mcp/status' },
      ],
    },
  ],
};

describe('AppWindow — appId / app_event subscription', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    subscribeAppEvents.mockReturnValue(() => {});
  });

  it('does not subscribe when appId is absent', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ logged_in: false }) }));
    render(<AppWindow spec={AUTH_SPEC} />);
    expect(subscribeAppEvents).not.toHaveBeenCalled();
  });

  it('subscribes with the given appId and bumps the refresh counter on a matching event', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ logged_in: false }) });
    vi.stubGlobal('fetch', fetchMock);

    let deliver;
    subscribeAppEvents.mockImplementation((appId, fn) => {
      deliver = fn;
      return () => {};
    });

    render(<AppWindow spec={AUTH_SPEC} appId="google-workspace-mcp" />);

    expect(subscribeAppEvents).toHaveBeenCalledWith('google-workspace-mcp', expect.any(Function));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => {
      deliver({ app: 'google-workspace-mcp', event: 'oauth_completed', usable: true });
    });

    // The bump re-runs the auth_status bind fetch — no full remount needed.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('releases the subscription on unmount', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ logged_in: false }) }));
    const release = vi.fn();
    subscribeAppEvents.mockReturnValue(release);

    const { unmount } = render(<AppWindow spec={AUTH_SPEC} appId="google-workspace-mcp" />);
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

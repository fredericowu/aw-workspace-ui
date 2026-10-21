import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal fake WebSocket — mirrors useSharedSocket.test.js's fixture.
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
  }
  send() {}
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  fire(msg) {
    this.readyState = 1;
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}
FakeWebSocket.OPEN = 1;
FakeWebSocket.instances = [];
vi.stubGlobal('WebSocket', FakeWebSocket);

describe('appEventsSocket — shared app_event dispatch', () => {
  beforeEach(async () => {
    vi.resetModules();
    FakeWebSocket.instances = [];
  });

  it('dispatches an app_event frame only to subscribers of the matching app id', async () => {
    const { subscribeAppEvents } = await import('../lib/appEventsSocket');

    const googleFn = vi.fn();
    const otherFn = vi.fn();
    subscribeAppEvents('google-workspace-mcp', googleFn);
    subscribeAppEvents('some-other-app', otherFn);

    // One shared socket for every subscriber, not one per app.
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].fire({
      type: 'app_event',
      data: { app: 'google-workspace-mcp', event: 'oauth_completed', usable: true },
    });

    expect(googleFn).toHaveBeenCalledWith({ app: 'google-workspace-mcp', event: 'oauth_completed', usable: true });
    expect(otherFn).not.toHaveBeenCalled();
  });

  it('ignores non-app_event frames (e.g. ninja_notification) without throwing', async () => {
    const { subscribeAppEvents } = await import('../lib/appEventsSocket');
    const fn = vi.fn();
    subscribeAppEvents('google-workspace-mcp', fn);

    FakeWebSocket.instances[0].fire({ type: 'ninja_notification', notification: { id: 1 } });

    expect(fn).not.toHaveBeenCalled();
  });

  it('ignores a future app_event envelope version', async () => {
    const { subscribeAppEvents } = await import('../lib/appEventsSocket');
    const fn = vi.fn();
    subscribeAppEvents('some-app', fn);
    FakeWebSocket.instances[0].fire({
      type: 'app_event', version: 2,
      data: { app: 'some-app', event: 'open_file' },
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('unsubscribe stops further delivery to that listener', async () => {
    const { subscribeAppEvents } = await import('../lib/appEventsSocket');
    const fn = vi.fn();
    const unsubscribe = subscribeAppEvents('google-workspace-mcp', fn);
    unsubscribe();

    FakeWebSocket.instances[0].fire({
      type: 'app_event',
      data: { app: 'google-workspace-mcp', event: 'oauth_completed' },
    });

    expect(fn).not.toHaveBeenCalled();
  });

  it('a listener that throws does not prevent other listeners for the same app', async () => {
    const { subscribeAppEvents } = await import('../lib/appEventsSocket');
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    subscribeAppEvents('google-workspace-mcp', bad);
    subscribeAppEvents('google-workspace-mcp', good);

    expect(() => FakeWebSocket.instances[0].fire({
      type: 'app_event',
      data: { app: 'google-workspace-mcp', event: 'oauth_completed' },
    })).not.toThrow();

    expect(good).toHaveBeenCalled();
  });
});

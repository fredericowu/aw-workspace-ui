import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSharedSocket } from '../hooks/useSharedSocket';

// Minimal fake WebSocket — jsdom doesn't implement a real one. `open()` lets a
// test simulate a real 101-then-close (the §2.6.1 premature-accept failure);
// nothing in the source under test assigns `onopen` any more (§7.1), but the
// fake still supports firing it so a REGRESSION that re-adds an onopen-reset
// handler is actually exercised by these tests, not silently inert.
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    FakeWebSocket.instances.push(this);
  }
  send() {}
  open() { this.readyState = 1; this.onopen?.(); }
  close(code, reason) {
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason });
  }
  fire(msg) {
    this.readyState = 1;
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}
FakeWebSocket.OPEN = 1;
FakeWebSocket.instances = [];
vi.stubGlobal('WebSocket', FakeWebSocket);

describe('createSharedSocket (aw-ws/1 shared client)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    // Zero out the jitter half of backoffDelay so reconnect timing is exact
    // and the §7.1 regression test can assert on precise millisecond
    // thresholds instead of a flaky range.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    Math.random.mockRestore();
  });

  it('stops reconnecting and reports fatal on a 4401 close (no hot loop against the auth wall)', async () => {
    const onStatus = vi.fn();
    const socket = createSharedSocket({ url: () => '/ws/x', onFrame: () => {}, onStatus });
    socket.retain();
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].close(4401);
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'fatal', code: 4401 }));

    // Give the old fixed-interval retry every chance to fire if the fix
    // regressed — a full minute of simulated time, several backoff cycles.
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('does NOT reset the backoff counter on an open-then-quick-close cycle (§7.1)', async () => {
    // Mutation-test this: reinstating `socket.onopen = () => { attempt = 0 }`
    // in useSharedSocket.js's connect() makes this test fail, because the
    // fake's .open() call below would then reset the counter every cycle.
    const socket = createSharedSocket({ url: () => '/ws/x', onFrame: () => {} });
    socket.retain();
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Cycle 1: the tunnel's "101 was real" case — the socket opens, then the
    // far end closes well before MIN_HEALTHY_MS and before any frame arrives.
    FakeWebSocket.instances[0].open();
    await vi.advanceTimersByTimeAsync(100);
    FakeWebSocket.instances[0].close(1006);

    // attempt was 0 at schedule time -> backoffDelay(0) = 250ms exactly
    // (jitter mocked to 0).
    await vi.advanceTimersByTimeAsync(249);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Cycle 2: identical premature-accept pattern.
    FakeWebSocket.instances[1].open();
    await vi.advanceTimersByTimeAsync(100);
    FakeWebSocket.instances[1].close(1006);

    // attempt is now 1 -> backoffDelay(1) = 500ms. If onopen had reset the
    // counter, this would be 250ms again and a 3rd instance would already
    // exist by t=300.
    await vi.advanceTimersByTimeAsync(300);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('resets the backoff once a frame proves the connection healthy', async () => {
    const socket = createSharedSocket({ url: () => '/ws/x', onFrame: () => {} });
    socket.retain();

    // One premature close to push attempt to 1 (next delay would be 500ms).
    FakeWebSocket.instances[0].close(1006);
    await vi.advanceTimersByTimeAsync(250);
    expect(FakeWebSocket.instances).toHaveLength(2);

    // This time a real frame lands before the close — the connection is
    // healthy, so the NEXT close must schedule at the base delay again.
    FakeWebSocket.instances[1].fire({ type: 'some_update', data: {} });
    FakeWebSocket.instances[1].close(1006);

    await vi.advanceTimersByTimeAsync(249);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('reaches healthy after MIN_HEALTHY_MS even with no inbound frame', async () => {
    const onStatus = vi.fn();
    const socket = createSharedSocket({ url: () => '/ws/x', onFrame: () => {}, onStatus });
    socket.retain();

    await vi.advanceTimersByTimeAsync(10000);
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'open' }));

    // A close after the dwell timeout must be treated as a healthy
    // connection dropping, not an unhealthy retry — next delay is the base.
    FakeWebSocket.instances[0].close(1006);
    await vi.advanceTimersByTimeAsync(249);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('passes unknown frame types through to onFrame (forward-compatible per §4.3)', () => {
    const onFrame = vi.fn();
    const socket = createSharedSocket({ url: () => '/ws/x', onFrame });
    socket.retain();

    FakeWebSocket.instances[0].fire({ type: 'some_future_type', data: { foo: 1 } });

    expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({ type: 'some_future_type' }));
    expect(FakeWebSocket.instances[0].readyState).not.toBe(3); // still open, not closed over it
  });

  it('handles the literal "error" type centrally and never forwards it to onFrame', () => {
    const onFrame = vi.fn();
    const socket = createSharedSocket({ url: () => '/ws/x', onFrame });
    socket.retain();

    FakeWebSocket.instances[0].fire({ type: 'error', data: { code: 'nope', message: 'x' } });

    expect(onFrame).not.toHaveBeenCalled();
  });

  it('shares one socket across two retains and closes only on the last release', () => {
    const socket = createSharedSocket({ url: () => '/ws/x', onFrame: () => {} });
    const release1 = socket.retain();
    const release2 = socket.retain();
    expect(FakeWebSocket.instances).toHaveLength(1);

    release1();
    expect(FakeWebSocket.instances[0].readyState).not.toBe(3);

    release2();
    expect(FakeWebSocket.instances[0].readyState).toBe(3);
  });

  it('surfaces an "unhealthy" status after MAX_UNHEALTHY_STREAK consecutive failures (§7.7)', async () => {
    const onStatus = vi.fn();
    const socket = createSharedSocket({ url: () => '/ws/x', onFrame: () => {}, onStatus });
    socket.retain();

    // Three consecutive closes, none ever reaching healthy — each gap stays
    // well under MIN_HEALTHY_MS (10s) so the dwell timer never gets a
    // chance to mark the connection healthy on its own.
    for (const delay of [300, 600, 1200]) {
      const ws = FakeWebSocket.instances.at(-1);
      ws.close(1006);
      await vi.advanceTimersByTimeAsync(delay);
    }

    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'unhealthy' }));
  });

  it('closes the socket 4426 and stops reconnecting on a newer protocol than supported', async () => {
    const onStatus = vi.fn();
    const socket = createSharedSocket({
      url: () => '/ws/x',
      onFrame: () => {},
      onStatus,
      initType: 'tasks_init',
      supportedProtocol: 1,
    });
    socket.retain();

    FakeWebSocket.instances[0].fire({ type: 'tasks_init', data: { protocol: 2 } });

    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'fatal', code: 4426 }));
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

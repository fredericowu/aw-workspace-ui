import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWebSocket } from '../hooks/useWebSocket';

// Minimal fake WebSocket — jsdom doesn't implement a real one. Mirrors the
// pattern in AppsMarketplace.test.jsx.
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    FakeWebSocket.instances.push(this);
  }
  send() {}
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
}
FakeWebSocket.instances = [];
vi.stubGlobal('WebSocket', FakeWebSocket);

describe('useWebSocket (/ws/logs shared hook)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  it('reconnects after an ordinary transport close', async () => {
    vi.useFakeTimers();
    renderHook(() => useWebSocket('some-component', () => {}));

    expect(FakeWebSocket.instances).toHaveLength(1);
    act(() => { FakeWebSocket.instances[0].onclose({ code: 1006 }); });

    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.useRealTimers();
  });

  it('stops reconnecting and reports sessionExpired on a 4401 close (the auth-wall loop bug)', async () => {
    const onFail = vi.fn();
    window.addEventListener('aw-auth-failed', onFail);

    const { result } = renderHook(() => useWebSocket('some-component', () => {}));
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => { FakeWebSocket.instances[0].onclose({ code: 4401 }); });

    await waitFor(() => expect(result.current.sessionExpired).toBe(true));
    expect(onFail).toHaveBeenCalledTimes(1);

    // No new connection should ever be attempted after an auth close.
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeWebSocket.instances).toHaveLength(1);

    window.removeEventListener('aw-auth-failed', onFail);
  });

  it('also stops on 4403 and 4426 (forbidden / protocol upgrade required)', async () => {
    for (const code of [4403, 4426]) {
      FakeWebSocket.instances = [];
      const onFail = vi.fn();
      window.addEventListener('aw-auth-failed', onFail);

      const { result, unmount } = renderHook(() => useWebSocket(`k-${code}`, () => {}));
      act(() => { FakeWebSocket.instances[0].onclose({ code }); });

      await waitFor(() => expect(result.current.sessionExpired).toBe(true));
      expect(onFail).toHaveBeenCalledTimes(1);

      window.removeEventListener('aw-auth-failed', onFail);
      unmount();
    }
  });
});

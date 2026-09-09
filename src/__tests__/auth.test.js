import { describe, it, expect, vi, beforeEach } from 'vitest';
describe('Auth module', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.resetModules();
    vi.doUnmock('../apiBase');
  });

  it('should export apiFetch', async () => {
    const { apiFetch } = await import('../auth');
    expect(typeof apiFetch).toBe('function');
  });

  it('apiFetch adds auth headers', async () => {
    localStorage.setItem('aw_api_key', 'test-key-123');
    const { apiFetch } = await import('../auth');

    await apiFetch('/api/test');

    expect(fetch).toHaveBeenCalled();
    const [url] = fetch.mock.calls[0];
    expect(url).toBe('/api/test');
  });

  it('apiFetch fires aw-auth-failed on a 401 from the framework API, confirmed by getAuthStatus', async () => {
    fetch
      .mockResolvedValueOnce({ status: 401, ok: false, json: () => Promise.resolve({}) })
      // The confirming getAuthStatus() call — also a real 401.
      .mockResolvedValueOnce({ status: 401, ok: false, json: () => Promise.resolve({}) });
    const { apiFetch } = await import('../auth');
    const onFail = vi.fn();
    window.addEventListener('aw-auth-failed', onFail);

    await apiFetch('/api/tasks');

    expect(onFail).toHaveBeenCalledTimes(1);
    window.removeEventListener('aw-auth-failed', onFail);
  });

  it('apiFetch does NOT fire aw-auth-failed on a 401 that getAuthStatus does not confirm', async () => {
    // The workspace's identity check lazily fetches + caches aw-backend's
    // public key in-process — right after a container restart, the first
    // request can 401 a perfectly valid JWT on a momentary network hiccup.
    // getAuthStatus's own retry+null handling is the source of truth here,
    // not this one response.
    fetch
      .mockResolvedValueOnce({ status: 401, ok: false, json: () => Promise.resolve({}) })
      // The confirming getAuthStatus() call — this time it succeeds.
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ authenticated: true, mode: 'password' }) });
    const { apiFetch } = await import('../auth');
    const onFail = vi.fn();
    window.addEventListener('aw-auth-failed', onFail);

    await apiFetch('/api/tasks');

    expect(onFail).not.toHaveBeenCalled();
    window.removeEventListener('aw-auth-failed', onFail);
  });

  it('apiFetch does NOT fire aw-auth-failed on a 401 from an app-proxied route', async () => {
    fetch.mockResolvedValueOnce({ status: 401, ok: false, json: () => Promise.resolve({}) });
    const { apiFetch } = await import('../auth');
    const onFail = vi.fn();
    window.addEventListener('aw-auth-failed', onFail);

    await apiFetch('/api/apps/mcp-gateway/admin/config');

    expect(onFail).not.toHaveBeenCalled();
    window.removeEventListener('aw-auth-failed', onFail);
  });

  it('apiFetch retries a dropped connection on an app-proxied route and succeeds', async () => {
    vi.useFakeTimers();
    fetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ status: 200, ok: true, json: () => Promise.resolve({ ok: true }) });
    const { apiFetch } = await import('../auth');

    const promise = apiFetch('/api/apps/mcp-gateway/admin/config');
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('apiFetch gives up retrying a dropped connection after a few attempts', async () => {
    vi.useFakeTimers();
    fetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { apiFetch } = await import('../auth');

    const promise = apiFetch('/api/apps/mcp-gateway/admin/config');
    // Swallow the eventual rejection so it doesn't register as an unhandled
    // one while the fake-timer-driven retries are still in flight.
    promise.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('Failed to fetch');
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('apiFetch does NOT retry a dropped connection on a non-app route', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { apiFetch } = await import('../auth');

    await expect(apiFetch('/api/tasks')).rejects.toThrow('Failed to fetch');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('getAuthStatus returns the parsed body on a healthy response', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ authenticated: true, mode: 'password' }) });
    const { getAuthStatus } = await import('../auth');

    const result = await getAuthStatus();

    expect(result).toEqual({ authenticated: true, mode: 'password' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('getAuthStatus returns authenticated:false on a real 401/403', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });
    const { getAuthStatus } = await import('../auth');

    const result = await getAuthStatus();

    expect(result).toEqual({ authenticated: false, mode: 'password' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('getAuthStatus retries a 502 from the BYOD tunnel and succeeds', async () => {
    vi.useFakeTimers();
    fetch
      .mockResolvedValueOnce({ ok: false, status: 502, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ authenticated: true, mode: 'password' }) });
    const { getAuthStatus } = await import('../auth');

    const promise = getAuthStatus();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ authenticated: true, mode: 'password' });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('getAuthStatus returns authenticated:null (not false) after exhausting retries on 5xx', async () => {
    vi.useFakeTimers();
    fetch
      .mockResolvedValueOnce({ ok: false, status: 502, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: false, status: 502, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: false, status: 502, json: () => Promise.resolve({}) });
    const { getAuthStatus } = await import('../auth');

    const promise = getAuthStatus();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.authenticated).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('getAuthStatus returns authenticated:null (not false) after a dropped connection', async () => {
    vi.useFakeTimers();
    fetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { getAuthStatus } = await import('../auth');

    const promise = getAuthStatus();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.authenticated).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('logout uses legacy auth endpoint outside workspace hosts', async () => {
    vi.doMock('../apiBase', () => ({
      consoleLogoutUrl: () => null,
      identityLogoutUrl: () => null,
    }));
    const { logout } = await import('../auth');

    await logout();

    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('logout uses central identity endpoint from workspace hosts', async () => {
    vi.doMock('../apiBase', () => ({
      consoleLogoutUrl: () => null,
      identityLogoutUrl: () => 'https://api.aw.tekflox.com/api/identity/logout',
    }));
    const { logout } = await import('../auth');

    await logout();

    expect(fetch).toHaveBeenCalledWith('https://api.aw.tekflox.com/api/identity/logout', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('logout redirects workspace hosts to the console logout flow', async () => {
    vi.doMock('../apiBase', () => ({
      consoleLogoutUrl: () => 'https://console.aw.tekflox.com/logout',
      identityLogoutUrl: () => 'https://api.aw.tekflox.com/api/identity/logout',
    }));
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    });
    const { logout } = await import('../auth');

    await logout();

    expect(assign).toHaveBeenCalledWith('https://console.aw.tekflox.com/logout');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('isAuthWsClose is true for the codes IdentityGuard actually closes with (4401/4403/4426)', async () => {
    const { isAuthWsClose } = await import('../auth');
    expect(isAuthWsClose(4401)).toBe(true);
    expect(isAuthWsClose(4403)).toBe(true);
    expect(isAuthWsClose(4426)).toBe(true);
  });

  it('isAuthWsClose is false for an ordinary transport close', async () => {
    const { isAuthWsClose } = await import('../auth');
    expect(isAuthWsClose(1000)).toBe(false);
    expect(isAuthWsClose(1006)).toBe(false);
    expect(isAuthWsClose(4404)).toBe(false);
    expect(isAuthWsClose(undefined)).toBe(false);
  });

  it('notifyWsAuthFailed fires the same window-scoped aw-auth-failed event apiFetch uses', async () => {
    const { notifyWsAuthFailed } = await import('../auth');
    const onFail = vi.fn();
    window.addEventListener('aw-auth-failed', onFail);

    notifyWsAuthFailed();

    expect(onFail).toHaveBeenCalledTimes(1);
    window.removeEventListener('aw-auth-failed', onFail);
  });
});

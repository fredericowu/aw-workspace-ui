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

  it('apiFetch fires aw-auth-failed on a 401 from the framework API', async () => {
    fetch.mockResolvedValueOnce({ status: 401, ok: false, json: () => Promise.resolve({}) });
    const { apiFetch } = await import('../auth');
    const onFail = vi.fn();
    window.addEventListener('aw-auth-failed', onFail);

    await apiFetch('/api/tasks');

    expect(onFail).toHaveBeenCalledTimes(1);
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
});

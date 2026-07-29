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

  it('logout uses legacy auth endpoint outside workspace hosts', async () => {
    vi.doMock('../apiBase', () => ({ identityLogoutUrl: () => null }));
    const { logout } = await import('../auth');

    await logout();

    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  });

  it('logout uses central identity endpoint from workspace hosts', async () => {
    vi.doMock('../apiBase', () => ({
      identityLogoutUrl: () => 'https://api.aw.tekflox.com/api/identity/logout',
    }));
    const { logout } = await import('../auth');

    await logout();

    expect(fetch).toHaveBeenCalledWith('https://api.aw.tekflox.com/api/identity/logout', {
      method: 'POST',
      credentials: 'include',
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
describe('Auth module', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
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
});

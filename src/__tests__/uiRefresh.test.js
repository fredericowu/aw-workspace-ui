import { describe, it, expect, beforeEach } from 'vitest';
import { markUiRefreshNeeded, consumeUiRefreshNeeded, reloadForUiRefresh } from '../apps/uiRefresh';

describe('uiRefresh', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('consumeUiRefreshNeeded is false when nothing was marked', () => {
    expect(consumeUiRefreshNeeded()).toBe(false);
  });

  it('marks then consumes exactly once (consuming clears the flag)', () => {
    markUiRefreshNeeded();
    expect(consumeUiRefreshNeeded()).toBe(true);
    expect(consumeUiRefreshNeeded()).toBe(false);
  });

  it('reloadForUiRefresh navigates to the current URL with a fresh ?refresh=<random> param', () => {
    // jsdom's window.location doesn't support real navigation — spy on the
    // `href` setter instead of asserting the actual location changed.
    let assignedHref = null;
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        href: 'https://ws.example.com/?a=1#home',
        set href(v) { assignedHref = v; },
        get href() { return assignedHref ?? 'https://ws.example.com/?a=1#home'; },
      },
    });
    try {
      reloadForUiRefresh();
      const url = new URL(assignedHref);
      expect(url.pathname).toBe('/');
      expect(url.searchParams.get('a')).toBe('1'); // existing params preserved
      expect(url.searchParams.get('refresh')).toMatch(/^\d+$/);
      expect(url.hash).toBe('#home'); // SPA hash route preserved
    } finally {
      Object.defineProperty(window, 'location', originalDescriptor);
    }
  });
});

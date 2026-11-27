import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import useLegacySettingsLink from '../hooks/useLegacySettingsLink';

afterEach(() => window.history.replaceState(null, '', '/'));

describe('legacy Settings links', () => {
  it.each([
    ['aw', 'aw'],
    ['integrations', 'integrations'],
    ['users', 'users'],
    ['tcp-proxy', 'tcp-proxy'],
    ['vpn', 'workspace-vpn'],
    ['local-dns', 'local-dns'],
    ['backup', 'backup'],
    ['skills', 'skills'],
    ['proxy', null],
    ['feed-subscriber', null],
    ['mcp', null],
    ['constructor', null],
    ['backup/extra', null],
  ])('opens the Settings destination for %s and consumes the fragment', (tab, key) => {
    const state = { marker: 'keep' };
    window.history.replaceState(state, '', `/workspace?keep=1#settings/${tab}`);
    const openSettings = vi.fn();

    renderHook(() => useLegacySettingsLink(openSettings));

    expect(openSettings).toHaveBeenCalledExactlyOnceWith(key ? { group: 'general', key } : null);
    expect(window.location.href).toMatch(/\/workspace\?keep=1$/);
    expect(window.history.state).toEqual(state);
  });

  it.each(['#mobile', '#desktop', '#app=browser&view=mobile'])('leaves %s to its own routing', (hash) => {
    window.history.replaceState(null, '', hash);
    const openSettings = vi.fn();

    renderHook(() => useLegacySettingsLink(openSettings));

    expect(openSettings).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(hash);
  });
});

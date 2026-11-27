// initialTarget deep-linking (card 3d65bf3b-9510-810c-a8e6-ea56376647fc):
// VpnNav's "Open VPN settings" button used to write a dead `#settings/vpn`
// hash nobody listens to anymore — Settings NEW is a floating window opened
// via App.jsx's openSettingsPanelNew(), which now threads an optional
// {selection, nonce} target down to this component. These pin the two
// behaviours that make the deep link actually land: opening straight on the
// requested section, and re-navigating if the window was already open.
//
// The apps-group test below is the general-purpose proof: openSettingsPanelNew
// and this deep-link plumbing were never VPN-specific — {group, key} already
// accepted 'apps' + an app slug on day one (App.jsx's `selection` comment).
// This just exercises that path so it's not only asserted in a comment.
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// Mocked so the apps-group assertion doesn't also have to stand up
// AppConfigBody's own schema/contributions fetching — out of scope for a
// test whose job is proving the deep link REACHES the Apps group, not
// exercising what one app's settings body renders.
vi.mock('../apps/appsApi', () => ({
  listInstalledApps: vi.fn().mockResolvedValue([]),
  fetchContributions: vi.fn().mockResolvedValue({ windows: [], nav: [], frontend: [] }),
}));
vi.mock('../components/AppConfigBody', () => ({ default: () => <div data-testid="app-config-body-stub" /> }));

import { listInstalledApps } from '../apps/appsApi';
import SettingsPanelNew from '../components/SettingsPanelNew';

function installMatchMedia(matches) {
  window.matchMedia = vi.fn(() => ({
    matches,
    media: '(max-width: 767px)',
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
}

const originalMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = originalMatchMedia; });

beforeEach(() => {
  installMatchMedia(false);
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve(''),
  }));
  // Reset per test — the apps-group test below overrides this with a real
  // app; every other test needs the Apps group empty so it doesn't interfere
  // with the General-group assertions.
  listInstalledApps.mockResolvedValue([]);
});

function vpnsNavButton() {
  return screen.getByRole('button', { name: 'VPNs' });
}

describe('SettingsPanelNew — initialTarget deep link', () => {
  it('with no target, opens on About', async () => {
    render(<SettingsPanelNew />);
    const aboutBtn = await screen.findByRole('button', { name: 'About' });
    expect(aboutBtn.className).toMatch(/bg-\[var\(--color-accent\)\]/);
  });

  it('opens straight on the requested section when given a target', async () => {
    render(<SettingsPanelNew initialTarget={{ selection: { group: 'general', key: 'vpn' }, nonce: 1 }} />);
    const vpnsBtn = await vpnsNavButton();
    expect(vpnsBtn.className).toMatch(/bg-\[var\(--color-accent\)\]/);
  });

  it('re-navigates on a fresh nonce even though the component was already mounted', async () => {
    const { rerender } = render(<SettingsPanelNew />);
    await screen.findByRole('button', { name: 'Users' });
    expect((await vpnsNavButton()).className).not.toMatch(/bg-\[var\(--color-accent\)\]/);

    rerender(<SettingsPanelNew initialTarget={{ selection: { group: 'general', key: 'vpn' }, nonce: 1 }} />);
    expect(await vpnsNavButton()).toHaveClass('bg-[var(--color-accent)]/15');

    // Same {group,key} again, but the window is already open — only the
    // nonce changing (a new click) proves this is not a mount-time fluke.
    rerender(<SettingsPanelNew initialTarget={{ selection: { group: 'general', key: 'vpn' }, nonce: 2 }} />);
    expect(await vpnsNavButton()).toHaveClass('bg-[var(--color-accent)]/15');
  });

  it('also deep-links into the Apps group — the target is not VPN- or General-specific', async () => {
    listInstalledApps.mockResolvedValue([
      { slug: 'kb', name: 'Knowledge Base', version: '1.0.0', has_config: true, icon: null },
    ]);

    render(<SettingsPanelNew initialTarget={{ selection: { group: 'apps', key: 'kb' }, nonce: 1 }} />);

    // The button's accessible name concatenates the AppIcon letter-avatar
    // ("K") with the label ("Knowledge Base") — no whitespace between the
    // two <span>s — so match by substring, not an exact "Knowledge Base".
    const kbBtn = await screen.findByRole('button', { name: /Knowledge Base/ });
    expect(kbBtn.className).toMatch(/bg-\[var\(--color-accent\)\]/);
    // And its content actually renders — proves `selection.group === 'apps'`
    // resolved a real app, not just a highlighted-but-empty nav row.
    expect(await screen.findByTestId('app-config-body-stub')).toBeInTheDocument();
  });
});

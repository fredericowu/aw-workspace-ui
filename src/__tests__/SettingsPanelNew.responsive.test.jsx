// SettingsPanelNew renders two layouts off one breakpoint: the desktop
// sidebar+content split, and a narrow list-then-detail for the mobile shell.
//
// jsdom's matchMedia never actually evaluates a width query, so the query is
// stubbed here — that IS the unit under test: the component must read the
// breakpoint through matchMedia and react to a change event, because App.jsx
// swaps shells on the same 768px threshold and the two must not disagree.
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import SettingsPanelNew from '../components/SettingsPanelNew';

// Minimal MediaQueryList that lets a test flip the match and fire 'change'.
function installMatchMedia(initialMatches) {
  const listeners = new Set();
  const mql = {
    matches: initialMatches,
    media: '(max-width: 767px)',
    addEventListener: (_e, cb) => listeners.add(cb),
    removeEventListener: (_e, cb) => listeners.delete(cb),
    addListener: (cb) => listeners.add(cb),
    removeListener: (cb) => listeners.delete(cb),
  };
  window.matchMedia = vi.fn(() => mql);
  return {
    setMatches(v) {
      mql.matches = v;
      act(() => { listeners.forEach((cb) => cb({ matches: v })); });
    },
    listenerCount: () => listeners.size,
  };
}

const originalMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = originalMatchMedia; });

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve(''),
  }));
});

describe('SettingsPanelNew — wide (desktop shell)', () => {
  it('shows nav and section content at the same time, and opens on Users', async () => {
    installMatchMedia(false);
    render(<SettingsPanelNew />);

    // Nav is present...
    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Networking/ })).toBeInTheDocument();
    // ...and so is a section, with no navigation step in between. This is the
    // pre-existing desktop behaviour and must not regress.
    expect(document.querySelector('.w-56')).toBeInTheDocument();
  });

  it('never renders the narrow back row', () => {
    installMatchMedia(false);
    render(<SettingsPanelNew />);
    expect(screen.queryByRole('button', { name: /Back to Settings/ })).not.toBeInTheDocument();
  });
});

describe('SettingsPanelNew — narrow (mobile shell)', () => {
  it('drops the fixed 224px sidebar entirely', () => {
    installMatchMedia(true);
    render(<SettingsPanelNew />);
    // w-56 is the 224px sidebar that ate 57% of a 390px viewport.
    expect(document.querySelector('.w-56')).not.toBeInTheDocument();
  });

  it('opens on the section list, not on a section', () => {
    installMatchMedia(true);
    render(<SettingsPanelNew />);

    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Networking/ })).toBeInTheDocument();
    // No back row yet — nothing to go back from.
    expect(screen.queryByRole('button', { name: /Back to Settings/ })).not.toBeInTheDocument();
  });

  it('tapping a section swaps the list for that section, with a back row', () => {
    installMatchMedia(true);
    render(<SettingsPanelNew />);

    fireEvent.click(screen.getByRole('button', { name: /Networking/ }));

    // The back row names where you are.
    expect(screen.getByRole('button', { name: /Back to Settings — Networking/ })).toBeInTheDocument();
    // And the list is gone — one column, not two.
    expect(screen.queryByRole('button', { name: 'General' })).not.toBeInTheDocument();
  });

  it('the back row returns to the list', () => {
    installMatchMedia(true);
    render(<SettingsPanelNew />);

    fireEvent.click(screen.getByRole('button', { name: /Networking/ }));
    fireEvent.click(screen.getByRole('button', { name: /Back to Settings — Networking/ }));

    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back to Settings/ })).not.toBeInTheDocument();
  });

  it('a not-yet-migrated section still opens, showing its coming-soon body', () => {
    installMatchMedia(true);
    render(<SettingsPanelNew />);

    fireEvent.click(screen.getByRole('button', { name: /Backup/ }));

    expect(screen.getByRole('button', { name: /Back to Settings — Backup/ })).toBeInTheDocument();
    expect(screen.getByText(/coming soon/)).toBeInTheDocument();
  });
});

describe('SettingsPanelNew — breakpoint changes', () => {
  it('follows a resize past the breakpoint without a remount', () => {
    const mm = installMatchMedia(false);
    render(<SettingsPanelNew />);

    expect(document.querySelector('.w-56')).toBeInTheDocument();

    mm.setMatches(true);
    expect(document.querySelector('.w-56')).not.toBeInTheDocument();

    mm.setMatches(false);
    expect(document.querySelector('.w-56')).toBeInTheDocument();
  });

  it('unsubscribes the media listener on unmount', () => {
    const mm = installMatchMedia(true);
    const { unmount } = render(<SettingsPanelNew />);
    expect(mm.listenerCount()).toBe(1);
    unmount();
    expect(mm.listenerCount()).toBe(0);
  });
});

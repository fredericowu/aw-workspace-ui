import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../apps/appsApi', () => ({
  listInstalledApps: vi.fn().mockResolvedValue([]),
  fetchContributions: vi.fn().mockResolvedValue({ windows: [], nav: [], frontend: [] }),
}));
vi.mock('../components/AppConfigBody', () => ({ default: () => <div /> }));

import SettingsPanelNew from '../components/SettingsPanelNew';

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({
    matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve('') }));
});

describe('SettingsPanelNew — rework', () => {
  it('lists About above the General header and drops the moved tabs', async () => {
    render(<SettingsPanelNew />);
    const about = await screen.findByRole('button', { name: 'About' });
    const general = screen.getByRole('button', { name: 'General' });
    expect(about.compareDocumentPosition(general) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of ['Cookies', 'MCP Servers', 'Feed Subscriber']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('lists Legacy settings last in General and finds it by search', async () => {
    render(<SettingsPanelNew />);
    const legacy = await screen.findByRole('button', { name: 'Legacy settings' });
    const skills = screen.getByRole('button', { name: 'Skills' });
    expect(skills.compareDocumentPosition(legacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const search = screen.getByLabelText('Search settings');
    for (const q of ['legacy', 'mcp']) {
      fireEvent.change(search, { target: { value: q } });
      expect(screen.getByRole('button', { name: /Legacy settings/ })).toBeInTheDocument();
    }
  });

  it('opens About for a removed or unknown target', async () => {
    render(<SettingsPanelNew initialTarget={{ selection: { group: 'general', key: 'mcp' }, nonce: 1 }} />);
    const about = await screen.findByRole('button', { name: 'About' });
    expect(about.className).toMatch(/bg-\[var\(--color-accent\)\]/);
  });

  it('opens About for an app that is not installed', async () => {
    render(<SettingsPanelNew initialTarget={{ selection: { group: 'apps', key: 'gone' }, nonce: 1 }} />);
    const about = await screen.findByRole('button', { name: 'About' });
    await vi.waitFor(() => expect(about.className).toMatch(/bg-\[var\(--color-accent\)\]/));
  });

  it('finds About by search', async () => {
    render(<SettingsPanelNew />);
    fireEvent.change(await screen.findByLabelText('Search settings'), { target: { value: 'machine resources' } });
    expect(screen.getByRole('button', { name: /About/ })).toBeInTheDocument();
  });

  it('divider drag resizes the nav and clamps at the limits', async () => {
    const { container } = render(<SettingsPanelNew />);
    const divider = await screen.findByTestId('settings-divider');
    const root = divider.parentElement;
    root.getBoundingClientRect = () => ({ left: 100, width: 800, top: 0, height: 0, right: 900, bottom: 0 });
    const nav = divider.previousElementSibling;
    expect(nav.style.width).toBe('224px');
    divider.setPointerCapture = () => {};
    divider.releasePointerCapture = () => {};
    const ev = (type, x) => {
      const e = new Event(type, { bubbles: true });
      Object.assign(e, { clientX: x, pointerId: 1 });
      return e;
    };
    fireEvent(divider, Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), { pointerId: 1 }));
    divider.dispatchEvent(ev('pointermove', 400));
    await vi.waitFor(() => expect(nav.style.width).toBe('300px'));
    divider.dispatchEvent(ev('pointermove', 105));
    await vi.waitFor(() => expect(nav.style.width).toBe('160px'));
    divider.dispatchEvent(ev('pointermove', 890));
    await vi.waitFor(() => expect(nav.style.width).toBe('476px'));
    divider.dispatchEvent(ev('pointerup', 890));
    expect(container).toBeTruthy();
  });
});

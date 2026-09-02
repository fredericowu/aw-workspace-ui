import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same pattern as MobileApp.appsSection.test.jsx: appsApi drives both the
// Apps section (listInstalledApps) and the window-contribution lookup
// defaultLaunchWindow uses (fetchContributions) to resolve what an app row
// opens.
vi.mock('../apps/appsApi', () => ({
  listInstalledApps: vi.fn(),
  fetchContributions: vi.fn(),
}));

import { listInstalledApps, fetchContributions } from '../apps/appsApi';
import { slotRegistry, windowTitlebarSlot } from '../apps/slotRegistry';
import MobileApp from '../components/MobileApp';

const WINDOW_ID = 'remote-screen.main';
const TEST_APP_ID = 'test-remote-screen';

describe('MobileApp — app-window titlebar slot (regression: bug:mobile-app-window-missing-titlebar-slot)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // A `component`-body window, same shape as Remote Screen's
    // `remote-screen.main` (aw-app-remote-screen/aw-app.json) — the case
    // that goes through MobileApp's generic 'app-window' path instead of
    // the legacy managed_app iframe overlay.
    listInstalledApps.mockResolvedValue([
      { slug: 'remote-screen', name: 'Remote Screen', category: 'Tool', has_windows: true, settings_panels: [] },
    ]);
    fetchContributions.mockResolvedValue({
      windows: [
        { id: WINDOW_ID, app: 'remote-screen', title: 'Remote Screen', body: { type: 'component' } },
      ],
      nav: [],
      frontend: [],
    });
  });

  afterEach(() => {
    // The slot registry is a process-wide singleton (see slotRegistry.js) —
    // unmount whatever this test registered so it doesn't leak into others.
    slotRegistry.unmountApp(TEST_APP_ID);
  });

  it('renders the core.window.titlebar:<id> slot for an opened app-window, mirroring BasicWindow.jsx', async () => {
    // Stands in for RemoteScreenWindowActions (aw-app-remote-screen/ui/src/
    // plugin.jsx) — the component Remote Screen registers via
    // host.registerWindowActions so its host picker lands in the window's
    // title bar instead of a second bar in the body.
    slotRegistry.mount(windowTitlebarSlot(WINDOW_ID), {
      id: 'remote-screen-actions',
      appId: TEST_APP_ID,
      render: () => <button data-testid="remote-screen-titlebar-action">Switch host</button>,
    });

    render(<MobileApp />);

    fireEvent.click(await screen.findByText('Remote Screen'));

    // Before the fix, MobileApp's 'app-window' branch rendered AppWindowBody
    // only — no AppSlot for windowTitlebarSlot(windowSpec.id) anywhere in
    // that path — so this never mounted and Remote Screen's host picker
    // (plus the effect that loads hosts) never ran on mobile.
    expect(await screen.findByTestId('remote-screen-titlebar-action')).toBeInTheDocument();
  });

  it('does not render the titlebar slot when nothing is registered for this window', async () => {
    render(<MobileApp />);

    fireEvent.click(await screen.findByText('Remote Screen'));

    // AppSlot's null fallback — no titlebar contribution means no residue,
    // same as desktop's BasicWindow.
    expect(screen.queryByTestId('remote-screen-titlebar-action')).toBeNull();
  });
});

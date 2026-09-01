import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// listInstalledApps drives the Apps section (mobile-apps-menu design);
// fetchContributions is what usePluginContributions() fetches on mount —
// both live in this module, and MobileApp must NOT call
// usePluginContributions() a second time (see its activeWirings guard), so
// this is the one place both get faked for every test below.
vi.mock('../apps/appsApi', () => ({
  listInstalledApps: vi.fn(),
  fetchContributions: vi.fn().mockResolvedValue({ windows: [], nav: [], frontend: [] }),
}));

import { listInstalledApps } from '../apps/appsApi';
import MobileApp from '../components/MobileApp';

describe('MobileApp — Apps section (installed apps, not workspace_apps)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows only installed apps with has_windows: true', async () => {
    listInstalledApps.mockResolvedValue([
      { slug: 'kb', name: 'Knowledge Base', category: 'Tool', has_windows: true, settings_panels: [] },
      { slug: 'essentials', name: 'Essentials', category: 'Tool', has_windows: false, settings_panels: [] },
      { slug: 'proxy', name: 'AW Proxy', category: 'Service', has_windows: true, settings_panels: [] },
    ]);

    render(<MobileApp />);

    expect(await screen.findByText('Knowledge Base')).toBeInTheDocument();
    expect(await screen.findByText('AW Proxy')).toBeInTheDocument();
    // has_windows: false never renders here — command-only apps have no
    // window to open on mobile (same has_windows gate manifest.py uses).
    expect(screen.queryByText('Essentials')).toBeNull();
  });

  it('groups apps under their category as a section header, not a filter', async () => {
    listInstalledApps.mockResolvedValue([
      { slug: 'kb', name: 'Knowledge Base', category: 'Tool', has_windows: true, settings_panels: [] },
      { slug: 'proxy', name: 'AW Proxy', category: 'Service', has_windows: true, settings_panels: [] },
    ]);

    render(<MobileApp />);

    await screen.findByText('Knowledge Base');
    // Both categories are present as section headers — neither app is
    // dropped the way AppLauncher's Tool/Service-excluding `uiApps` would.
    expect(screen.getByText('Tool')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('AW Proxy')).toBeInTheDocument();
  });

  it('shows a loading state before the installed-apps fetch resolves, not "no apps"', () => {
    listInstalledApps.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MobileApp />);
    expect(screen.getByText(/Loading apps/i)).toBeInTheDocument();
  });
});

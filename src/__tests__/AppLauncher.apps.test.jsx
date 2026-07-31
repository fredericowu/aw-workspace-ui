import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../apps/appsApi', () => ({
  listInstalledApps: vi.fn(),
  uninstallApp: vi.fn(),
  installMyApps: vi.fn(),
  // AppLauncher fetches the catalog on mount (for the Installed-row update
  // badge) even when the Marketplace panel is never opened — default to an
  // empty catalog so tests that don't care about updates aren't broken.
  fetchCatalog: vi.fn().mockResolvedValue({ apps: [] }),
  installApp: vi.fn(),
  updateApp: vi.fn(),
  getInstallStatus: vi.fn().mockRejectedValue(new Error('no such job')),
  // AppConfigWindow always checks for an app-authored settings_panel window
  // on open (see aw-app-git's Sign in with GitHub panel) — without this the
  // gear-click test's dialog never renders (fetchContributions undefined).
  fetchContributions: vi.fn().mockResolvedValue({ settings: [], windows: [] }),
  getAppVersions: vi.fn(),
  setAppVersion: vi.fn(),
}));
import {
  listInstalledApps, uninstallApp, installMyApps, fetchCatalog, updateApp, getInstallStatus,
  installApp, getAppVersions,
} from '../apps/appsApi';
import AppLauncher from '../components/AppLauncher';

const INSTALLED = [
  { slug: 'git', name: 'Git + GitHub CLI', version: '0.1.0', icon: 'git-branch', signed: true, has_config: true, has_windows: true, config_schema: { properties: { github_token: { type: 'string', 'x-secret': true } } }, frontend: {} },
  { slug: 'essentials', name: 'Essentials', version: '0.1.0', icon: 'terminal', signed: true, has_config: false, has_windows: false, config_schema: {}, frontend: {} },
];

function renderLauncher() {
  return render(
    <AppLauncher
      workspaceApps={[]}
      components={[]}
      starting={false}
      onOpenApp={vi.fn()}
      onStartBuilding={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('AppLauncher — F5 Apps view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear(); // AppLauncher now seeds installed/catalogVersions from the apps cache
  });

  it('renders the installed framework apps from GET /api/apps with a config gear (UI tab default)', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    renderLauncher();

    expect(await screen.findByTestId('installed-list')).toBeInTheDocument();
    expect(screen.getByText('Git + GitHub CLI')).toBeInTheDocument();
    // gear only for the has_config app
    expect(screen.getByRole('button', { name: 'Configure Git + GitHub CLI' })).toBeInTheDocument();

    // Essentials (command-only) lives under the Runnables tab, not UI.
    expect(screen.queryByText('Essentials')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Runnables/ }));
    expect(await screen.findByText('Essentials')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configure Essentials' })).toBeNull();
  });

  it('UI tab shows the visual (has_windows) card grid; Runnables tab shows the command-only list', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    renderLauncher();

    const grid = await screen.findByTestId('installed-grid');
    expect(grid).toHaveTextContent('Git + GitHub CLI');
    expect(screen.queryByTestId('installed-commands')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Runnables/ }));
    const commands = await screen.findByTestId('installed-commands');
    expect(commands).toHaveTextContent('Essentials');
    expect(screen.queryByTestId('installed-grid')).toBeNull();
  });

  it('gear opens the config window for a has_config app', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    renderLauncher();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure Git + GitHub CLI' }));
    expect(await screen.findByRole('dialog', { name: /settings/i })).toBeInTheDocument();
  });

  it('"More" in the config window closes settings and opens the Marketplace on that app', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    fetchCatalog.mockResolvedValue({
      apps: [{ id: 'git', name: 'Git + GitHub CLI', description: 'git & gh', icon: 'git-branch', repo: 'x/git', ref: 'main', has_config: true }],
    });
    renderLauncher();

    fireEvent.click(await screen.findByRole('button', { name: 'Configure Git + GitHub CLI' }));
    await screen.findByRole('dialog', { name: /settings/i });
    fireEvent.click(await screen.findByRole('button', { name: 'More' }));

    expect(screen.queryByRole('dialog', { name: /settings/i })).not.toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: 'Marketplace' })).toBeInTheDocument();
    // Detail view (not the catalog list) — "← Back" only renders there.
    expect(await screen.findByRole('button', { name: '← Back' })).toBeInTheDocument();
  });

  it('"Other Releases" in the Marketplace detail closes it and opens the pin/rollback window', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    fetchCatalog.mockResolvedValue({
      apps: [{ id: 'git', name: 'Git + GitHub CLI', description: 'git & gh', icon: 'git-branch', repo: 'x/git', ref: 'main', has_config: true, version: '0.1.0' }],
    });
    getAppVersions.mockResolvedValue({ slug: 'git', installed_version: '0.1.0', catalog_version: '0.1.0', versions: [] });
    renderLauncher();

    fireEvent.click(await screen.findByRole('button', { name: 'Marketplace' }));
    await screen.findByRole('dialog', { name: 'Marketplace' });
    const catalogItem = document.querySelector('.appmkt-item');
    fireEvent.click(catalogItem);
    fireEvent.click(await screen.findByRole('button', { name: 'Other Releases' }));

    expect(screen.queryByRole('dialog', { name: 'Marketplace' })).not.toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: /versions/i })).toBeInTheDocument();
    await waitFor(() => expect(getAppVersions).toHaveBeenCalledWith('git'));
  });

  it('Marketplace button opens the marketplace panel with the catalog', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    fetchCatalog.mockResolvedValue({ apps: [{ id: 'notes', name: 'Notes', description: 'notes app', icon: 'notebook', repo: 'x/notes', ref: 'main', has_config: false }] });
    renderLauncher();

    fireEvent.click(await screen.findByRole('button', { name: 'Marketplace' }));
    expect(await screen.findByText('Notes')).toBeInTheDocument();
    expect(fetchCatalog).toHaveBeenCalled();
  });

  it('uninstall calls DELETE and refreshes the installed list', async () => {
    listInstalledApps.mockResolvedValueOnce(INSTALLED).mockResolvedValueOnce([INSTALLED[1]]);
    uninstallApp.mockResolvedValue({ uninstalled: true });
    renderLauncher();

    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall Git + GitHub CLI' }));
    await waitFor(() => expect(uninstallApp).toHaveBeenCalledWith('git'));
    await waitFor(() => expect(screen.queryByText('Git + GitHub CLI')).toBeNull());
  });

  it('Install My Apps triggers the reconcile flow', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    installMyApps.mockResolvedValue({ changed: [] });
    renderLauncher();

    fireEvent.click(await screen.findByRole('button', { name: 'Install My Apps' }));
    await waitFor(() => expect(installMyApps).toHaveBeenCalled());
  });

  it('shows an "Update available" badge when the catalog version is newer than installed', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    fetchCatalog.mockResolvedValue({ apps: [{ id: 'essentials', name: 'Essentials', version: '0.2.0' }] });
    renderLauncher();

    fireEvent.click(await screen.findByRole('tab', { name: /Runnables/ }));
    expect(await screen.findByTestId('update-badge-essentials')).toHaveTextContent('Update available v0.2.0');
    expect(await screen.findByRole('button', { name: 'Update Essentials' })).toBeInTheDocument();
  });

  it('no badge/button when installed matches (or exceeds) the catalog version', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    fetchCatalog.mockResolvedValue({ apps: [{ id: 'essentials', name: 'Essentials', version: '0.1.0' }] });
    renderLauncher();

    fireEvent.click(await screen.findByRole('tab', { name: /Runnables/ }));
    await screen.findByTestId('installed-list');
    expect(screen.queryByTestId('update-badge-essentials')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update Essentials' })).toBeNull();
  });

  it('clicking Update POSTs to /api/apps/{slug}/update and refreshes the installed list', async () => {
    listInstalledApps
      .mockResolvedValueOnce(INSTALLED)
      .mockResolvedValueOnce([{ ...INSTALLED[0] }, { ...INSTALLED[1], version: '0.2.0' }]);
    fetchCatalog.mockResolvedValue({ apps: [{ id: 'essentials', name: 'Essentials', version: '0.2.0' }] });
    updateApp.mockResolvedValue({ status: 'installing' });
    getInstallStatus.mockResolvedValue({ status: 'installed' });
    renderLauncher();

    fireEvent.click(await screen.findByRole('tab', { name: /Runnables/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update Essentials' }));
    await waitFor(() => expect(updateApp).toHaveBeenCalledWith('essentials'));
    await waitFor(() => expect(screen.queryByTestId('update-badge-essentials')).toBeNull());
  });

  it('installing a has_config app from the Marketplace never auto-opens its config window', async () => {
    // Regression test — config used to pop open automatically right after a
    // successful install for a has_config app. Frederico's feedback: the
    // Marketplace must never force a config screen; the gear is opt-in only.
    listInstalledApps
      .mockResolvedValueOnce(INSTALLED)
      .mockResolvedValueOnce([...INSTALLED, { slug: 'notes', name: 'Notes', version: '1.0.0', icon: 'notebook', signed: true, has_config: true, config_schema: { properties: { key: { type: 'string' } } }, frontend: {} }]);
    fetchCatalog.mockResolvedValue({ apps: [{ id: 'notes', name: 'Notes', description: 'notes app', icon: 'notebook', repo: 'x/notes', ref: 'main', has_config: true }] });
    installApp.mockResolvedValue({ app_id: 'notes', status: 'installing' });
    getInstallStatus.mockResolvedValue({ status: 'installed' });
    renderLauncher();

    fireEvent.click(await screen.findByRole('button', { name: 'Marketplace' }));
    fireEvent.click(await screen.findByText('Notes'));
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));

    await waitFor(() => expect(installApp).toHaveBeenCalled());
    // give the onInstalled callback a tick to run through — it must NOT open
    // AppConfigWindow for the freshly-installed has_config app.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /settings/i })).not.toBeInTheDocument());
  });

  it('Version button opens the pin/rollback window and fetches version history', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    getAppVersions.mockResolvedValue({
      slug: 'essentials', installed_version: '0.1.0', catalog_version: '0.2.0',
      versions: [{ ref: 'v0.2.0', version: '0.2.0' }, { ref: 'v0.1.0', version: '0.1.0' }],
    });
    renderLauncher();

    fireEvent.click(await screen.findByRole('tab', { name: /Runnables/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Essentials version' }));
    expect(await screen.findByRole('dialog', { name: /versions/i })).toBeInTheDocument();
    await waitFor(() => expect(getAppVersions).toHaveBeenCalledWith('essentials'));
    const list = await screen.findByTestId('appver-list');
    expect(list).toHaveTextContent('Installed');
    expect(screen.getByRole('button', { name: 'Install this version' })).toBeInTheDocument();
  });
});

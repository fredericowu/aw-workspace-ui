import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../apps/appsApi', () => ({
  listInstalledApps: vi.fn(),
  uninstallApp: vi.fn(),
  installMyApps: vi.fn(),
  fetchCatalog: vi.fn(),
  installApp: vi.fn(),
}));
import {
  listInstalledApps, uninstallApp, installMyApps, fetchCatalog,
} from '../apps/appsApi';
import AppLauncher from '../components/AppLauncher';

const INSTALLED = [
  { slug: 'git', name: 'Git + GitHub CLI', version: '0.1.0', icon: 'git-branch', signed: true, has_config: true, config_schema: { properties: { github_token: { type: 'string', 'x-secret': true } } }, frontend: {} },
  { slug: 'essentials', name: 'Essentials', version: '0.1.0', icon: 'terminal', signed: true, has_config: false, config_schema: {}, frontend: {} },
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
  beforeEach(() => vi.clearAllMocks());

  it('renders the installed framework apps from GET /api/apps with a config gear', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    renderLauncher();

    expect(await screen.findByTestId('installed-list')).toBeInTheDocument();
    expect(screen.getByText('Git + GitHub CLI')).toBeInTheDocument();
    expect(screen.getByText('Essentials')).toBeInTheDocument();
    // gear only for the has_config app
    expect(screen.getByRole('button', { name: 'Configure Git + GitHub CLI' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configure Essentials' })).toBeNull();
  });

  it('gear opens the config window for a has_config app', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    renderLauncher();
    fireEvent.click(await screen.findByRole('button', { name: 'Configure Git + GitHub CLI' }));
    expect(await screen.findByRole('dialog', { name: /settings/i })).toBeInTheDocument();
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
});

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../apps/appsApi', () => ({
  fetchCatalog: vi.fn(),
  installApp: vi.fn(),
}));
import { fetchCatalog, installApp } from '../apps/appsApi';
import AppsMarketplace from '../components/AppsMarketplace';

const CATALOG = {
  apps: [
    { id: 'git', name: 'Git + GitHub CLI', description: 'git & gh', icon: 'git-branch', repo: 'tekflox/aw-app-git', ref: 'master', has_config: true },
    { id: 'essentials', name: 'Essentials', description: 'cli tools', icon: 'terminal', repo: 'tekflox/aw-app-essentials', ref: 'master', has_config: false },
  ],
};

describe('AppsMarketplace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists catalog apps and installs one via the framework flow', async () => {
    fetchCatalog.mockResolvedValue(CATALOG);
    installApp.mockResolvedValue({ installed: true });
    const onInstalled = vi.fn();

    render(<AppsMarketplace installedSlugs={['essentials']} onInstalled={onInstalled} onClose={() => {}} />);

    // both catalog apps listed
    expect(await screen.findByText('Git + GitHub CLI')).toBeInTheDocument();
    expect(screen.getByText('Essentials')).toBeInTheDocument();
    // already-installed one shows "Installed", not an Install button
    expect(screen.getByText('Installed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(installApp).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'tekflox/aw-app-git', ref: 'master', app_id: 'git', signed: true }),
    ));
    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(expect.objectContaining({ id: 'git' })));
  });

  it('surfaces an install error without crashing the panel', async () => {
    fetchCatalog.mockResolvedValue(CATALOG);
    installApp.mockRejectedValue(new Error('clone failed'));
    render(<AppsMarketplace installedSlugs={[]} onInstalled={vi.fn()} onClose={() => {}} />);

    const installButtons = await screen.findAllByRole('button', { name: 'Install' });
    fireEvent.click(installButtons[0]);
    expect(await screen.findByTestId('appmkt-error')).toHaveTextContent('clone failed');
  });
});

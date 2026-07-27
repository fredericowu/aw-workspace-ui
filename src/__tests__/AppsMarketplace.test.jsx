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
    { id: 'git', name: 'Git + GitHub CLI', description: 'git & gh', icon: 'git-branch', repo: 'tekflox/aw-app-git', ref: 'master', has_config: true, tags: ['git', 'github'] },
    { id: 'essentials', name: 'Essentials', description: 'cli tools', icon: 'terminal', repo: 'tekflox/aw-app-essentials', ref: 'master', has_config: false, tags: ['cli', 'networking'] },
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

  it('filters apps by name, description, and tag as the user types', async () => {
    fetchCatalog.mockResolvedValue(CATALOG);
    render(<AppsMarketplace installedSlugs={[]} onInstalled={vi.fn()} onClose={() => {}} />);
    await screen.findByText('Git + GitHub CLI');

    const search = screen.getByLabelText('Search apps');

    // match by name
    fireEvent.change(search, { target: { value: 'github' } });
    expect(screen.getByText('Git + GitHub CLI')).toBeInTheDocument();
    expect(screen.queryByText('Essentials')).not.toBeInTheDocument();

    // match by description (case-insensitive, partial)
    fireEvent.change(search, { target: { value: 'CLI TOOLS' } });
    expect(screen.getByText('Essentials')).toBeInTheDocument();
    expect(screen.queryByText('Git + GitHub CLI')).not.toBeInTheDocument();

    // match by tag
    fireEvent.change(search, { target: { value: 'networking' } });
    expect(screen.getByText('Essentials')).toBeInTheDocument();
    expect(screen.queryByText('Git + GitHub CLI')).not.toBeInTheDocument();

    // no match -> empty state
    fireEvent.change(search, { target: { value: 'nonexistent-xyz' } });
    expect(screen.getByText('nenhum app encontrado')).toBeInTheDocument();

    // clearing restores the full list
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('Git + GitHub CLI')).toBeInTheDocument();
    expect(screen.getByText('Essentials')).toBeInTheDocument();
  });
});

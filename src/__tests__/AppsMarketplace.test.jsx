import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../apps/appsApi', () => ({
  fetchCatalog: vi.fn(),
  installApp: vi.fn(),
  getInstallStatus: vi.fn(),
}));
import { fetchCatalog, installApp, getInstallStatus } from '../apps/appsApi';
import AppsMarketplace from '../components/AppsMarketplace';

const CATALOG = {
  apps: [
    {
      id: 'git', name: 'Git + GitHub CLI', description: 'git & gh', icon: 'git-branch',
      repo: 'tekflox/aw-app-git', ref: 'master', has_config: true, tags: ['git', 'github'],
      publisher: 'TekFlox', resource_estimate: { cpu: 'low', memory: 'low', disk: 'low' },
      what_you_get: { mcp_tools: [], ui_screens: ['Git & GitHub CLI', 'Git'], commands: ['git', 'gh'] },
    },
    {
      id: 'essentials', name: 'Essentials', description: 'cli tools', icon: 'terminal',
      repo: 'tekflox/aw-app-essentials', ref: 'master', has_config: false, tags: ['cli', 'networking'],
      publisher: 'TekFlox', resource_estimate: { cpu: 'low', memory: 'low', disk: 'low' },
      what_you_get: { mcp_tools: [], ui_screens: [], commands: ['telnet', 'ping', 'curl'] },
    },
  ],
};

describe('AppsMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // default: no background install already in flight for any app (the
    // reload-mid-install resume effect probes every non-installed app).
    getInstallStatus.mockRejectedValue(new Error('no such job'));
  });

  it('lists catalog apps, installs one via the async flow, and polls to completion', async () => {
    fetchCatalog.mockResolvedValue(CATALOG);
    installApp.mockResolvedValue({ app_id: 'git', status: 'installing' });
    // 1st call: the mount-time resume probe (no job yet) → reject (default).
    // 2nd call: the post-install poll → resolves "installed".
    getInstallStatus
      .mockRejectedValueOnce(new Error('no such job'))
      .mockResolvedValue({ app_id: 'git', status: 'installed' });
    const onInstalled = vi.fn();

    render(<AppsMarketplace installedSlugs={['essentials']} onInstalled={onInstalled} onClose={() => {}} />);

    // both catalog apps listed
    expect(await screen.findByText('Git + GitHub CLI')).toBeInTheDocument();
    expect(screen.getByText('Essentials')).toBeInTheDocument();
    // already-installed one shows "Installed", not an Install button
    expect(screen.getByText('Installed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    // Install button shows "Installing…" while polling, not a bare error.
    expect(await screen.findByRole('button', { name: 'Installing…' })).toBeInTheDocument();
    await waitFor(() => expect(installApp).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'tekflox/aw-app-git', ref: 'master', app_id: 'git', signed: true }),
    ));
    await waitFor(() => expect(getInstallStatus).toHaveBeenCalledWith('git'));
    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(expect.objectContaining({ id: 'git' })));
  });

  it('does not block on the long install request — shows the real backend error, not "Failed to fetch"', async () => {
    fetchCatalog.mockResolvedValue(CATALOG);
    installApp.mockResolvedValue({ app_id: 'git', status: 'installing' });
    getInstallStatus.mockResolvedValue({ app_id: 'git', status: 'failed', error: 'apt install git gh failed: exit 1' });
    render(<AppsMarketplace installedSlugs={[]} onInstalled={vi.fn()} onClose={() => {}} />);

    const installButtons = await screen.findAllByRole('button', { name: 'Install' });
    fireEvent.click(installButtons[0]);
    expect(await screen.findByTestId('appmkt-error')).toHaveTextContent('apt install git gh failed: exit 1');
  });

  it('surfaces a rejected install call without crashing the panel', async () => {
    fetchCatalog.mockResolvedValue(CATALOG);
    installApp.mockRejectedValue(new Error('clone failed'));
    render(<AppsMarketplace installedSlugs={[]} onInstalled={vi.fn()} onClose={() => {}} />);

    const installButtons = await screen.findAllByRole('button', { name: 'Install' });
    fireEvent.click(installButtons[0]);
    expect(await screen.findByTestId('appmkt-error')).toHaveTextContent('clone failed');
  });

  it('resumes watching an install still in progress after a reload', async () => {
    fetchCatalog.mockResolvedValue(CATALOG);
    getInstallStatus.mockImplementation((slug) => {
      if (slug !== 'git') return Promise.reject(new Error('no such job'));
      return Promise.resolve({ app_id: 'git', status: 'installing' });
    });
    const onInstalled = vi.fn();
    render(<AppsMarketplace installedSlugs={['essentials']} onInstalled={onInstalled} onClose={() => {}} />);

    // no click — the resume effect alone should show "Installing…" for git.
    expect(await screen.findByRole('button', { name: 'Installing…' })).toBeInTheDocument();

    getInstallStatus.mockImplementation((slug) => slug === 'git'
      ? Promise.resolve({ app_id: 'git', status: 'installed' })
      : Promise.reject(new Error('no such job')));
    // the poll loop is on a 2s interval — give it enough real time to tick.
    await waitFor(() => expect(onInstalled).toHaveBeenCalledWith(expect.objectContaining({ id: 'git' })),
      { timeout: 3000 });
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

  it('shows publisher and resource badges on each card', async () => {
    fetchCatalog.mockResolvedValue(CATALOG);
    render(<AppsMarketplace installedSlugs={[]} onInstalled={vi.fn()} onClose={() => {}} />);
    await screen.findByText('Git + GitHub CLI');

    expect(screen.getAllByText('by TekFlox')).toHaveLength(2);
    expect(screen.getAllByLabelText('Resource estimate')).toHaveLength(2);
  });

  it('opens a detailed view on click with publisher, resources, and What you get, then goes back', async () => {
    fetchCatalog.mockResolvedValue(CATALOG);
    render(<AppsMarketplace installedSlugs={['essentials']} onInstalled={vi.fn()} onClose={() => {}} />);
    await screen.findByText('Git + GitHub CLI');

    fireEvent.click(screen.getByText('Git + GitHub CLI'));

    expect(await screen.findByText('What you get')).toBeInTheDocument();
    expect(screen.getByText('by TekFlox')).toBeInTheDocument();
    expect(screen.getByText('git')).toBeInTheDocument();
    expect(screen.getByText('gh')).toBeInTheDocument();
    expect(screen.getAllByText('Git & GitHub CLI').length).toBeGreaterThan(0);
    // essentials was pre-installed, but git wasn't — still shows the Install button
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(screen.queryByText('What you get')).not.toBeInTheDocument();
    expect(screen.getByText('Essentials')).toBeInTheDocument();
  });

  it('shows Installed (not an Install button) in the detail view for an already-installed app', async () => {
    fetchCatalog.mockResolvedValue(CATALOG);
    render(<AppsMarketplace installedSlugs={['essentials']} onInstalled={vi.fn()} onClose={() => {}} />);
    await screen.findByText('Essentials');

    fireEvent.click(screen.getByText('Essentials'));
    expect(await screen.findByText('What you get')).toBeInTheDocument();
    expect(screen.getByLabelText('Essentials installed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });
});

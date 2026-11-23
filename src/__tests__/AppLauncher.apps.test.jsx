import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import { setSuppressKbd } from '../lib/keyboardMode';
import { isVirtualKeyboardTrackpadOpen, openVirtualKeyboardTrackpad, closeVirtualKeyboardTrackpad } from '../lib/virtualKeyboardTrackpad';
import AppLauncher from '../components/AppLauncher';
import { setAppsListRevision } from '../apps/contributionsRevision';
import ErrorBoundary from '../components/ErrorBoundary';

const INSTALLED = [
  { slug: 'git', name: 'Git + GitHub CLI', version: '0.1.0', icon: 'git-branch', signed: true, has_config: true, has_windows: true, config_schema: { properties: { github_token: { type: 'string', 'x-secret': true } } }, frontend: {} },
  { slug: 'essentials', name: 'Essentials', version: '0.1.0', icon: 'terminal', signed: true, has_config: false, has_windows: false, config_schema: {}, frontend: {} },
];

function renderLauncher() {
  return render(
    <AppLauncher
      workspaceApps={[]}
      components={[]}
      onOpenApp={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('AppLauncher — F5 Apps view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear(); // AppLauncher now seeds installed/catalogVersions from the apps cache
  });

  // Regression (Kanban 3cf5bf3b-9510-81c7-ac10-f1a1550ffabe): a poisoned
  // `aw:apps:installed:v1` cache entry (a non-array, e.g. `{}` — see
  // appsApi.js's json() helper, whose fallback on a bad/non-JSON 200 body is
  // `{}`) used to crash straight to the ErrorBoundary fallback the instant
  // AppLauncher mounted, before any network fetch had a chance to run: the
  // cache seeds `installed` synchronously on first render, and
  // `(installed || []).filter(...)` only guards null/undefined, not "truthy
  // non-array". listInstalledApps() never resolving here isolates that
  // synchronous seed render from the live-fetch path.
  it('a poisoned (non-array) installed cache does not crash the launcher to the ErrorBoundary fallback', async () => {
    localStorage.setItem('aw:apps:installed:v1', JSON.stringify({}));
    listInstalledApps.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <ErrorBoundary label="Apps">
        <AppLauncher workspaceApps={[]} components={[]} onOpenApp={vi.fn()} onClose={vi.fn()} />
      </ErrorBoundary>,
    );

    expect(screen.queryByText('Apps unavailable')).not.toBeInTheDocument();
    // A poisoned cache sanitizes to null (same as a true first visit with no
    // cache yet) rather than crashing — the skeleton, not the installed list,
    // since the live fetch here deliberately never resolves.
    expect(await screen.findByTestId('installed-skeleton')).toBeInTheDocument();
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

  // Live UI updates phase 1: the shell-owned Apps menu re-lists in place when
  // liveUiUpdates.js announces a change (install from the CLI / another tab).
  it('re-lists installed apps in place on aw-apps-changed, no reload', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    renderLauncher();
    expect(await screen.findByText('Git + GitHub CLI')).toBeInTheDocument();
    expect(screen.queryByText('Brand New')).toBeNull();

    listInstalledApps.mockResolvedValue([
      ...INSTALLED,
      { slug: 'brand-new', name: 'Brand New', version: '0.1.0', icon: 'plug', signed: true,
        has_config: false, has_windows: true, config_schema: {}, frontend: {} },
    ]);
    window.dispatchEvent(new Event('aw-apps-changed'));
    expect(await screen.findByText('Brand New')).toBeInTheDocument();
  });

  it('keeps re-listing past a lagging worker until X-Apps-Revision matches the announced revision', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    renderLauncher();
    expect(await screen.findByText('Git + GitHub CLI')).toBeInTheDocument();

    const fresh = [...INSTALLED, { slug: 'brand-new', name: 'Brand New', version: '0.1.0', icon: 'plug',
      signed: true, has_config: false, has_windows: true, config_schema: {}, frontend: {} }];
    listInstalledApps
      .mockImplementationOnce(async () => { setAppsListRevision('old'); return INSTALLED; })   // lagging worker
      .mockImplementation(async () => { setAppsListRevision('r2'); return fresh; });          // converged
    window.dispatchEvent(new CustomEvent('aw-apps-changed', { detail: { revision: 'r2' } }));
    expect(await screen.findByText('Brand New', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('an app with category "Tools" shows under the Tools tab, not UI or Runnables', async () => {
    const withTools = [
      ...INSTALLED,
      { slug: 'mcp-tools', name: 'MCP Tools', version: '0.3.1', icon: 'plug', signed: true,
        has_config: true, has_windows: true, category: 'Tools', config_schema: {}, frontend: {} },
      { slug: 'devctl', name: 'DevCtl', version: '0.3.0', icon: 'monitor', signed: true,
        has_config: false, has_windows: true, category: 'Tools', config_schema: {}, frontend: {} },
    ];
    listInstalledApps.mockResolvedValue(withTools);
    renderLauncher();

    // Not under UI (default tab) despite has_windows: true.
    await screen.findByText('Git + GitHub CLI');
    expect(screen.queryByText('MCP Tools')).toBeNull();
    expect(screen.queryByText('DevCtl')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Tools/ }));
    expect(await screen.findByText('MCP Tools')).toBeInTheDocument();
    expect(screen.getByText('DevCtl')).toBeInTheDocument();
    expect(screen.queryByText('Git + GitHub CLI')).toBeNull();
  });

  it('a framework app with category "Service" (singular, as aw-app-proxy ships it) shows under Services', async () => {
    const withService = [
      ...INSTALLED,
      { slug: 'proxy', name: 'AW Proxy', version: '0.1.0', icon: 'shield', signed: true,
        has_config: true, has_windows: true, category: 'Service', config_schema: {}, frontend: {} },
    ];
    listInstalledApps.mockResolvedValue(withService);
    renderLauncher();

    // Not under UI (default tab) despite has_windows: true.
    await screen.findByText('Git + GitHub CLI');
    expect(screen.queryByText('AW Proxy')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Services/ }));
    expect(await screen.findByText('AW Proxy')).toBeInTheDocument();
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
    // Uninstall only remains on the Runnables (command-only) list rows — the
    // UI tab's card view dropped it (gear-only, top-right corner).
    listInstalledApps.mockResolvedValueOnce(INSTALLED).mockResolvedValueOnce([INSTALLED[0]]);
    uninstallApp.mockResolvedValue({ uninstalled: true });
    renderLauncher();

    fireEvent.click(await screen.findByRole('tab', { name: /Runnables/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall Essentials' }));
    await waitFor(() => expect(uninstallApp).toHaveBeenCalledWith('essentials'));
    await waitFor(() => expect(screen.queryByText('Essentials')).toBeNull());
  });

  // The "Install My Apps" button is commented out in AppLauncher.jsx
  // (2026-07-27, per Frederico — it errors and isn't a priority; see
  // Kanban card feature:install-my-apps-fix). Skipped until it's
  // re-enabled, rather than failing CI for an intentionally-disabled
  // feature.
  it.skip('Install My Apps triggers the reconcile flow', async () => {
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

  // ── Cross-category search ────────────────────────────────────────────────
  // The tabs are a browse affordance, not a find one: before this, locating an
  // app meant knowing which of the four buckets it landed in and clicking
  // through them. Typing in the search box has to span ALL categories at once.
  it('typing in the search box lists matches from every category at once', async () => {
    const workspaceApps = [{ id: 'code-server', label: 'VS Code', menu: 'apps', icon: 'code', component: 'code-server' }];
    listInstalledApps.mockResolvedValue([
      ...INSTALLED, // git (UI) + essentials (Runnables)
      { slug: 'mcp-tools', name: 'MCP Tools', version: '0.3.1', icon: 'plug', signed: true, has_config: false, has_windows: true, category: 'Tools', config_schema: {}, frontend: {} },
    ]);
    render(
      <AppLauncher
        workspaceApps={workspaceApps}
        components={[{ key: 'code-server', status: 'running' }]}
        onOpenApp={vi.fn()}
        onOpenInstalledApp={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId('installed-list');

    // A UI-tab app and a Runnables-tab app share the letter "s" — one query,
    // both buckets, no tab clicking.
    fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: 's' } });
    const results = await screen.findByTestId('search-results');
    expect(results).toHaveTextContent('Essentials');   // Runnables
    expect(results).toHaveTextContent('MCP Tools');    // Tools
    expect(results).toHaveTextContent('VS Code');      // Services (legacy aw.json)
    // …and each row says which category it came from, since the tabs are gone.
    expect(results).toHaveTextContent('Runnables');
    expect(results).toHaveTextContent('Tools');
  });

  it('search matches an app by slug, not just by display name', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    renderLauncher();
    await screen.findByTestId('installed-list');

    // "essentials" is both name and slug; use git's slug against a name that
    // doesn't contain it as a standalone token.
    fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: 'git' } });
    const results = await screen.findByTestId('search-results');
    expect(results).toHaveTextContent('Git + GitHub CLI');
    expect(results).not.toHaveTextContent('Essentials');
  });

  // Kanban 3cf5bf3b-9510-8110-a523-d076c49c4663: the search field must be
  // focused as soon as the launcher mounts (AppsNav only mounts it while
  // `open` is true), so the user can type without clicking it first.
  it('autofocuses the search input on mount', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    renderLauncher();
    await screen.findByTestId('installed-list');

    expect(screen.getByLabelText('Search apps')).toHaveFocus();
  });

  it('a query with no match says so, and clearing it restores the tab view', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    renderLauncher();
    await screen.findByTestId('installed-list');

    fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: 'zzzz' } });
    expect(await screen.findByTestId('search-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('installed-list')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByTestId('installed-list')).toBeInTheDocument();
  });

  // ── Keyboard navigation across search results (Kanban 3d05bf3b) ─────────
  // Arrows move a selection across AppSearchResults rows; the selected row
  // has to visually read as "hovered" without a real mouse hover, so the
  // decoration must reuse the exact class AppSearchResults already pairs
  // with :hover — not a new one.
  it('nothing is selected until the first arrow press, and ArrowDown then selects the first result', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    render(
      <AppLauncher
        workspaceApps={[]}
        components={[]}
        onOpenApp={vi.fn()}
        onOpenInstalledApp={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId('installed-list');

    const input = screen.getByLabelText('Search apps');
    fireEvent.change(input, { target: { value: 'git' } });
    const row = await screen.findByRole('button', { name: 'Open Git + GitHub CLI' });

    // Just typed, haven't navigated yet — no row reads as selected.
    expect(row.className).not.toContain('applt-installed-row-selected');

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // Same class AppSearchResults' CSS pairs with :hover for the border-color
    // decoration — reusing the hover token instead of inventing a new one.
    expect(row.className).toContain('applt-installed-row-openable');
    expect(row.className).toContain('applt-installed-row-selected');
    // Keyboard focus never left the search input.
    expect(input).toHaveFocus();
  });

  it('Enter opens the currently-selected search result via the same onOpen a click uses', async () => {
    listInstalledApps.mockResolvedValue(INSTALLED);
    const onOpenInstalledApp = vi.fn();
    render(
      <AppLauncher
        workspaceApps={[]}
        components={[]}
        onOpenApp={vi.fn()}
        onOpenInstalledApp={onOpenInstalledApp}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId('installed-list');

    const input = screen.getByLabelText('Search apps');
    fireEvent.change(input, { target: { value: 'git' } });
    await screen.findByRole('button', { name: 'Open Git + GitHub CLI' });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onOpenInstalledApp).toHaveBeenCalledWith('git');
  });
});

// ── iPhone keyboard suppression (Kanban 3d65bf3b) ──────────────────────────
// Opening the launcher used to autofocus the search field, which on a real
// iPhone raises the OS keyboard over the app grid unasked. While the top-bar
// suppress toggle is on, the field is now never focused and never tappable —
// Frederico's rule is absolute ("enquanto aquele ícone de suppress estiver
// ativo, o teclado do iPhone nunca deve aparecer"), so there is deliberately
// no tap-to-type exception. A non-editable focus proxy takes that focus and
// forwards hardware keystrokes into setQuery.
//
// jsdom proves the MECHANISM is wired — that focus lands on a non-editable
// element, that the field is marked untappable, and that typing still filters.
// It cannot prove the iOS keyboard stays down; only a real device (or a
// Simulator with "Connect Hardware Keyboard" unchecked) can.
describe('AppLauncher — iPhone keyboard suppression', () => {
  function setDevice({ maxTouchPoints, width, height }) {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
    Object.defineProperty(window.screen, 'width', { value: width, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: height, configurable: true });
  }
  const IPHONE = { maxTouchPoints: 5, width: 430, height: 932 };
  const DESKTOP = { maxTouchPoints: 0, width: 2560, height: 1440 };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setDevice(IPHONE);
    setSuppressKbd(true);
    listInstalledApps.mockResolvedValue(INSTALLED);
  });
  afterEach(() => {
    setSuppressKbd(false);
    setDevice(DESKTOP);
  });

  it('mount does not focus the search input — the non-editable proxy takes it instead', async () => {
    // Every element that receives focus from mount onwards. Asserting only the
    // FINAL activeElement is not enough: the focusout bounce would put focus
    // back on the proxy a tick later even if the input had been focused in
    // between — and on a real iPhone that window is long enough for the
    // keyboard to come up. The input must never be focused at all.
    const focused = [];
    const spy = (e) => focused.push(e.target);
    document.addEventListener('focusin', spy, true);
    try {
      renderLauncher();
      await screen.findByTestId('installed-list');

      const input = screen.getByLabelText('Search apps');
      expect(focused).not.toContain(input);
      expect(input).not.toHaveFocus();
      expect(document.activeElement).toHaveAttribute('data-aw-kbd-proxy');
      // …and the field is untappable while suppressed, so a native tap can't
      // hit-test it and focus it behind our back.
      expect(input).toHaveAttribute('data-aw-kbd-untappable', '1');
    } finally {
      document.removeEventListener('focusin', spy, true);
    }
  });

  it('typing on the proxy filters the results, exactly as typing in the field would', async () => {
    renderLauncher();
    await screen.findByTestId('installed-list');

    const proxy = document.querySelector('[data-aw-kbd-proxy]');
    'git'.split('').forEach((key) => fireEvent.keyDown(proxy, { key }));

    const results = await screen.findByTestId('search-results');
    expect(results).toHaveTextContent('Git + GitHub CLI');
    expect(results).not.toHaveTextContent('Essentials');
    // The controlled input's own value tracked setQuery — nothing wrote
    // input.value behind React's back.
    expect(screen.getByLabelText('Search apps')).toHaveValue('git');
    // Backspace drops the last character.
    fireEvent.keyDown(proxy, { key: 'Backspace' });
    await waitFor(() => expect(screen.getByLabelText('Search apps')).toHaveValue('gi'));
  });

  it('Enter on the proxy opens the arrow-selected result via the existing handler', async () => {
    const onOpenInstalledApp = vi.fn();
    render(
      <AppLauncher
        workspaceApps={[]}
        components={[]}
        onOpenApp={vi.fn()}
        onOpenInstalledApp={onOpenInstalledApp}
        onClose={vi.fn()}
      />,
    );
    await screen.findByTestId('installed-list');

    const proxy = document.querySelector('[data-aw-kbd-proxy]');
    'git'.split('').forEach((key) => fireEvent.keyDown(proxy, { key }));
    await screen.findByRole('button', { name: 'Open Git + GitHub CLI' });

    fireEvent.keyDown(proxy, { key: 'ArrowDown' });
    fireEvent.keyDown(proxy, { key: 'Enter' });

    expect(onOpenInstalledApp).toHaveBeenCalledWith('git');
  });

  // Real-device regression (Frederico, on the first cut): suppression made the
  // field completely inert — "ele nem deixa eu entrar no campo de busca, nao
  // consigo buscar". A tap must ACTIVATE search without ever focusing the real
  // input (which is what would raise the OS keyboard), and must put up the
  // in-app keyboard so a touch-only user can actually type.
  it('a tap on the search box silently activates search — NO keyboard of any kind', async () => {
    renderLauncher();
    await screen.findByTestId('installed-list');

    expect(isVirtualKeyboardTrackpadOpen()).toBe(false);
    fireEvent.touchStart(document.querySelector('.applt-search'));

    const input = screen.getByLabelText('Search apps');
    // Focus is on the proxy — the field is active, so a Bluetooth keyboard
    // types straight into it…
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-aw-kbd-proxy'));
    expect(input).not.toHaveFocus();
    expect(input).toHaveAttribute('data-aw-kbd-untappable', '1');
    // …it renders as active rather than looking dead…
    expect(input).toHaveAttribute('data-aw-kbd-active', '1');
    // …and NOTHING is put on screen. Not the OS keyboard (the untappable +
    // never-focused input is what guarantees that), and not the in-app one
    // either: whoever turns suppression on has a hardware keyboard and wants
    // no keyboard UI at all. A previous cut opened this on tap and was wrong.
    expect(isVirtualKeyboardTrackpadOpen()).toBe(false);
  });

  it('a Bluetooth keystroke on the proxy still searches after a tap', async () => {
    renderLauncher();
    await screen.findByTestId('installed-list');

    fireEvent.touchStart(document.querySelector('.applt-search'));
    const proxy = document.querySelector('[data-aw-kbd-proxy]');
    'git'.split('').forEach((key) => fireEvent.keyDown(proxy, { key }));

    const results = await screen.findByTestId('search-results');
    expect(results).toHaveTextContent('Git + GitHub CLI');
    expect(screen.getByLabelText('Search apps')).toHaveValue('git');
    expect(isVirtualKeyboardTrackpadOpen()).toBe(false);
  });

  it('the in-app keyboard types into the search box, not into a terminal behind it', async () => {
    // Two things at once. Primarily: the in-app keyboard must actually type
    // into the search box — without the proxy branch in routeText it finds a
    // non-editable div, isWritableField says no, and NOTHING happens, which is
    // the bug Frederico hit.
    //
    // Secondarily it pins the routing order. resolveTerminalSessionId() falls
    // back to the frontmost terminal window even when nothing terminal-ish has
    // focus, so if the proxy were checked second these keystrokes would be
    // POSTed into whatever shell is open behind the launcher. That fallback
    // needs a [data-aw-session-id] ancestor, which this repo does not render
    // today (it is inherited from the monolith), so the window below is
    // synthetic — it arms a hazard that is currently latent rather than live,
    // and keeps it armed if that attribute ever comes back.
    const termWin = document.createElement('div');
    termWin.setAttribute('data-aw-session-id', 'sess-1');
    const ta = document.createElement('textarea');
    ta.className = 'xterm-helper-textarea';
    termWin.appendChild(ta);
    document.body.appendChild(termWin);
    const writes = [];
    const realFetch = global.fetch;
    global.fetch = (url, opts) => { writes.push([url, opts?.body]); return Promise.resolve({ ok: true }); };

    try {
      renderLauncher();
      await screen.findByTestId('installed-list');
      fireEvent.touchStart(document.querySelector('.applt-search'));
      // Opened DELIBERATELY by the user from the toolbar — the launcher never
      // opens it on its own (see the test above). This pins what happens when
      // someone who wants it on screen types into a suppressed field.
      openVirtualKeyboardTrackpad();
      await waitFor(() => expect(isVirtualKeyboardTrackpadOpen()).toBe(true));

      // Tap g, i, t on the in-app keyboard.
      const root = document.getElementById('aw-virtual-keyboard-trackpad');
      ['g', 'i', 't'].forEach((ch) => {
        const key = [...root.querySelectorAll('button')].find((b) => b.textContent === ch);
        expect(key, `key "${ch}" not found on the in-app keyboard`).toBeTruthy();
        // The in-app keyboard acts on pointerup, not click (makeKey).
        fireEvent.pointerUp(key);
      });

      const results = await screen.findByTestId('search-results');
      expect(results).toHaveTextContent('Git + GitHub CLI');
      expect(screen.getByLabelText('Search apps')).toHaveValue('git');
      // Nothing was written to the terminal session.
      expect(writes.filter(([u]) => String(u).includes('/write'))).toEqual([]);
    } finally {
      global.fetch = realFetch;
      closeVirtualKeyboardTrackpad();
      termWin.remove();
    }
  });

  // Even a direct focus() call on the field — whatever triggers it — is
  // intercepted, which is what covers the mount autofocus and anything added
  // later that reaches for the input.
  it('focusing the input directly is intercepted and lands on the proxy', async () => {
    renderLauncher();
    await screen.findByTestId('installed-list');

    const input = screen.getByLabelText('Search apps');
    input.focus();
    expect(input).not.toHaveFocus();
    expect(document.activeElement).toHaveAttribute('data-aw-kbd-proxy');
  });

  it('with the suppress toggle OFF, the field behaves normally — autofocus and all', async () => {
    setSuppressKbd(false);
    renderLauncher();
    await screen.findByTestId('installed-list');

    const input = screen.getByLabelText('Search apps');
    expect(input).toHaveFocus();
    expect(input).not.toHaveAttribute('data-aw-kbd-untappable');
    expect(document.querySelector('[data-aw-kbd-proxy]')).toBeNull();
  });

  it('unmounting the launcher takes the proxy with it', async () => {
    const { unmount } = renderLauncher();
    await screen.findByTestId('installed-list');
    expect(document.querySelector('[data-aw-kbd-proxy]')).not.toBeNull();

    unmount();
    expect(document.querySelector('[data-aw-kbd-proxy]')).toBeNull();
  });
});

import { useCallback, useEffect, useRef, useState } from 'react';
import AppIcon from './AppIcon';
import InstalledApps from './InstalledApps';
import AppsMarketplace from './AppsMarketplace';
import AppConfigWindow from './AppConfigWindow';
import AppVersionWindow from './AppVersionWindow';
import AppSearchResults from './AppSearchResults';
import { pollInstallStatus } from './AppsMarketplace';
import { listInstalledApps, uninstallApp, installMyApps, fetchCatalog, updateApp } from '../apps/appsApi';
import { markUiRefreshNeeded } from '../apps/uiRefresh';
import { readCachedInstalled, writeCachedInstalled, readCachedCatalog, writeCachedCatalog } from '../apps/appsCache';
import { buildSearchIndex, matchesQuery, sortByRelevance } from '../apps/appSearch';
import { colorForApp } from '../apps/appColor';

function catalogVersionsFrom(catalog) {
  const versions = {};
  (catalog?.apps || []).forEach((a) => { versions[a.id] = a.version; });
  return versions;
}

function installedAppId(app) {
  return app?.slug || app?.id || app?.app_id;
}

/**
 * Full-screen "Mission Control" App Launcher — replaces the old Apps
 * hover-popover with a live-tile grid (ported from the UX-Proto
 * `aw-redesign` prototype's AppLauncher.js, Direção B: Signal Amber pass).
 * Each app is a large tile shaped like a real screen (16:10); running apps
 * get an animated sheen + LIVE badge, stopped apps read dimmed. Data wiring
 * is unchanged — same `workspaceApps`/`components` props AppsNav.jsx always
 * consumed, filtered to menu==='apps' and sorted by `order`, exactly what
 * production has always done.
 *
 * `color` is a per-app tile wash computed locally (production doesn't ship
 * one) — purely decorative, like iOS app icons. Every chrome element
 * (title accent, hover glow, sheen, LIVE badge) stays on the shared amber
 * tokens so the launcher reads as one app, not six differently-branded
 * tiles.
 */

function AppCard({ app, index, onOpen }) {
  const running = app.hasStatus && app.running;
  return (
    <button
      type="button"
      className={`applt-card ${app.hasStatus ? (running ? 'is-running' : 'is-stopped') : ''}`}
      style={{ '--tile': app.color, animationDelay: `${60 + index * 45}ms` }}
      onClick={() => onOpen(app)}
      aria-label={`Open ${app.label}${app.hasStatus && !running ? ' (stopped)' : ''}`}
    >
      <div className="applt-preview">
        <div className="applt-chrome">
          <span className="applt-dot" />
          <span className="applt-dot" />
          <span className="applt-dot" />
        </div>
        <div className="applt-wash" />
        <div className="applt-glyph">
          <AppIcon icon={app.icon} label={app.label} size={40} />
        </div>
        {running && <div className="applt-sheen" />}
        {running ? (
          <span className="applt-live">
            <span className="applt-live-pulse" />
            LIVE
          </span>
        ) : app.hasStatus ? (
          <span className="applt-paused">Stopped</span>
        ) : null}
      </div>
      <div className="applt-meta">
        <span className="applt-icon" style={{ background: app.color }}>
          <AppIcon icon={app.icon} label={app.label} size={16} />
        </span>
        <div className="applt-meta-text">
          <span className="applt-name">{app.label}</span>
          <span className="applt-state">
            {app.hasStatus ? (running ? 'Running now' : 'Tap to launch') : 'Tap to open'}
          </span>
        </div>
      </div>
    </button>
  );
}

export default function AppLauncher({ workspaceApps, components, onOpenApp, onOpenInstalledApp, onClose }) {
  // Framework (decoupled-apps) installed set — separate from the legacy
  // aw.json workspace_apps grid below. Seeded from the last-known
  // localStorage cache (stale-while-revalidate) so the view paints
  // immediately instead of showing a blocking loading state on every open;
  // stays null only on a true first visit with no cache yet.
  const [installed, setInstalled] = useState(() => readCachedInstalled());
  const [installedError, setInstalledError] = useState(null);
  const [rowBusy, setRowBusy] = useState({});
  const [showMarketplace, setShowMarketplace] = useState(false);
  // Slug to pre-select in the Marketplace's detail view — set when "More" is
  // clicked from an app's settings window, so the Marketplace opens straight
  // to that app's listing instead of the catalog grid.
  const [marketplaceAppId, setMarketplaceAppId] = useState(null);
  const [configApp, setConfigApp] = useState(null);
  const [versionApp, setVersionApp] = useState(null);
  const [reconciling, setReconciling] = useState(false);
  // Cross-category search (see AppSearchResults). Non-empty query replaces the
  // active tab's content with one flat list spanning every category, so
  // finding an app never means clicking through all four tabs.
  const [query, setQuery] = useState('');
  // Keyboard selection across the search results (see AppSearchResults) —
  // -1 means "nothing selected yet", which is the state right after typing
  // and before the first ArrowUp/ArrowDown press. Reset below whenever the
  // query changes so a fresh search never starts pre-selected.
  const [selectedResultIndex, setSelectedResultIndex] = useState(-1);
  // Catalog versions, keyed by app id/slug — so the Installed list can show
  // an "Update available" badge without opening the Marketplace panel
  // (app-update-mechanism ADR). Seeded from cache same as `installed`.
  const [catalogVersions, setCatalogVersions] = useState(() => catalogVersionsFrom(readCachedCatalog()));
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // AppsNav only mounts this component while `open` is true, so a mount
  // here IS the launcher becoming visible — autofocus the search field so
  // typing works immediately, no click required.
  const searchInputRef = useRef(null);
  useEffect(() => { searchInputRef.current?.focus(); }, []);
  // Reset the keyboard selection whenever the search text itself changes —
  // adjusted during render (React's recommended pattern for "state derived
  // from a prop/state change") rather than in an effect, which would fire a
  // second, avoidable render.
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setSelectedResultIndex(-1);
  }

  const refreshInstalled = useCallback(async () => {
    try {
      const apps = await listInstalledApps();
      setInstalled(apps);
      writeCachedInstalled(apps);
      setInstalledError(null);
    } catch (e) {
      // A workspace without the apps framework (older backend) just shows the
      // legacy grid — don't surface a scary error, but keep it for diagnostics.
      // Keep whatever was already on screen (cache or a prior fetch) instead
      // of wiping it out on a transient failure.
      setInstalled((prev) => prev ?? []);
      setInstalledError(String(e.message || e));
    }
  }, []);

  // Background revalidate on mount (stale-while-revalidate): `installed` may
  // already be non-null from the cache seed above, so this never blocks the
  // first paint — it just updates state (and the cache) in place once the
  // real GET /api/apps response lands. setState lands inside the async
  // .then/.catch (past the await boundary), so it's never a synchronous
  // cascading render.
  useEffect(() => {
    let mounted = true;
    listInstalledApps()
      .then((apps) => { if (mounted) { setInstalled(apps); writeCachedInstalled(apps); setInstalledError(null); } })
      .catch((e) => { if (mounted) { setInstalled((prev) => prev ?? []); setInstalledError(String(e.message || e)); } });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchCatalog()
      .then((data) => {
        if (!mounted) return;
        setCatalogVersions(catalogVersionsFrom(data));
        writeCachedCatalog(data);
      })
      .catch(() => { /* catalog badge is best-effort — Marketplace surfaces the real error */ });
    return () => { mounted = false; };
  }, []);

  const handleKeyDown = useCallback((e) => {
    // Esc closes the topmost overlay first, then clears an active search, then
    // the launcher — clearing before closing so an Esc aimed at a typo doesn't
    // throw the whole view away.
    if (e.key !== 'Escape') return;
    if (versionApp) setVersionApp(null);
    else if (configApp) setConfigApp(null);
    else if (showMarketplace) setShowMarketplace(false);
    else if (query) setQuery('');
    else onClose();
  }, [onClose, configApp, versionApp, showMarketplace, query]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Install succeeded in the Marketplace panel → refresh installed set. Also
  // flags a pending full-page reload (see ../apps/uiRefresh) when the
  // freshly-(re)installed app's manifest declares requires_ui_refresh — e.g.
  // it just contributed a new top-nav entry the SPA won't mount live.
  //
  // Config is OPT-IN ONLY — never auto-opened here. It used to pop
  // AppConfigWindow automatically for a has_config app, but that also fired
  // from a stale/leftover install job the Marketplace panel resumes on open
  // (the WS/poll "installed" transition in AppsMarketplace.jsx calls this
  // same callback), so a user could see a config window appear on its own a
  // few seconds after just opening the Marketplace, with nothing installed
  // in this session. The gear in InstalledApps.jsx is the only opt-in.
  const onInstalled = useCallback(async (catalogApp) => {
    await refreshInstalled();
    const apps = await listInstalledApps().catch(() => []);
    const fresh = apps.find((a) => installedAppId(a) === catalogApp?.id);
    if (fresh?.requires_ui_refresh) markUiRefreshNeeded();
  }, [refreshInstalled]);

  const onUninstall = useCallback(async (app) => {
    if (rowBusy[app.slug]) return;
    setRowBusy((b) => ({ ...b, [app.slug]: true }));
    try {
      await uninstallApp(app.slug);
      await refreshInstalled();
    } catch (e) {
      setInstalledError(`Uninstall of ${app.name} failed: ${String(e.message || e)}`);
    } finally {
      setRowBusy((b) => ({ ...b, [app.slug]: false }));
    }
  }, [rowBusy, refreshInstalled]);

  const onMarketplaceUninstall = useCallback(async (app) => {
    const slug = installedAppId(app);
    if (!slug || rowBusy[slug]) return;
    setRowBusy((b) => ({ ...b, [slug]: true }));
    try {
      await uninstallApp(slug);
      await refreshInstalled();
    } catch (e) {
      setInstalledError(`Uninstall of ${app.name} failed: ${String(e.message || e)}`);
      throw e;
    } finally {
      setRowBusy((b) => ({ ...b, [slug]: false }));
    }
  }, [rowBusy, refreshInstalled]);

  // Update button on the Installed row — POST /api/apps/{slug}/update, same
  // async job/status contract as install, then refresh the installed list
  // (app-update-mechanism ADR).
  const onUpdate = useCallback(async (app) => {
    if (rowBusy[app.slug]) return;
    setRowBusy((b) => ({ ...b, [app.slug]: true }));
    try {
      await updateApp(app.slug);
      await pollInstallStatus(app.slug, alive);
      await refreshInstalled();
    } catch (e) {
      setInstalledError(`Update of ${app.name} failed: ${String(e.message || e)}`);
    } finally {
      if (alive.current) setRowBusy((b) => ({ ...b, [app.slug]: false }));
    }
  }, [rowBusy, refreshInstalled]);

  const onInstallMyApps = useCallback(async () => {
    if (reconciling) return;
    setReconciling(true);
    try {
      await installMyApps();
      await refreshInstalled();
    } catch (e) {
      setInstalledError(`Install My Apps failed: ${String(e.message || e)}`);
    } finally {
      setReconciling(false);
    }
  }, [reconciling, refreshInstalled]);

  const apps = (workspaceApps || [])
    .filter((a) => a.menu === 'apps')
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
    .map((a) => {
      const status = a.component ? components.find((c) => c.key === a.component)?.status : undefined;
      return {
        id: a.id,
        label: a.label,
        icon: a.icon,
        hasStatus: !!a.component,
        running: status === 'running' || status === 'boot',
        color: colorForApp(a.id),
      };
    });

  const runningCount = apps.filter((a) => a.hasStatus && a.running).length;

  // Category tabs — replace the old "Installed" / "Workspace apps" section
  // split with a single categorized view: UI (framework apps with an
  // interactive window), Services (legacy aw.json workspace_apps, each
  // backed by a docker component — same "component window" the workspace
  // has always opened for these — PLUS any framework app opting in via
  // aw-app.json's top-level "category": "Services", e.g. aw-app-proxy),
  // Runnables (framework command-only apps, e.g. CLIs — nothing to open,
  // no service running), Tools (opt in via "category": "Tools"). A manifest
  // category pulls a framework app out of the has_windows-based UI/Runnables
  // split regardless of has_windows.
  // Singular/plural/case-tolerant — manifests in the wild already disagree
  // ("Service" vs "Services"; aw-app-proxy ships "Service").
  const isCategory = (app, name) => (app.category || '').trim().toLowerCase().replace(/s$/, '') === name;
  const toolsApps = (installed || []).filter((a) => isCategory(a, 'tool'));
  const servicesFrameworkApps = (installed || []).filter((a) => isCategory(a, 'service'));
  const categorizedIds = new Set([...toolsApps, ...servicesFrameworkApps].map((a) => a.slug));
  const uiApps = (installed || []).filter((a) => !!a.has_windows && !categorizedIds.has(a.slug));
  const runnableApps = (installed || []).filter((a) => !a.has_windows && !categorizedIds.has(a.slug));
  const CATEGORIES = [
    { key: 'ui', label: 'UI', count: uiApps.length },
    { key: 'services', label: 'Services', count: apps.length + servicesFrameworkApps.length },
    { key: 'runnables', label: 'Runnables', count: runnableApps.length },
    { key: 'tools', label: 'Tools', count: toolsApps.length },
  ];
  const [category, setCategory] = useState('ui');

  // One flat, searchable view of all four buckets. Built every render off the
  // same arrays the tabs use, so a search result can never disagree with what
  // the tab it came from would have shown.
  const searchIndex = buildSearchIndex({
    uiApps, legacyApps: apps, servicesFrameworkApps, runnableApps, toolsApps,
  });
  const searching = query.trim().length > 0;
  // Same filter+order AppSearchResults renders — computed here too so
  // ArrowUp/ArrowDown can clamp/wrap against the actual on-screen result
  // list. Sorted by relevance so an app named for the query outranks one
  // that only mentions it in a longer description.
  const searchResults = searching
    ? sortByRelevance(searchIndex.filter((e) => matchesQuery(e, query)), query)
    : [];

  const openSearchResult = useCallback((entry) => {
    if (entry.kind === 'legacy') onOpenApp(entry.app.id);
    else if (onOpenInstalledApp) onOpenInstalledApp(entry.app.slug);
  }, [onOpenApp, onOpenInstalledApp]);

  // Arrow keys move the selection across search results (wrapping at either
  // end); Enter opens whatever is currently selected — the same onOpen a
  // click already uses. Scoped to the search input so keyboard focus never
  // has to leave it. Plain function (not useCallback) — it's only ever used
  // as an inline prop below, so there's no stable identity to preserve.
  const handleSearchKeyDown = (e) => {
    if (!searching || searchResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedResultIndex((i) => (i < 0 ? 0 : (i + 1) % searchResults.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedResultIndex((i) => (i < 0 ? searchResults.length - 1 : (i - 1 + searchResults.length) % searchResults.length));
    } else if (e.key === 'Enter' && selectedResultIndex >= 0 && selectedResultIndex < searchResults.length) {
      e.preventDefault();
      const entry = searchResults[selectedResultIndex];
      if (entry.openable) openSearchResult(entry);
    }
  };

  return (
    <>
    <div className="applt-overlay" onClick={onClose}>
      <div className="applt-stage" onClick={(e) => e.stopPropagation()}>
        <header className="applt-head">
          <div className="applt-head-text">
            <h2 className="applt-title">
              Apps
            </h2>
            {apps.length > 0 && (
              <p className="applt-sub">{`${runningCount} running · ${apps.length} available`}</p>
            )}
          </div>
          <div className="applt-head-actions">
            <button
              type="button"
              className="applt-btn applt-btn-primary"
              onClick={() => setShowMarketplace(true)}
            >
              Marketplace
            </button>
            {/* "Install My Apps" (account-registry reconcile) hidden 2026-07-27 per
                Frederico — it errors and isn't a priority. Revisit via the Kanban
                card (feature:install-my-apps-fix). Re-enable by uncommenting.
            <button
              type="button"
              className="applt-btn"
              onClick={onInstallMyApps}
              disabled={reconciling}
              title="Reinstall the apps from your account registry into this workspace"
            >
              {reconciling ? 'Installing…' : 'Install My Apps'}
            </button> */}
            <button type="button" className="applt-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        {/* Category tabs — UI (framework apps with a window), Services
            (legacy workspace_apps, each backed by a docker component, plus
            any framework app opting in via category: "Services"),
            Runnables (framework command-only apps, e.g. CLIs), Tools
            (category: "Tools"). */}
        <div className="applt-catbar">
          <div className="applt-cats" role="tablist" aria-label="App categories">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={!searching && category === c.key}
                className={`applt-cat ${!searching && category === c.key ? 'is-active' : ''}`}
                /* Picking a tab while searching means "show me that bucket" —
                   drop the query rather than leaving a selected tab whose
                   content isn't on screen. */
                onClick={() => { setCategory(c.key); setQuery(''); }}
              >
                {c.label}
                <span className="applt-cat-count">{c.count}</span>
              </button>
            ))}
          </div>
          <div className="applt-search">
            <svg className="applt-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              className="applt-search-input"
              placeholder="Search all apps…"
              aria-label="Search apps"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            {query && (
              <button
                type="button"
                className="applt-search-clear"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                title="Clear"
              >✕</button>
            )}
          </div>
        </div>

        {installedError && (
          <p className="applt-installed-error" data-testid="installed-error">{installedError}</p>
        )}

        {searching && (
          <section className="applt-section">
            <AppSearchResults
              query={query}
              results={searchResults}
              selectedIndex={selectedResultIndex}
              busy={rowBusy}
              catalogVersions={catalogVersions}
              onOpen={openSearchResult}
              onConfig={setConfigApp}
              onVersion={setVersionApp}
              onUninstall={onUninstall}
              onUpdate={onUpdate}
            />
          </section>
        )}

        {!searching && category === 'ui' && (
          <section className="applt-section">
            <InstalledApps
              apps={installed === null ? null : uiApps}
              busy={rowBusy}
              catalogVersions={catalogVersions}
              onOpen={onOpenInstalledApp}
              onConfig={setConfigApp}
              onVersion={setVersionApp}
              onUninstall={onUninstall}
              onUpdate={onUpdate}
              only="visual"
            />
          </section>
        )}

        {!searching && category === 'services' && (
          <section className="applt-section">
            {apps.length > 0 && (
              <div className="applt-grid">
                {apps.map((app, i) => (
                  <AppCard key={app.id} app={app} index={i} onOpen={() => onOpenApp(app.id)} />
                ))}
              </div>
            )}
            {servicesFrameworkApps.length > 0 && (
              <InstalledApps
                apps={servicesFrameworkApps}
                busy={rowBusy}
                catalogVersions={catalogVersions}
                onOpen={onOpenInstalledApp}
                onConfig={setConfigApp}
                onVersion={setVersionApp}
                onUninstall={onUninstall}
                onUpdate={onUpdate}
              />
            )}
          </section>
        )}

        {!searching && category === 'runnables' && (
          <section className="applt-section">
            <InstalledApps
              apps={installed === null ? null : runnableApps}
              busy={rowBusy}
              catalogVersions={catalogVersions}
              onOpen={onOpenInstalledApp}
              onConfig={setConfigApp}
              onVersion={setVersionApp}
              onUninstall={onUninstall}
              onUpdate={onUpdate}
              only="commands"
            />
          </section>
        )}

        {!searching && category === 'tools' && (
          <section className="applt-section">
            <InstalledApps
              apps={installed === null ? null : toolsApps}
              busy={rowBusy}
              catalogVersions={catalogVersions}
              onOpen={onOpenInstalledApp}
              onConfig={setConfigApp}
              onVersion={setVersionApp}
              onUninstall={onUninstall}
              onUpdate={onUpdate}
            />
          </section>
        )}
      </div>
    </div>

      {showMarketplace && (
        <AppsMarketplace
          installedApps={installed}
          onInstalled={onInstalled}
          onUninstall={onMarketplaceUninstall}
          onClose={() => { setShowMarketplace(false); setMarketplaceAppId(null); }}
          initialAppId={marketplaceAppId}
          onOtherReleases={(catalogApp) => {
            const inst = (installed || []).find((a) => installedAppId(a) === catalogApp.id)
              || { slug: catalogApp.id, name: catalogApp.name, version: catalogApp.version };
            setVersionApp(inst);
            setShowMarketplace(false);
            setMarketplaceAppId(null);
          }}
        />
      )}
      {configApp && (
        <AppConfigWindow
          app={configApp}
          onClose={() => setConfigApp(null)}
          onSaved={() => {
            // Keep the window open so the user sees the "Saved" state — but
            // flag a pending reload if this app's settings can change nav/slot
            // contributions (see ../apps/uiRefresh), same as a fresh install.
            if (configApp?.requires_ui_refresh) markUiRefreshNeeded();
          }}
          onMore={() => {
            setMarketplaceAppId(configApp.slug);
            setShowMarketplace(true);
            setConfigApp(null);
          }}
        />
      )}
      {versionApp && (
        <AppVersionWindow
          app={versionApp}
          onClose={() => setVersionApp(null)}
          onChanged={() => { refreshInstalled(); setVersionApp(null); }}
        />
      )}
    </>
  );
}

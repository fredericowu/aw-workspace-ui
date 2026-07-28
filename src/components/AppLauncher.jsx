import { useCallback, useEffect, useRef, useState } from 'react';
import AppIcon from './AppIcon';
import InstalledApps from './InstalledApps';
import AppsMarketplace from './AppsMarketplace';
import AppConfigWindow from './AppConfigWindow';
import AppVersionWindow from './AppVersionWindow';
import { pollInstallStatus } from './AppsMarketplace';
import { listInstalledApps, uninstallApp, installMyApps, fetchCatalog, updateApp } from '../apps/appsApi';
import { markUiRefreshNeeded } from '../apps/uiRefresh';
import { readCachedInstalled, writeCachedInstalled, readCachedCatalog, writeCachedCatalog } from '../apps/appsCache';
import { colorForApp } from '../apps/appColor';

function catalogVersionsFrom(catalog) {
  const versions = {};
  (catalog?.apps || []).forEach((a) => { versions[a.id] = a.version; });
  return versions;
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

// Always-present trailing tile — starts a new App Builder claude session
// (same POST /api/app-builder/start flow AppsNav.jsx's "Start building"
// row always triggered), styled like an app card so it reads as "add new"
// inside the same grid instead of a separate control.
function StartBuildingCard({ index, starting, onStart }) {
  return (
    <button
      type="button"
      className={`applt-card applt-card-start ${starting ? 'is-stopped' : ''}`}
      style={{ animationDelay: `${60 + index * 45}ms` }}
      onClick={onStart}
      disabled={starting}
      aria-label="Start building a new app"
    >
      <div className="applt-preview">
        <div className="applt-chrome">
          <span className="applt-dot" />
          <span className="applt-dot" />
          <span className="applt-dot" />
        </div>
        <div className="applt-wash" style={{ '--tile': 'var(--color-launcher-amber)' }} />
        <div className="applt-glyph applt-glyph-plus">+</div>
      </div>
      <div className="applt-meta">
        <span className="applt-icon" style={{ background: 'var(--color-launcher-amber)' }}>
          <span className="applt-icon-fallback">+</span>
        </span>
        <div className="applt-meta-text">
          <span className="applt-name">Start building</span>
          <span className="applt-state">{starting ? 'Starting…' : 'New App Builder session'}</span>
        </div>
      </div>
    </button>
  );
}

export default function AppLauncher({ workspaceApps, components, starting, onOpenApp, onOpenInstalledApp, onStartBuilding, onClose }) {
  // Framework (decoupled-apps) installed set — separate from the legacy
  // aw.json workspace_apps grid below. Seeded from the last-known
  // localStorage cache (stale-while-revalidate) so the view paints
  // immediately instead of showing a blocking loading state on every open;
  // stays null only on a true first visit with no cache yet.
  const [installed, setInstalled] = useState(() => readCachedInstalled());
  const [installedError, setInstalledError] = useState(null);
  const [rowBusy, setRowBusy] = useState({});
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [configApp, setConfigApp] = useState(null);
  const [versionApp, setVersionApp] = useState(null);
  const [reconciling, setReconciling] = useState(false);
  // Catalog versions, keyed by app id/slug — so the Installed list can show
  // an "Update available" badge without opening the Marketplace panel
  // (app-update-mechanism ADR). Seeded from cache same as `installed`.
  const [catalogVersions, setCatalogVersions] = useState(() => catalogVersionsFrom(readCachedCatalog()));
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

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
    // Esc closes the topmost overlay first, then the launcher.
    if (e.key !== 'Escape') return;
    if (versionApp) setVersionApp(null);
    else if (configApp) setConfigApp(null);
    else if (showMarketplace) setShowMarketplace(false);
    else onClose();
  }, [onClose, configApp, versionApp, showMarketplace]);

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
    const fresh = apps.find((a) => a.slug === catalogApp?.id);
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

  return (
    <>
    <div className="applt-overlay" onClick={onClose}>
      <div className="applt-stage" onClick={(e) => e.stopPropagation()}>
        <header className="applt-head">
          <div className="applt-head-text">
            <h2 className="applt-title">
              Apps
            </h2>
            <p className="applt-sub">
              {apps.length ? `${runningCount} running · ${apps.length} available` : 'Install apps from the Marketplace'}
            </p>
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

        {/* Framework (decoupled-apps) installed section — F5. */}
        <section className="applt-section">
          <h3 className="applt-section-title">Installed</h3>
          {installedError && (
            <p className="applt-installed-error" data-testid="installed-error">{installedError}</p>
          )}
          <InstalledApps
            apps={installed}
            busy={rowBusy}
            catalogVersions={catalogVersions}
            onOpen={onOpenInstalledApp}
            onConfig={setConfigApp}
            onVersion={setVersionApp}
            onUninstall={onUninstall}
            onUpdate={onUpdate}
          />
        </section>

        {/* Legacy aw.json workspace_apps live-tile grid. */}
        <section className="applt-section">
          <h3 className="applt-section-title">Workspace apps</h3>
          {apps.length === 0 ? (
            <p className="applt-empty">No apps registered yet.</p>
          ) : (
            <div className="applt-grid">
              {apps.map((app, i) => (
                <AppCard key={app.id} app={app} index={i} onOpen={() => onOpenApp(app.id)} />
              ))}
              <StartBuildingCard index={apps.length} starting={!!starting} onStart={onStartBuilding} />
            </div>
          )}
        </section>
      </div>
    </div>

      {showMarketplace && (
        <AppsMarketplace
          installedApps={installed || []}
          onInstalled={onInstalled}
          onClose={() => setShowMarketplace(false)}
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

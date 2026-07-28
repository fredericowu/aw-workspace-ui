import { useCallback, useEffect, useRef, useState } from 'react';
import AppIcon from './AppIcon';
import InstalledApps from './InstalledApps';
import AppsMarketplace from './AppsMarketplace';
import AppConfigWindow from './AppConfigWindow';
import { pollInstallStatus } from './AppsMarketplace';
import { listInstalledApps, uninstallApp, installMyApps, fetchCatalog, updateApp } from '../apps/appsApi';
import { markUiRefreshNeeded } from '../apps/uiRefresh';

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

const APP_TILE_PALETTE = ['#6366f1', '#059669', '#ca8a04', '#db2777', '#0284c7', '#7c3aed', '#dc2626', '#0d9488', '#9333ea', '#ea580c'];
function colorForApp(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return APP_TILE_PALETTE[hash % APP_TILE_PALETTE.length];
}

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
  // aw.json workspace_apps grid below. Null while first loading.
  const [installed, setInstalled] = useState(null);
  const [installedError, setInstalledError] = useState(null);
  const [rowBusy, setRowBusy] = useState({});
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [configApp, setConfigApp] = useState(null);
  const [reconciling, setReconciling] = useState(false);
  // Catalog versions, keyed by app id/slug — fetched once so the Installed
  // list can show an "Update available" badge without opening the
  // Marketplace panel (app-update-mechanism ADR).
  const [catalogVersions, setCatalogVersions] = useState({});
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refreshInstalled = useCallback(async () => {
    try {
      const apps = await listInstalledApps();
      setInstalled(apps);
      setInstalledError(null);
    } catch (e) {
      // A workspace without the apps framework (older backend) just shows the
      // legacy grid — don't surface a scary error, but keep it for diagnostics.
      setInstalled([]);
      setInstalledError(String(e.message || e));
    }
  }, []);

  // Fetch on mount. setState lands inside the async .then/.catch (past the
  // await boundary), so it's never a synchronous cascading render.
  useEffect(() => {
    let mounted = true;
    listInstalledApps()
      .then((apps) => { if (mounted) { setInstalled(apps); setInstalledError(null); } })
      .catch((e) => { if (mounted) { setInstalled([]); setInstalledError(String(e.message || e)); } });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchCatalog()
      .then((data) => {
        if (!mounted) return;
        const versions = {};
        (data?.apps || []).forEach((a) => { versions[a.id] = a.version; });
        setCatalogVersions(versions);
      })
      .catch(() => { /* catalog badge is best-effort — Marketplace surfaces the real error */ });
    return () => { mounted = false; };
  }, []);

  const handleKeyDown = useCallback((e) => {
    // Esc closes the topmost overlay first, then the launcher.
    if (e.key !== 'Escape') return;
    if (configApp) setConfigApp(null);
    else if (showMarketplace) setShowMarketplace(false);
    else onClose();
  }, [onClose, configApp, showMarketplace]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Install succeeded in the Marketplace panel → refresh installed set and, for
  // a has_config app, pop its config window so the user can finish setup.
  // Also flags a pending full-page reload (see ../apps/uiRefresh) when the
  // freshly-(re)installed app's manifest declares requires_ui_refresh — e.g.
  // it just contributed a new top-nav entry the SPA won't mount live.
  const onInstalled = useCallback(async (catalogApp) => {
    await refreshInstalled();
    const apps = await listInstalledApps().catch(() => []);
    const fresh = apps.find((a) => a.slug === catalogApp?.id);
    if (fresh?.requires_ui_refresh) markUiRefreshNeeded();
    if (catalogApp?.has_config && fresh) {
      setShowMarketplace(false);
      setConfigApp(fresh);
    }
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
    </>
  );
}

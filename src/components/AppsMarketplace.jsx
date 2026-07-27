// AppsMarketplace — the Marketplace panel opened from the Apps view. Loads the
// catalog (GET /api/apps/-/catalog → the curated tekflox/aw-marketplace
// apps.json) and lists AVAILABLE apps, each with an Install button that runs the
// framework install flow (POST /api/apps/install with the catalog app's
// repo/ref). On success the parent refreshes the installed list and, for a
// has_config app, opens its config window.
import { useEffect, useRef, useState } from 'react';
import AppIcon from './AppIcon';
import { fetchCatalog, installApp, getInstallStatus } from '../apps/appsApi';

const POLL_INTERVAL_MS = 2000;

// Poll GET /api/apps/{slug}/install-status until the background install
// (kicked off by installApp) lands on installed or failed. `alive` is a ref
// so a closed panel / unmounted component stops polling instead of leaking.
function pollInstallStatus(appId, alive) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (!alive.current) return;
      try {
        const status = await getInstallStatus(appId);
        if (!alive.current) return;
        if (status.status === 'installed') { resolve(status); return; }
        if (status.status === 'failed') { reject(new Error(status.error || 'install failed')); return; }
        setTimeout(tick, POLL_INTERVAL_MS);
      } catch (e) {
        reject(e);
      }
    };
    tick();
  });
}

export default function AppsMarketplace({ installedSlugs, onInstalled, onClose }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // slug -> true while installing
  const [query, setQuery] = useState('');
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    let mounted = true;
    fetchCatalog()
      .then((data) => { if (mounted) setCatalog(data); })
      .catch((e) => { if (mounted) setError(String(e.message || e)); });
    return () => { mounted = false; };
  }, []);

  const installed = new Set(installedSlugs || []);

  // Reload mid-install: a background install kicked off before a refresh
  // still runs on the workspace, so on mount check every not-yet-installed
  // catalog app's status and resume watching any that's still "installing"
  // instead of showing a bare Install button as if nothing had happened.
  useEffect(() => {
    if (!catalog) return;
    const pending = (catalog.apps || []).filter((app) => !installed.has(app.id));
    pending.forEach((app) => {
      getInstallStatus(app.id)
        .then((status) => {
          if (!alive.current || status.status !== 'installing') return;
          setBusy((b) => ({ ...b, [app.id]: true }));
          pollInstallStatus(app.id, alive)
            .then(() => { if (alive.current) onInstalled?.(app); })
            .catch((e) => { if (alive.current) setError(`Install of ${app.name} failed: ${String(e.message || e)}`); })
            .finally(() => { if (alive.current) setBusy((b) => ({ ...b, [app.id]: false })); });
        })
        .catch(() => { /* no job / never installed — nothing to resume */ });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const doInstall = async (app) => {
    if (busy[app.id]) return;
    setBusy((b) => ({ ...b, [app.id]: true }));
    setError(null);
    try {
      await installApp({ repo: app.repo, ref: app.ref, app_id: app.id, signed: true });
      await pollInstallStatus(app.id, alive);
      if (alive.current) onInstalled?.(app);
    } catch (e) {
      if (alive.current) setError(`Install of ${app.name} failed: ${String(e.message || e)}`);
    } finally {
      if (alive.current) setBusy((b) => ({ ...b, [app.id]: false }));
    }
  };

  const allApps = catalog?.apps || [];
  const q = query.trim().toLowerCase();
  const apps = q
    ? allApps.filter((app) => {
        const haystack = [app.name, app.description, ...(app.tags || [])].join(' ').toLowerCase();
        return haystack.includes(q);
      })
    : allApps;

  return (
    <div className="appmkt-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Marketplace">
      <div className="appmkt-panel" onClick={(e) => e.stopPropagation()}>
        <header className="appmkt-head">
          <div>
            <h3 className="appmkt-title">Marketplace</h3>
            <p className="appmkt-sub">
              {catalog ? `${allApps.length} apps available` : 'Loading catalog…'}
              {catalog?.stale ? ' · showing cached' : ''}
            </p>
          </div>
          <button type="button" className="appmkt-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {catalog && allApps.length > 0 && (
          <input
            type="search"
            className="appmkt-search"
            placeholder="Search apps by name, description, or tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search apps"
          />
        )}

        {error && <p className="appmkt-error" data-testid="appmkt-error">{error}</p>}

        {catalog && allApps.length === 0 ? (
          <p className="appmkt-empty">No apps in the catalog.</p>
        ) : catalog && apps.length === 0 ? (
          <p className="appmkt-empty">nenhum app encontrado</p>
        ) : (
          <ul className="appmkt-list">
            {apps.map((app) => {
              const isInstalled = installed.has(app.id);
              return (
                <li className="appmkt-item" key={app.id}>
                  <span className="appmkt-icon"><AppIcon icon={app.icon} label={app.name} size={22} /></span>
                  <div className="appmkt-item-text">
                    <span className="appmkt-item-name">
                      {app.name}
                      {app.has_config && <span className="appmkt-badge">config</span>}
                    </span>
                    <span className="appmkt-item-desc">{app.description}</span>
                  </div>
                  {isInstalled ? (
                    <span className="appmkt-installed" aria-label={`${app.name} installed`}>Installed</span>
                  ) : (
                    <button
                      type="button"
                      className="appmkt-install"
                      onClick={() => doInstall(app)}
                      disabled={!!busy[app.id]}
                    >
                      {busy[app.id] ? 'Installing…' : 'Install'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

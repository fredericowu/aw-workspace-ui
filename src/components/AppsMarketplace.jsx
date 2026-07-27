// AppsMarketplace — the Marketplace panel opened from the Apps view. Loads the
// catalog (GET /api/apps/-/catalog → the curated tekflox/aw-marketplace
// apps.json) and lists AVAILABLE apps, each with an Install button that runs the
// framework install flow (POST /api/apps/install with the catalog app's
// repo/ref). On success the parent refreshes the installed list and, for a
// has_config app, opens its config window.
import { useEffect, useState } from 'react';
import AppIcon from './AppIcon';
import { fetchCatalog, installApp } from '../apps/appsApi';

export default function AppsMarketplace({ installedSlugs, onInstalled, onClose }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // slug -> true while installing

  useEffect(() => {
    let alive = true;
    fetchCatalog()
      .then((data) => { if (alive) setCatalog(data); })
      .catch((e) => { if (alive) setError(String(e.message || e)); });
    return () => { alive = false; };
  }, []);

  const installed = new Set(installedSlugs || []);

  const doInstall = async (app) => {
    if (busy[app.id]) return;
    setBusy((b) => ({ ...b, [app.id]: true }));
    setError(null);
    try {
      await installApp({ repo: app.repo, ref: app.ref, app_id: app.id, signed: true });
      onInstalled?.(app);
    } catch (e) {
      setError(`Install of ${app.name} failed: ${String(e.message || e)}`);
    } finally {
      setBusy((b) => ({ ...b, [app.id]: false }));
    }
  };

  const apps = catalog?.apps || [];

  return (
    <div className="appmkt-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Marketplace">
      <div className="appmkt-panel" onClick={(e) => e.stopPropagation()}>
        <header className="appmkt-head">
          <div>
            <h3 className="appmkt-title">Marketplace</h3>
            <p className="appmkt-sub">
              {catalog ? `${apps.length} apps available` : 'Loading catalog…'}
              {catalog?.stale ? ' · showing cached' : ''}
            </p>
          </div>
          <button type="button" className="appmkt-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {error && <p className="appmkt-error" data-testid="appmkt-error">{error}</p>}

        {catalog && apps.length === 0 ? (
          <p className="appmkt-empty">No apps in the catalog.</p>
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

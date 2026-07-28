// InstalledApps — the framework "installed apps" section of the Apps view
// (ADR F5). Lists apps from GET /api/apps (the decoupled-apps runtime, NOT the
// legacy aw.json workspace_apps grid), each row with a config gear (when
// has_config) and an uninstall control. The Marketplace / Install My Apps
// controls and the config-window/marketplace overlays are owned by the parent
// (AppLauncher) so there's one source of truth for the installed set.
import AppIcon from './AppIcon';

export default function InstalledApps({ apps, busy, onConfig, onUninstall }) {
  if (!apps) {
    return <p className="applt-installed-empty">Loading installed apps…</p>;
  }
  if (apps.length === 0) {
    return (
      <p className="applt-installed-empty" data-testid="installed-empty">
        No apps installed yet. Open the Marketplace to install one.
      </p>
    );
  }
  return (
    <ul className="applt-installed" data-testid="installed-list">
      {apps.map((app) => (
        <li className="applt-installed-row" key={app.slug}>
          <span className="applt-installed-icon"><AppIcon icon={app.icon} label={app.name} size={20} /></span>
          <div className="applt-installed-text">
            <span className="applt-installed-name">
              {app.name}
              {!app.signed && <span className="applt-tag applt-tag-dev" title="side-loaded / unsigned">dev</span>}
            </span>
            <span className="applt-installed-meta">
              {app.slug} · v{app.version}
              {app.frontend?.mode ? ` · ${app.frontend.mode}` : ''}
            </span>
          </div>
          <div className="applt-installed-actions">
            {app.has_config && (
              <button
                type="button"
                className="applt-gear"
                onClick={() => onConfig(app)}
                aria-label={`Configure ${app.name}`}
                title="Settings"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="applt-uninstall"
              onClick={() => onUninstall(app)}
              disabled={!!busy?.[app.slug]}
              aria-label={`Uninstall ${app.name}`}
              title="Uninstall"
            >{busy?.[app.slug] ? '…' : '🗑'}</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

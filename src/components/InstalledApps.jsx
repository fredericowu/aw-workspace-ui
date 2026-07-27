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
              >⚙</button>
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

// InstalledApps — the framework "installed apps" section of the Apps view
// (ADR F5). Lists apps from GET /api/apps (the decoupled-apps runtime, NOT the
// legacy aw.json workspace_apps grid). Visual apps (contributes.windows
// non-empty — a real screen to open, e.g. Git's settings window) render as
// live tiles in a grid up top; command-only apps (system_clis only, no
// window — e.g. Essentials/AWS CLIs) render as a compact list below, since
// there's nothing to "open" for them. Config gear / version / uninstall
// controls are owned here either way. The Marketplace / Install My Apps
// controls and the config-window/marketplace overlays are owned by the parent
// (AppLauncher) so there's one source of truth for the installed set.
import AppIcon from './AppIcon';
import { semverGt } from '../apps/semver';
import { colorForApp } from '../apps/appColor';

// Placeholder rows shown only on a true first visit (no cached `apps` yet) —
// stale-while-revalidate means every subsequent open already has last-known
// data to paint immediately, so this never blocks a return visit.
function InstalledSkeleton() {
  return (
    <ul className="applt-installed" aria-hidden="true" data-testid="installed-skeleton">
      {[0, 1, 2].map((i) => (
        <li className="applt-installed-row applt-installed-row-skeleton" key={i}>
          <span className="applt-installed-icon applt-skeleton-block" />
          <div className="applt-installed-text">
            <span className="applt-skeleton-line applt-skeleton-line-name" />
            <span className="applt-skeleton-line applt-skeleton-line-meta" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// Action buttons shared by both the card grid and the command list — same
// aria-labels/behavior either way, just laid out differently.
function InstalledActions({ app, busy, hasUpdate, catalogVersion, onConfig, onVersion, onUninstall, onUpdate }) {
  return (
    <div className="applt-installed-actions" onClick={(e) => e.stopPropagation()}>
      {hasUpdate && (
        <button
          type="button"
          className="applt-update"
          onClick={() => onUpdate(app)}
          disabled={!!busy?.[app.slug]}
          aria-label={`Update ${app.name}`}
          title={`Update to v${catalogVersion}`}
        >{busy?.[app.slug] ? 'Updating…' : 'Update'}</button>
      )}
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
        className="applt-gear"
        onClick={() => onVersion(app)}
        aria-label={`${app.name} version`}
        title="Version (pin / rollback)"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 8v4l3 3" />
          <path d="M3.05 11a9 9 0 1 1 .5 4" />
          <path d="M3 4v6h6" />
        </svg>
      </button>
      <button
        type="button"
        className="applt-uninstall"
        onClick={() => onUninstall(app)}
        disabled={!!busy?.[app.slug]}
        aria-label={`Uninstall ${app.name}`}
        title="Uninstall"
      >{busy?.[app.slug] ? '…' : '🗑'}</button>
    </div>
  );
}

// Visual app (contributes.windows non-empty) — a live tile, same card
// language as AppLauncher's legacy workspace_apps grid (AppCard) so both
// grids read as one system. No LIVE/Stopped badge yet: GET /api/apps
// doesn't expose a running/process-state signal for framework apps the way
// the legacy workspace_apps + components status does — TODO once the
// runtime surfaces that, wire it in here instead of inventing one.
// Gear-only, top-right corner — pin/rollback (history/clock) and uninstall
// (trash) don't belong on this tile view; both are still reachable via
// Settings → More → the Marketplace app detail (Other Releases / Uninstall).
function InstalledAppCard({ app, busy, hasUpdate, catalogVersion, onOpen, onConfig, onUpdate }) {
  return (
    <div
      className="applt-card applt-installed-card"
      style={{ '--tile': colorForApp(app.slug) }}
      onClick={onOpen ? () => onOpen(app.slug) : undefined}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={`Open ${app.name}`}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(app.slug); } } : undefined}
    >
      <div className="applt-preview">
        <div className="applt-chrome">
          <span className="applt-dot" />
          <span className="applt-dot" />
          <span className="applt-dot" />
        </div>
        {app.has_config && (
          <button
            type="button"
            className="applt-card-gear"
            onClick={(e) => { e.stopPropagation(); onConfig(app); }}
            aria-label={`Configure ${app.name}`}
            title="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
        <div className="applt-wash" />
        <div className="applt-glyph">
          <AppIcon icon={app.icon} label={app.name} size={40} />
        </div>
      </div>
      <div className="applt-meta">
        <span className="applt-icon" style={{ background: colorForApp(app.slug) }}>
          <AppIcon icon={app.icon} label={app.name} size={16} />
        </span>
        <div className="applt-meta-text">
          <span className="applt-name">
            {app.name}
            {!app.signed && <span className="applt-tag applt-tag-dev" title="side-loaded / unsigned">dev</span>}
          </span>
          <span className="applt-state">{onOpen ? 'Tap to launch' : `v${app.version}`}</span>
        </div>
        {hasUpdate && (
          <button
            type="button"
            className="applt-update applt-card-update"
            onClick={(e) => { e.stopPropagation(); onUpdate(app); }}
            disabled={!!busy?.[app.slug]}
            aria-label={`Update ${app.name}`}
            title={`Update to v${catalogVersion}`}
          >{busy?.[app.slug] ? 'Updating…' : 'Update'}</button>
        )}
      </div>
    </div>
  );
}

export default function InstalledApps({ apps, busy, catalogVersions, onOpen, onConfig, onVersion, onUninstall, onUpdate, only = 'all' }) {
  if (!apps) {
    return <InstalledSkeleton />;
  }
  if (apps.length === 0) {
    return (
      <p className="applt-installed-empty" data-testid="installed-empty">
        No apps installed yet. Open the Marketplace to install one.
      </p>
    );
  }

  const visualApps = only === 'commands' ? [] : apps.filter((a) => !!a.has_windows);
  const commandApps = only === 'visual' ? [] : apps.filter((a) => !a.has_windows);

  if (visualApps.length === 0 && commandApps.length === 0) {
    return (
      <p className="applt-installed-empty" data-testid="installed-empty">
        {only === 'visual' ? 'No UI apps installed yet.' : 'No runnable apps installed yet.'}
      </p>
    );
  }

  return (
    <div data-testid="installed-list">
      {visualApps.length > 0 && (
        <div className="applt-grid applt-installed-grid" data-testid="installed-grid">
          {visualApps.map((app) => {
            const catalogVersion = catalogVersions?.[app.slug];
            const hasUpdate = !!catalogVersion && semverGt(catalogVersion, app.version);
            return (
              <InstalledAppCard
                key={app.slug} app={app} busy={busy} hasUpdate={hasUpdate} catalogVersion={catalogVersion}
                onOpen={onOpen} onConfig={onConfig} onUpdate={onUpdate}
              />
            );
          })}
        </div>
      )}
      {commandApps.length > 0 && (
        <ul className="applt-installed applt-installed-commands" data-testid="installed-commands">
          {commandApps.map((app) => {
            const catalogVersion = catalogVersions?.[app.slug];
            const hasUpdate = !!catalogVersion && semverGt(catalogVersion, app.version);
            return (
              <li className="applt-installed-row applt-installed-row-command" key={app.slug}>
                <span className="applt-installed-icon"><AppIcon icon={app.icon} label={app.name} size={20} /></span>
                <div className="applt-installed-text">
                  <span className="applt-installed-name">
                    {app.name}
                    {!app.signed && <span className="applt-tag applt-tag-dev" title="side-loaded / unsigned">dev</span>}
                    {hasUpdate && (
                      <span className="applt-tag applt-tag-update" data-testid={`update-badge-${app.slug}`}>
                        {`Update available v${catalogVersion}`}
                      </span>
                    )}
                  </span>
                  <span className="applt-installed-meta">
                    {app.slug} · v{app.version}
                    {app.frontend?.mode ? ` · ${app.frontend.mode}` : ''}
                  </span>
                </div>
                <InstalledActions
                  app={app} busy={busy} hasUpdate={hasUpdate} catalogVersion={catalogVersion}
                  onConfig={onConfig} onVersion={onVersion} onUninstall={onUninstall} onUpdate={onUpdate}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

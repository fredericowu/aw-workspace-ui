// AppConfigWindow — the modal chrome an app's gear opens (ADR Decision 3b).
// The actual body (schema-driven form / app-authored settings_panel window /
// MCP special cases) lives in AppConfigBody, shared with SettingsPanelNew's
// embedded Apps group so both surfaces render identically.
import AppConfigBody from './AppConfigBody';

export default function AppConfigWindow({ app, onClose, onSaved, onMore }) {
  return (
    <div className="appcfg-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${app.name} settings`}>
      <div className="appcfg-panel" onClick={(e) => e.stopPropagation()}>
        <header className="appcfg-head">
          <div>
            <h3 className="appcfg-title">{app.name} settings</h3>
            <p className="appcfg-sub">{app.slug} · v{app.version}</p>
          </div>
          <div className="appcfg-head-actions">
            {onMore && (
              <button type="button" className="appcfg-more" onClick={onMore}>
                More
              </button>
            )}
            <button type="button" className="appcfg-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>

        <AppConfigBody app={app} onSaved={onSaved} />
      </div>
    </div>
  );
}

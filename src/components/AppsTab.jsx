import { useState, useEffect } from 'react';
import { getAwConfig, saveAwConfig } from '../hooks/useComponentStatus';

/**
 * Settings > Apps — per-app security controls.
 *
 * Lists every workspace_apps entry from aw.json and lets the user
 * flip `auth_required` per app. When ON, the app's subdomain
 * (e.g. hoppscotch.app.dev.tekflox.com) requires a logged-in
 * dev.tekflox.com session — anonymous visitors get bounced through
 * /_aw_auth → /?next=<app URL> and back. When OFF, the app is
 * publicly reachable (anyone with the URL can open it; awserv still
 * seeds the Hoppscotch session cookies so the SPA works).
 *
 * Other per-app config (label, URL, icon, etc.) lives in the AW tab's
 * Apps section. This tab is intentionally narrow so the security
 * toggle is the obvious primary control.
 */

// iPhone-style toggle — kept identical to the one in AwConfigTab.
function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 cursor-pointer ${value ? 'bg-[var(--color-accent)]' : 'bg-white/10'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
    </button>
  );
}

export default function AppsTab() {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [subdomainBase, setSubdomainBase] = useState('app.dev.tekflox.com');

  useEffect(() => {
    getAwConfig().then(cfg => {
      setConfig(cfg);
      // Derive subdomain base from public_url (e.g. "https://dev.tekflox.com" → "app.dev.tekflox.com").
      // The API overlays public_url with the live AW_DOMAIN env var, so this
      // always reflects the running deployment's hostname.
      if (cfg?.public_url) {
        const domain = cfg.public_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (domain) setSubdomainBase(`app.${domain}`);
      }
    });
  }, []);

  const showMessage = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  // Flip auth_required on a single app, then save the whole config so the
  // change persists immediately — no separate "Save" button needed for a
  // toggle. (Matches the iOS-Settings interaction the user asked for.)
  const toggleAuth = async (appId, value) => {
    if (!config || saving) return;
    setSaving(true);
    const next_apps = (config.workspace_apps || []).map((a) =>
      a.id === appId ? { ...a, auth_required: value } : a
    );
    const next_config = { ...config, workspace_apps: next_apps };
    setConfig(next_config);
    try {
      const res = await saveAwConfig(next_config);
      if (res.success) {
        showMessage(value ? `${appId}: authentication required` : `${appId}: public access`);
        window.dispatchEvent(new Event('aw-config-changed'));
      } else {
        showMessage(res.error || 'Save failed');
        // Roll back the optimistic UI on failure so the toggle reflects truth.
        setConfig(config);
      }
    } catch (err) {
      showMessage('Network error');
      setConfig(config);
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <div className="p-6 text-[var(--color-text-muted)]">Loading…</div>;
  }

  const apps = config.workspace_apps || [];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Apps</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Control who can reach each app's subdomain.
            Toggle ON to require a logged-in dev.tekflox.com session;
            OFF removes the login gate (anyone who can reach the app can open it).
          </p>
        </div>
        {message && (
          <span className="text-xs text-[var(--color-text-muted)]">{message}</span>
        )}
      </div>

      {apps.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] italic">
          No workspace apps configured. Add some under AW &rsaquo; Apps.
        </p>
      ) : (
        <div className="border border-[var(--color-border)] rounded overflow-hidden">
          {apps.map((app, i) => {
            const authRequired = app.auth_required ?? true;
            return (
              <div
                key={app.id || i}
                className={`flex items-center justify-between gap-4 px-4 py-3 ${i !== apps.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">
                    {app.label || app.id || `App ${i + 1}`}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)] font-mono mt-0.5">
                    {app.id ? `${app.id}.${subdomainBase}` : '(no id set)'}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] italic mt-0.5">
                    {authRequired
                      ? 'Authentication required — only logged-in users can open this app'
                      : 'Open — no authentication required'}
                  </div>
                </div>
                <Toggle
                  value={authRequired}
                  onChange={(v) => toggleAuth(app.id, v)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

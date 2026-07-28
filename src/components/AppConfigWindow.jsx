// AppConfigWindow — the config/settings window an app's gear opens (ADR
// Decision 3b, declarative mode for the config surface). Builds a form from the
// app's `config_schema` (returned by GET /api/apps): `x-secret` fields render as
// password inputs (routed to the zero-knowledge secret store on the backend),
// `enum` as a select, `integer` as a number. Submit POSTs the whole object to
// the app's own `/api/apps/<slug>/settings` route.
//
// Kept self-contained (no WindowManager coupling) — the Apps view renders it in
// an overlay, same pattern as the App Launcher.
import { useMemo, useState, useEffect } from 'react';
import { apiFetch } from '../auth';
import { fetchContributions } from '../apps/appsApi';
import AppWindow from './AppWindow';

function fieldType(spec) {
  if (spec['x-secret']) return 'secret';
  if (Array.isArray(spec.enum)) return 'enum';
  if (spec.type === 'integer' || spec.type === 'number') return 'number';
  if (spec.type === 'boolean') return 'boolean';
  return 'text';
}

export default function AppConfigWindow({ app, onClose, onSaved }) {
  const props = useMemo(() => app?.config_schema?.properties || {}, [app]);
  const fields = useMemo(() => Object.entries(props), [props]);

  // App-authored settings UI: if the app's settings_panel references one of its
  // own declarative windows (`{ id, window: "<winId>" }`) instead of the
  // config_schema, render THAT window here instead of the generated form. This
  // is how e.g. the git app puts its one-button "Sign in with GitHub" (+ the
  // token/name/email fields folded under Advanced) into settings, rather than
  // dumping the raw schema form. Falls back to the schema form when no window.
  const [settingsWindowSpec, setSettingsWindowSpec] = useState(null);
  // Gates which of the three bodies (window / generated form / "no settings")
  // renders below — without it, the panel briefly shows "no configurable
  // settings" (the fields.length===0 fallback) and then pops to the real
  // window once fetchContributions resolves, a visible re-layout/restyle
  // flash. Holding a spinner until we KNOW which body applies means the
  // window that does render is already fully resolved, no follow-up jump.
  const [resolving, setResolving] = useState(true);
  useEffect(() => {
    let alive = true;
    fetchContributions()
      .then((c) => {
        if (!alive) return;
        const panel = (c.settings || []).find((s) => s.app === app.slug && s.window);
        if (!panel) return;
        const win = (c.windows || []).find((w) => w.app === app.slug && w.id === panel.window);
        const spec = win?.body?.spec_data;
        if (spec) setSettingsWindowSpec(spec);
      })
      .catch(() => {})
      .finally(() => { if (alive) setResolving(false); });
    return () => { alive = false; };
  }, [app.slug]);

  const [values, setValues] = useState(() => {
    const init = {};
    for (const [key, spec] of Object.entries(props)) {
      if (spec.default !== undefined) init[key] = spec.default;
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const setValue = (key, v) => setValues((prev) => ({ ...prev, [key]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/apps/${encodeURIComponent(app.slug)}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) {
        setMessage({ ok: false, text: body.error || `Save failed (${res.status})` });
      } else {
        setMessage({ ok: true, text: 'Saved' });
        onSaved?.(body);
      }
    } catch (err) {
      setMessage({ ok: false, text: String(err.message || err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="appcfg-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${app.name} settings`}>
      <div className="appcfg-panel" onClick={(e) => e.stopPropagation()}>
        <header className="appcfg-head">
          <div>
            <h3 className="appcfg-title">{app.name} settings</h3>
            <p className="appcfg-sub">{app.slug} · v{app.version}</p>
          </div>
          <button type="button" className="appcfg-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {resolving ? (
          <div className="appcfg-loading" data-testid="appcfg-loading">
            <span className="appcfg-spinner" aria-hidden="true" />
            <span>Loading settings…</span>
          </div>
        ) : settingsWindowSpec ? (
          <div className="appcfg-appwindow"><AppWindow spec={settingsWindowSpec} /></div>
        ) : fields.length === 0 ? (
          <p className="appcfg-empty">This app has no configurable settings.</p>
        ) : (
          <form className="appcfg-form" onSubmit={submit}>
            {fields.map(([key, spec]) => {
              const type = fieldType(spec);
              const id = `appcfg-${key}`;
              return (
                <div className="appcfg-field" key={key}>
                  <label htmlFor={id} className="appcfg-label">
                    {spec.title || key}
                  </label>
                  {spec.description && <p className="appcfg-desc">{spec.description}</p>}
                  {type === 'enum' ? (
                    <select id={id} className="appcfg-input" value={values[key] ?? ''} onChange={(e) => setValue(key, e.target.value)}>
                      {spec.enum.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : type === 'boolean' ? (
                    <input id={id} type="checkbox" checked={!!values[key]} onChange={(e) => setValue(key, e.target.checked)} />
                  ) : (
                    <input
                      id={id}
                      className="appcfg-input"
                      type={type === 'secret' ? 'password' : type === 'number' ? 'number' : 'text'}
                      value={values[key] ?? ''}
                      autoComplete={type === 'secret' ? 'new-password' : 'off'}
                      onChange={(e) => setValue(key, type === 'number' ? Number(e.target.value) : e.target.value)}
                    />
                  )}
                </div>
              );
            })}
            <div className="appcfg-actions">
              {message && (
                <span className={`appcfg-msg ${message.ok ? 'is-ok' : 'is-err'}`} data-testid="appcfg-msg">
                  {message.text}
                </span>
              )}
              <button type="submit" className="appcfg-save" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// AppConfigBody — the chrome-less settings body for one app: schema-driven
// form, or the app's own declarative settings_panel window, or the MCP
// Gateway/MCP Tools special cases. Extracted out of AppConfigWindow so the
// same body can render inside a modal (AppConfigWindow) or embedded inline
// in a sidebar (SettingsPanelNew's Apps group) — see ADR Decision 3b.
import { useMemo, useState, useEffect } from 'react';
import { apiFetch } from '../auth';
import { fetchContributions } from '../apps/appsApi';
import { SOURCES, resolveOptions } from '../lib/configOptions';
import AppWindow from './AppWindow';
import McpGatewayConfigEditor from './McpGatewayConfigEditor';
import McpGatewayNamedConfigs from './McpGatewayNamedConfigs';
import McpGatewayExternalUpstreams from './McpGatewayExternalUpstreams';
import JsonConfigEditor from './JsonConfigEditor';

function fieldType(spec) {
  if (spec['x-secret']) return 'secret';
  if (Array.isArray(spec.enum) || spec['x-options']) return 'enum';
  if (spec.type === 'integer' || spec.type === 'number') return 'number';
  if (spec.type === 'boolean') return 'boolean';
  return 'text';
}

// A saved value that fell out of the resolved list (host unlinked, or an id
// typed before this field had options at all) must survive — shown as its
// own selected option and submitted unchanged, never silently reselected.
function withSavedOption(options, value) {
  if (!value || options.some((o) => o.value === value)) return options;
  return [{ value, label: value }, ...options];
}

// One fetch per distinct `x-options` source per mount, not one per field —
// several fields could name the same source (today only windows-pilot's
// `remote_host_id` does, but the mechanism is shared).
async function resolveFieldOptionsMap(xOptionFields) {
  if (!xOptionFields.length) return {};
  const rowsBySource = new Map();
  const rowsFor = (source) => {
    if (!rowsBySource.has(source)) {
      const fetcher = SOURCES[source];
      rowsBySource.set(source, fetcher ? fetcher() : Promise.resolve(null));
    }
    return rowsBySource.get(source);
  };
  const entries = await Promise.all(xOptionFields.map(async ([key, spec]) => {
    try {
      const rows = await rowsFor(spec['x-options']?.source);
      if (rows == null) return [key, null];
      return [key, await resolveOptions(spec, rows)];
    } catch {
      // A thrown fetch (fetchRemoteHosts on a non-ok response) degrades this
      // one field to a text input — it must not blank the rest of the form.
      return [key, null];
    }
  }));
  return Object.fromEntries(entries);
}

const MANAGED_APP_PROPS = {
  auto_start: {
    type: 'boolean',
    default: true,
    title: 'Auto-start',
    description: 'Start this app automatically when the workspace starts.',
    'x-framework': true,
  },
  auth_required: {
    type: 'boolean',
    default: true,
    title: 'Authentication required',
    description: 'Only signed-in workspace users can open this app.',
    'x-framework': true,
  },
  public: {
    type: 'boolean',
    default: false,
    title: 'Public',
    description: 'Expose this app through the workspace public routing layer.',
    'x-framework': true,
  },
};

function isManagedApp(app) {
  return !!(app?.managed_app || app?.tier === 'container');
}

export default function AppConfigBody({ app, onSaved }) {
  const isMcpGateway = app?.slug === 'mcp-gateway';
  const isMcpTools = app?.slug === 'mcp-tools';
  const props = useMemo(() => {
    const appProps = app?.config_schema?.properties || {};
    if (!isManagedApp(app)) return appProps;
    return { ...MANAGED_APP_PROPS, ...appProps };
  }, [app]);
  const fields = useMemo(() => Object.entries(props), [props]);

  // App-authored settings UI: if the app's settings_panel references one of its
  // own declarative windows (`{ id, window: "<winId>" }`) instead of the
  // config_schema, render THAT window here instead of the generated form.
  // Falls back to the schema form when no window.
  const [settingsWindowSpec, setSettingsWindowSpec] = useState(null);
  // When the app's settings_panel contribution carries `"schema_form":
  // "advanced"`, the generated config_schema form below renders collapsed
  // behind an "Advanced" details element, with the declarative window
  // first — opt-in, so every other app's settings body is unaffected.
  const [advancedSchemaForm, setAdvancedSchemaForm] = useState(false);
  const [fieldOptions, setFieldOptions] = useState({});
  const [resolving, setResolving] = useState(true);
  useEffect(() => {
    let alive = true;
    setResolving(true);
    setSettingsWindowSpec(null);
    setAdvancedSchemaForm(false);
    const contributionsDone = fetchContributions()
      .then((c) => {
        if (!alive) return;
        const panel = (c.settings || []).find((s) => s.app === app.slug && s.window);
        if (!panel) return;
        setAdvancedSchemaForm(panel.schema_form === 'advanced');
        const win = (c.windows || []).find((w) => w.app === app.slug && w.id === panel.window);
        const spec = win?.body?.spec_data;
        if (spec) setSettingsWindowSpec(spec);
      })
      .catch(() => {});
    const xOptionFields = fields.filter(([, spec]) => spec['x-options']);
    const optionsDone = resolveFieldOptionsMap(xOptionFields)
      .then((resolved) => { if (alive) setFieldOptions(resolved); });
    Promise.all([contributionsDone, optionsDone])
      .finally(() => { if (alive) setResolving(false); });
    return () => { alive = false; };
  }, [app.slug, fields]);

  const [values, setValues] = useState(() => {
    const init = {};
    for (const [key, spec] of Object.entries(props)) {
      if (spec.default !== undefined) init[key] = spec.default;
    }
    Object.assign(init, app?.config || {});
    // A locked field (e.g. "public" on a non-standalone managed app) always
    // reads as its default — stale persisted config from before the lock
    // can't override what the disabled toggle shows.
    for (const [key, spec] of Object.entries(props)) {
      if (spec['x-disabled']) init[key] = spec.default;
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
      const slug = encodeURIComponent(app.slug);
      const post = (url, body) => apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let res = await post(`/api/apps/${slug}/config`, { config: values });
      let body = await res.json().catch(() => ({}));
      if (res.status === 404) {
        res = await post(`/api/apps/${slug}/settings`, values);
        body = await res.json().catch(() => ({}));
      }
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

  if (resolving) {
    return (
      <div className="appcfg-loading" data-testid="appcfg-loading">
        <span className="appcfg-spinner" aria-hidden="true" />
        <span>Loading settings…</span>
      </div>
    );
  }

  if (fields.length === 0 && !settingsWindowSpec && !isMcpGateway && !isMcpTools) {
    return <p className="appcfg-empty">This app has no configurable settings.</p>;
  }

  const formBlock = fields.length > 0 && !isMcpTools && (
        <form className="appcfg-form" onSubmit={submit}>
          {fields.map(([key, spec]) => {
            const type = fieldType(spec);
            const id = `appcfg-${key}`;
            const isXOptions = !!spec['x-options'];
            const xOptions = isXOptions ? fieldOptions[key] : null;
            const hasXOptions = Array.isArray(xOptions) && xOptions.length > 0;
            return (
              <div className={`appcfg-field ${type === 'boolean' ? 'appcfg-field-toggle' : ''}`} key={key}>
                {type === 'boolean' ? (
                  <>
                    <div className="appcfg-toggle-copy">
                      <label htmlFor={id} className="appcfg-label">
                        {spec.title || key}
                      </label>
                      {spec.description && <p className="appcfg-desc">{spec.description}</p>}
                    </div>
                    <button
                      type="button"
                      id={id}
                      role="switch"
                      aria-checked={!!values[key]}
                      disabled={!!spec['x-disabled']}
                      title={spec['x-disabled'] ? spec.description : undefined}
                      className={`appcfg-switch ${values[key] ? 'is-on' : ''} ${spec['x-disabled'] ? 'is-locked' : ''}`}
                      onClick={() => { if (!spec['x-disabled']) setValue(key, !values[key]); }}
                    >
                      <span />
                    </button>
                  </>
                ) : (
                  <>
                    <label htmlFor={id} className="appcfg-label">
                      {spec.title || key}
                    </label>
                    {spec.description && <p className="appcfg-desc">{spec.description}</p>}
                    {type === 'enum' && isXOptions && hasXOptions ? (
                      <select id={id} className="appcfg-input" value={values[key] ?? ''} onChange={(e) => setValue(key, e.target.value)}>
                        {!values[key] && <option value="">Select…</option>}
                        {withSavedOption(xOptions, values[key]).map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : type === 'enum' && !isXOptions ? (
                      <select id={id} className="appcfg-input" value={values[key] ?? ''} onChange={(e) => setValue(key, e.target.value)}>
                        {spec.enum.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
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
                  </>
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
  );

  const windowBlock = settingsWindowSpec && (
    <div className="appcfg-appwindow"><AppWindow spec={settingsWindowSpec} appId={app.slug} /></div>
  );

  return (
    <>
      {advancedSchemaForm ? (
        <>
          {windowBlock}
          {formBlock && (
            <details className="appwin-collapsible">
              <summary className="appwin-collapsible-title">Advanced: server configuration</summary>
              <div className="appwin-collapsible-body">{formBlock}</div>
            </details>
          )}
        </>
      ) : (
        <>
          {formBlock}
          {windowBlock}
        </>
      )}
      {isMcpGateway && (
        <>
          <McpGatewayExternalUpstreams />
          <McpGatewayConfigEditor onSaved={onSaved} />
          <McpGatewayNamedConfigs />
        </>
      )}
      {isMcpTools && (
        <JsonConfigEditor app={app} onSaved={onSaved} />
      )}
    </>
  );
}

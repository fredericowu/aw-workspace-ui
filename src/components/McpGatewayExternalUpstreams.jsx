// McpGatewayExternalUpstreams — managed CRUD for hand-registered external MCP
// upstreams (stdio or http), the generic mechanism behind "connect the
// gateway to an external MCP server" — first case: Google Workspace MCP,
// registered through this form with zero Google-specific code here.
//
// Backed by GET/PUT/DELETE /api/apps/mcp-gateway/admin/external-upstreams,
// same-origin like McpGatewayNamedConfigs. A credential is never round-
// tripped: a secret-checked KV row is sent once via the PUT body's `secrets`
// map, and the spec stores the placeholder `${secret:<upstream>-<key>}` —
// GET never returns a value, only that reference.
import { useEffect, useState } from 'react';
import { apiFetch } from '../auth';

const ENDPOINT = '/api/apps/mcp-gateway/admin/external-upstreams';
const ADD_KEY = '__add__';
const SECRET_REF_RE = /^\$\{secret:(.+)\}$/;

let rowSeq = 0;
function newRow(partial = {}) {
  return { id: ++rowSeq, key: '', value: '', secret: false, existingRef: null, replacing: false, ...partial };
}

function specKv(spec) {
  return spec.type === 'http' ? (spec.headers || {}) : (spec.env || {});
}

function rowsFromSpec(spec) {
  return Object.entries(specKv(spec)).map(([key, value]) => {
    const m = SECRET_REF_RE.exec(value);
    return m ? newRow({ key, secret: true, existingRef: value }) : newRow({ key, value });
  });
}

function emptyForm() {
  return { name: '', type: 'stdio', command: '', args: '', url: '', rows: [], enabled: true };
}

function formFromEntry(entry) {
  return {
    name: entry.name,
    type: entry.spec.type,
    command: entry.spec.command || '',
    args: (entry.spec.args || []).join(' '),
    url: entry.spec.url || '',
    rows: rowsFromSpec(entry.spec),
    enabled: entry.enabled !== false,
  };
}

function targetOf(spec) {
  if (spec.type === 'http') return spec.url || '';
  return [spec.command, ...(spec.args || [])].filter(Boolean).join(' ');
}

function statusTone(status) {
  if (status === 'running') return 'is-ok';
  if (status === 'error') return 'is-err';
  return 'is-custom';
}

export default function McpGatewayExternalUpstreams() {
  const [upstreams, setUpstreams] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch(ENDPOINT)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.error) throw new Error(body.error || `Load failed (${res.status})`);
        if (alive) setUpstreams(body.upstreams || []);
      })
      .catch((err) => { if (alive) setMessage({ ok: false, text: String(err.message || err) }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const closeForm = () => { setExpanded(null); setForm(null); setFormError(null); };

  const openAdd = () => {
    if (expanded === ADD_KEY) { closeForm(); return; }
    setExpanded(ADD_KEY);
    setForm(emptyForm());
    setFormError(null);
    setMessage(null);
  };

  const openEdit = (entry) => {
    if (expanded === entry.name) { closeForm(); return; }
    setExpanded(entry.name);
    setForm(formFromEntry(entry));
    setFormError(null);
    setMessage(null);
  };

  const setFormField = (patch) => setForm((f) => ({ ...f, ...patch }));
  const addRow = () => setForm((f) => ({ ...f, rows: [...f.rows, newRow()] }));
  const updateRow = (id, patch) =>
    setForm((f) => ({ ...f, rows: f.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const removeRow = (id) => setForm((f) => ({ ...f, rows: f.rows.filter((r) => r.id !== id) }));

  const save = async () => {
    if (saving || !form) return;
    setFormError(null);
    const cleanName = form.name.trim();
    if (!cleanName) { setFormError('name is required'); return; }

    const spec = { type: form.type };
    if (form.enabled === false) spec.enabled = false;
    if (form.type === 'stdio') {
      if (!form.command.trim()) { setFormError('command is required for a stdio upstream'); return; }
      spec.command = form.command.trim();
      const argList = form.args.split(/\s+/).map((a) => a.trim()).filter(Boolean);
      if (argList.length) spec.args = argList;
    } else {
      if (!form.url.trim()) { setFormError('url is required for an http upstream'); return; }
      spec.url = form.url.trim();
    }

    const kv = {};
    const secrets = {};
    for (const row of form.rows) {
      const key = row.key.trim();
      if (!key) continue;
      if (!row.secret) { kv[key] = row.value; continue; }
      if (row.existingRef && !row.replacing) { kv[key] = row.existingRef; continue; }
      if (!row.value) { setFormError(`enter a value for secret field "${key}", or uncheck "secret"`); return; }
      const secretName = `${cleanName}-${key}`.replace(/[^a-zA-Z0-9_-]/g, '-');
      secrets[secretName] = row.value;
      kv[key] = `\${secret:${secretName}}`;
    }
    if (Object.keys(kv).length) {
      if (form.type === 'http') spec.headers = kv; else spec.env = kv;
    }

    setSaving(true);
    try {
      const res = await apiFetch(`${ENDPOINT}/${encodeURIComponent(cleanName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec, secrets: Object.keys(secrets).length ? secrets : undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.name) throw new Error(body.error || `Save failed (${res.status})`);

      setUpstreams((prev) => {
        const list = (prev || []).filter((u) => u.name !== cleanName);
        return [...list, body].sort((a, b) => a.name.localeCompare(b.name));
      });

      if (body.status === 'error') {
        // Surface the failed start inline, in the still-open form — the
        // main UX win of this endpoint (a bad URL/credential shows up on
        // the save that introduced it, not the next unrelated reload).
        setFormError(body.error || 'Saved, but the upstream failed to start.');
        setExpanded(cleanName);
        setForm(formFromEntry(body));
      } else {
        setMessage({
          ok: true,
          text: body.warning
            ? `Saved — live now. ${body.warning}`
            : 'Saved — live now, no restart needed.',
        });
        closeForm();
      }
    } catch (err) {
      setFormError(String(err.message || err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (name) => {
    try {
      const res = await apiFetch(`${ENDPOINT}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body.error || `Delete failed (${res.status})`);
      setUpstreams((prev) => (prev || []).filter((u) => u.name !== name));
      setPendingDelete(null);
      if (expanded === name) closeForm();
      setMessage({ ok: true, text: `Removed "${name}".` });
    } catch (err) {
      setMessage({ ok: false, text: String(err.message || err) });
    }
  };

  if (loading) {
    return (
      <section className="mcpgw" data-testid="mcpgw-external">
        <div className="appcfg-loading">
          <span className="appcfg-spinner" aria-hidden="true" />
          <span>Loading external upstreams...</span>
        </div>
      </section>
    );
  }

  const names = (upstreams || []).map((u) => u.name);

  return (
    <section className="mcpgw" data-testid="mcpgw-external">
      <div className="mcpgw-head">
        <div>
          <h4>External upstreams ({names.length})</h4>
          <p>
            Hand-registered stdio or http MCP servers this gateway aggregates — the generic mechanism
            behind connecting to any external MCP (e.g. Google Workspace MCP), with credentials stored
            write-only and referenced from the spec as <code>{'${secret:<name>}'}</code>, never shown
            here in the clear.
          </p>
        </div>
        <button type="button" className="mcpgw-token-btn" onClick={openAdd} data-testid="mcpgw-external-add">
          {expanded === ADD_KEY ? 'Cancel' : '+ Add upstream'}
        </button>
      </div>

      {message && (
        <div className={`mcpgw-msg ${message.ok ? 'is-ok' : 'is-err'}`} data-testid="mcpgw-external-msg">
          {message.text}
        </div>
      )}

      {expanded === ADD_KEY && (
        <UpstreamForm
          form={form}
          setFormField={setFormField}
          addRow={addRow}
          updateRow={updateRow}
          removeRow={removeRow}
          save={save}
          cancel={closeForm}
          saving={saving}
          formError={formError}
          isNew
        />
      )}

      {names.length === 0 && expanded !== ADD_KEY && (
        <p className="mcpgw-empty">No external upstreams registered yet.</p>
      )}

      <div className="mcpgw-cfg-list">
        {(upstreams || []).map((entry) => {
          const open = expanded === entry.name;
          return (
            <div className="mcpgw-cfg" key={entry.name}>
              <div className="mcpgw-cfg-head">
                <button type="button" className="mcpgw-cfg-toggle" onClick={() => openEdit(entry)}>
                  <span className={`mcpgw-cfg-caret${open ? ' is-open' : ''}`} aria-hidden="true">▶</span>
                  <span className="mcpgw-row-name">{entry.name}</span>
                  <span className="mcpgw-badge">{entry.spec.type}</span>
                  <span className={`mcpgw-badge ${statusTone(entry.status)}`}>{entry.status}</span>
                  <span className="mcpgw-badge">{entry.tools} tool{entry.tools === 1 ? '' : 's'}</span>
                  {entry.enabled === false && <span className="mcpgw-badge">disabled</span>}
                </button>
                <code className="mcpgw-cfg-endpoint" title={targetOf(entry.spec)}>{targetOf(entry.spec)}</code>
                {pendingDelete === entry.name ? (
                  <>
                    <button type="button" className="mcpgw-token-btn is-danger"
                      onClick={() => confirmDelete(entry.name)}>Confirm</button>
                    <button type="button" className="mcpgw-token-btn"
                      onClick={() => setPendingDelete(null)}>Keep</button>
                  </>
                ) : (
                  <button type="button" className="mcpgw-token-btn is-danger"
                    onClick={() => setPendingDelete(entry.name)}>Delete</button>
                )}
              </div>

              {open && (
                <div className="mcpgw-cfg-body">
                  {entry.error && !formError && (
                    <div className="mcpgw-msg is-err">{entry.error}</div>
                  )}
                  <UpstreamForm
                    form={form}
                    setFormField={setFormField}
                    addRow={addRow}
                    updateRow={updateRow}
                    removeRow={removeRow}
                    save={save}
                    cancel={closeForm}
                    saving={saving}
                    formError={formError}
                    isNew={false}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UpstreamForm({ form, setFormField, addRow, updateRow, removeRow, save, cancel, saving, formError, isNew }) {
  if (!form) return null;
  const kvLabel = form.type === 'http' ? 'headers' : 'env';

  return (
    <div className="mcpgw-cfg-policy is-profile" data-testid="mcpgw-external-form">
      <div className="mcpgw-cfg-field">
        <span className="mcpgw-cfg-field-label">Name</span>
        <input
          type="text"
          value={form.name}
          disabled={!isNew}
          spellCheck="false"
          placeholder="google-workspace"
          onChange={(e) => setFormField({ name: e.target.value })}
        />
      </div>

      <div className="mcpgw-cfg-field">
        <span className="mcpgw-cfg-field-label">Type</span>
        <select value={form.type} onChange={(e) => setFormField({ type: e.target.value })}>
          <option value="stdio">stdio</option>
          <option value="http">http</option>
        </select>
      </div>

      {form.type === 'stdio' ? (
        <>
          <div className="mcpgw-cfg-field">
            <span className="mcpgw-cfg-field-label">Command</span>
            <input type="text" value={form.command} placeholder="uvx" spellCheck="false"
              onChange={(e) => setFormField({ command: e.target.value })} />
          </div>
          <div className="mcpgw-cfg-field">
            <span className="mcpgw-cfg-field-label">Args (space-separated)</span>
            <input type="text" value={form.args} placeholder="workspace-mcp --single-user" spellCheck="false"
              onChange={(e) => setFormField({ args: e.target.value })} />
          </div>
        </>
      ) : (
        <div className="mcpgw-cfg-field">
          <span className="mcpgw-cfg-field-label">URL</span>
          <input type="text" value={form.url} placeholder="https://example.test/mcp" spellCheck="false"
            onChange={(e) => setFormField({ url: e.target.value })} />
        </div>
      )}

      <div className="mcpgw-cfg-field">
        <label className="mcpgw-ext-kv-label">
          <input type="checkbox" checked={form.enabled !== false}
            onChange={(e) => setFormField({ enabled: e.target.checked })} />
          Enabled
        </label>
      </div>

      <div className="mcpgw-cfg-field">
        <span className="mcpgw-cfg-field-label">{kvLabel}</span>
        {form.rows.map((row) => (
          <div className="mcpgw-ext-kv" key={row.id}>
            <input
              className="mcpgw-ext-kv-key"
              type="text"
              placeholder="key"
              value={row.key}
              spellCheck="false"
              onChange={(e) => updateRow(row.id, { key: e.target.value })}
            />
            {row.secret && row.existingRef && !row.replacing ? (
              <>
                <code className="mcpgw-ext-kv-ref" data-testid={`mcpgw-external-ref-${row.key}`}>{row.existingRef}</code>
                <button type="button" className="mcpgw-token-btn"
                  onClick={() => updateRow(row.id, { replacing: true, value: '' })}>
                  Replace value
                </button>
              </>
            ) : (
              <input
                className="mcpgw-ext-kv-value"
                type={row.secret ? 'password' : 'text'}
                placeholder="value"
                value={row.value}
                spellCheck="false"
                onChange={(e) => updateRow(row.id, { value: e.target.value })}
              />
            )}
            <label className="mcpgw-ext-kv-label">
              <input
                type="checkbox"
                checked={row.secret}
                onChange={(e) =>
                  updateRow(row.id, { secret: e.target.checked, replacing: e.target.checked && row.replacing })}
              />
              secret
            </label>
            <button type="button" className="mcpgw-token-btn" onClick={() => removeRow(row.id)}>Remove</button>
          </div>
        ))}
        <button type="button" className="mcpgw-token-btn" onClick={addRow}>
          + Add {form.type === 'http' ? 'header' : 'env var'}
        </button>
      </div>

      {formError && <div className="mcpgw-msg is-err" data-testid="mcpgw-external-form-error">{formError}</div>}

      <div className="appcfg-actions">
        <button type="button" className="appcfg-save" disabled={saving} onClick={save}
          data-testid="mcpgw-external-save">
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className="mcpgw-token-btn" onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}

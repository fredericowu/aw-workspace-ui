import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../auth';

/**
 * Settings > MCP Servers tab.
 *
 * Two views:
 *   List   — all servers with enable toggles and Edit buttons.
 *   Editor — full form for creating or editing a single server.
 *
 * Every write (toggle, save from editor) calls PUT /api/settings/mcp which:
 *   1. Persists src/config/mcp.json to disk.
 *   2. Runs the full agent sync pipeline (generate .mcp.json → .cursor/mcp.json
 *      → Codex → Gemini). No separate "Sync now" needed.
 */

// ─── Primitives ───────────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 cursor-pointer disabled:opacity-40
        ${value ? 'bg-[var(--color-accent)]' : 'bg-white/10'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform
        ${value ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function TypeBadge({ type }) {
  const styles = {
    stdio: 'bg-blue-500/15 text-blue-400',
    http:  'bg-emerald-500/15 text-emerald-400',
    sse:   'bg-purple-500/15 text-purple-400',
  };
  return (
    <span className={`px-1.5 py-0.5 text-[10px] rounded font-mono font-medium
      ${styles[type] || 'bg-white/10 text-[var(--color-text-muted)]'}`}>
      {type ?? 'stdio'}
    </span>
  );
}

function ServerDetail({ cfg }) {
  if (cfg.url) return (
    <span className="text-[11px] text-[var(--color-text-muted)] truncate font-mono">{cfg.url}</span>
  );
  const parts = [cfg.command, ...(cfg.args ?? [])].filter(Boolean);
  return (
    <span className="text-[11px] text-[var(--color-text-muted)] truncate font-mono">{parts.join(' ')}</span>
  );
}

// ─── Live tool inspector ────────────────────────────────────────────────────
// Queries GET /api/settings/mcp/{name}/tools on demand — the backend spawns
// (or POSTs to) the server fresh and calls tools/list right then, so this is
// never cached or read from a static file.

function ParamList({ schema }) {
  const props    = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const names    = Object.keys(props);
  if (names.length === 0) {
    return <p className="text-[11px] text-[var(--color-text-muted)]/60 italic">No parameters</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      {names.map((n) => (
        <div key={n} className="flex items-start gap-1.5 text-[11px]">
          <code className="text-[var(--color-accent)] shrink-0">{n}</code>
          <span className="text-[var(--color-text-muted)] shrink-0">
            {props[n]?.type ?? 'any'}{required.has(n) && <span className="text-[var(--color-danger)]"> *</span>}
          </span>
          {props[n]?.description && (
            <span className="text-[var(--color-text-muted)]/70 truncate">— {props[n].description}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ToolInspector({ name }) {
  const [state, setState] = useState({ status: 'loading', tools: [], error: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', tools: [], error: null });
    try {
      const res = await apiFetch(`/api/settings/mcp/${encodeURIComponent(name)}/tools`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? 'Failed to query tools');
      setState({ status: 'ok', tools: data.tools ?? [], error: null });
    } catch (e) {
      setState({ status: 'error', tools: [], error: e.message });
    }
  }, [name]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mt-2 mb-1 px-3 py-2.5 rounded bg-black/20 border border-[var(--color-border)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium text-[var(--color-text-muted)]">
          Live tools {state.status === 'ok' && `(${state.tools.length})`}
        </span>
        <button type="button" onClick={load}
          className="text-[11px] text-[var(--color-accent)] hover:opacity-80 cursor-pointer">
          ⟳ Refresh
        </button>
      </div>

      {state.status === 'loading' && (
        <p className="text-[11px] text-[var(--color-text-muted)] italic">Querying server for its current tools…</p>
      )}
      {state.status === 'error' && (
        <p className="text-[11px] text-[var(--color-danger)]">{state.error}</p>
      )}
      {state.status === 'ok' && state.tools.length === 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)] italic">Server reported no tools.</p>
      )}
      {state.status === 'ok' && state.tools.length > 0 && (
        <div className="flex flex-col gap-2.5 max-h-72 overflow-y-auto">
          {state.tools.map((t) => (
            <div key={t.name} className="pb-2 border-b border-[var(--color-border)] last:border-0 last:pb-0">
              <div className="flex items-baseline gap-2 mb-0.5">
                <code className="text-xs font-medium text-[var(--color-text-primary)]">{t.name}</code>
              </div>
              {t.description && (
                <p className="text-[11px] text-[var(--color-text-muted)] mb-1">{t.description}</p>
              )}
              <ParamList schema={t.inputSchema} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono, required, autoFocus }) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <label className="block">
      <span className="text-[11px] text-[var(--color-text-muted)] mb-1 block">{label}{required && ' *'}</span>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
          text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]/50
          focus:outline-none focus:border-[var(--color-accent)]/60 transition-colors
          ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

function StringList({ label, items, onChange }) {
  const add    = () => onChange([...items, '']);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const edit   = (i, v) => onChange(items.map((x, idx) => idx === i ? v : x));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <button type="button" onClick={add}
          className="text-[11px] text-[var(--color-accent)] hover:opacity-80 cursor-pointer">+ Add</button>
      </div>
      {items.length === 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)]/50 italic">None</p>
      )}
      <div className="flex flex-col gap-1">
        {items.map((val, i) => (
          <div key={i} className="flex gap-1.5">
            <input type="text" value={val} onChange={(e) => edit(i, e.target.value)}
              placeholder={`arg ${i + 1}`}
              className="flex-1 px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]/50
                focus:outline-none focus:border-[var(--color-accent)]/60 font-mono transition-colors" />
            <button type="button" onClick={() => remove(i)}
              className="px-2 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] cursor-pointer transition-colors">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function KVList({ label, items, onChange, keyPlaceholder = 'KEY', valPlaceholder = 'value', valMono }) {
  const add    = () => onChange([...items, { key: '', val: '' }]);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const edit   = (i, field, v) => onChange(items.map((x, idx) => idx === i ? { ...x, [field]: v } : x));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <button type="button" onClick={add}
          className="text-[11px] text-[var(--color-accent)] hover:opacity-80 cursor-pointer">+ Add</button>
      </div>
      {items.length === 0 && (
        <p className="text-[11px] text-[var(--color-text-muted)]/50 italic">None</p>
      )}
      <div className="flex flex-col gap-1">
        {items.map(({ key, val }, i) => (
          <div key={i} className="flex gap-1.5">
            <input type="text" value={key} onChange={(e) => edit(i, 'key', e.target.value)}
              placeholder={keyPlaceholder}
              className="w-32 shrink-0 px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]/50
                focus:outline-none focus:border-[var(--color-accent)]/60 font-mono transition-colors" />
            <input type="text" value={val} onChange={(e) => edit(i, 'val', e.target.value)}
              placeholder={valPlaceholder}
              className={`flex-1 px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]/50
                focus:outline-none focus:border-[var(--color-accent)]/60 transition-colors
                ${valMono ? 'font-mono' : ''}`} />
            <button type="button" onClick={() => remove(i)}
              className="px-2 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] cursor-pointer transition-colors">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Form state helpers ───────────────────────────────────────────────────────

function cfgToForm(name, cfg) {
  const kvFrom = (obj) =>
    Object.entries(obj ?? {}).map(([key, val]) => ({ key, val: String(val) }));
  return {
    name,
    type:    cfg.type ?? 'stdio',
    enabled: cfg.enabled !== false,
    command: cfg.command ?? '',
    args:    cfg.args ?? [],
    env:     kvFrom(cfg.env),
    cwd:     cfg.cwd ?? '',
    url:     cfg.url ?? '',
    headers: kvFrom(cfg.headers),
  };
}

function formToCfg(form) {
  const kvTo = (items) =>
    Object.fromEntries(items.filter((x) => x.key.trim()).map(({ key, val }) => [key.trim(), val]));
  const cfg = { enabled: form.enabled, type: form.type };
  if (form.type === 'stdio') {
    cfg.command = form.command.trim();
    if (form.args.length)               cfg.args = form.args;
    const env = kvTo(form.env);
    if (Object.keys(env).length)        cfg.env = env;
    if (form.cwd.trim())                cfg.cwd = form.cwd.trim();
  } else {
    cfg.url = form.url.trim();
    const headers = kvTo(form.headers);
    if (Object.keys(headers).length)    cfg.headers = headers;
  }
  return cfg;
}

const blankForm = () => ({
  name: '', type: 'stdio', enabled: true,
  command: '', args: [], env: [], cwd: '',
  url: '', headers: [],
});

// ─── Editor panel ─────────────────────────────────────────────────────────────

function ServerEditor({ form, setForm, isNew, onSave, onCancel, onDelete, saving }) {
  const isStdio  = form.type === 'stdio';
  const nameErr  = !form.name.trim() ? 'Name is required' : null;
  const cmdErr   = isStdio && !form.command.trim() ? 'Command is required' : null;
  const urlErr   = !isStdio && !form.url.trim() ? 'URL is required' : null;
  const canSave  = !nameErr && !cmdErr && !urlErr;
  const f = (field) => (v) => setForm((p) => ({ ...p, [field]: v }));

  return (
    <div className="flex flex-col h-full">
      {/* Editor header */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <button type="button" onClick={onCancel}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors text-xs">
          ← Back
        </button>
        <span className="text-[var(--color-border)]">/</span>
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          {isNew ? 'Add MCP Server' : `Edit: ${form.name}`}
        </span>
      </div>

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 pb-2">
        {/* Name */}
        {isNew
          ? <Field label="Server name" value={form.name} onChange={f('name')}
              placeholder="e.g. my-tool" required autoFocus mono />
          : <div>
              <span className="text-[11px] text-[var(--color-text-muted)] block mb-1">Server name</span>
              <span className="font-mono text-xs text-[var(--color-text-primary)]">{form.name}</span>
            </div>
        }

        {/* Transport type */}
        <div>
          <span className="text-[11px] text-[var(--color-text-muted)] block mb-1">Transport type</span>
          <div className="flex gap-2">
            {['stdio', 'http', 'sse'].map((t) => (
              <button key={t} type="button" onClick={() => f('type')(t)}
                className={`px-3 py-1 text-xs rounded font-mono cursor-pointer transition-colors
                  ${form.type === t
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/40'
                    : 'bg-white/5 text-[var(--color-text-muted)] border border-[var(--color-border)] hover:bg-white/10'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Enabled */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--color-text-muted)]">Enabled</span>
          <Toggle value={form.enabled} onChange={f('enabled')} />
        </div>

        <hr className="border-[var(--color-border)]" />

        {/* stdio fields */}
        {isStdio && <>
          <Field label="Command *" value={form.command} onChange={f('command')}
            placeholder="e.g. npx  or  .venv/aw/bin/python" mono />
          <StringList label="Arguments" items={form.args} onChange={f('args')} />
          <KVList label="Environment variables" items={form.env} onChange={f('env')}
            keyPlaceholder="VAR_NAME" valPlaceholder="value" valMono />
          <Field label="Working directory (cwd)" value={form.cwd} onChange={f('cwd')}
            placeholder="Leave blank to use workspace root" mono />
        </>}

        {/* http / sse fields */}
        {!isStdio && <>
          <Field label="URL *" value={form.url} onChange={f('url')}
            placeholder="https://example.com/wp-json/mcp/v1/mcp" mono />
          <KVList label="Headers" items={form.headers} onChange={f('headers')}
            keyPlaceholder="Authorization" valPlaceholder="Bearer …" valMono />
        </>}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between pt-4 mt-2 border-t border-[var(--color-border)] shrink-0">
        {!isNew
          ? <button type="button" onClick={onDelete}
              className="px-3 py-1.5 text-xs rounded text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 cursor-pointer transition-colors">
              Delete
            </button>
          : <span />
        }
        <div className="flex gap-2">
          <button type="button" onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer transition-colors">
            Cancel
          </button>
          <button type="button" onClick={() => canSave && onSave()} disabled={saving || !canSave}
            className="px-4 py-1.5 text-xs rounded bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30
              text-[var(--color-accent)] cursor-pointer disabled:opacity-50 transition-colors font-medium">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function McpServersTab() {
  const [config,     setConfig]     = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);  // { ok, msg }
  const [error,      setError]      = useState(null);
  const [editor,     setEditor]     = useState(null);  // null = list, else editor state
  const [expanded,   setExpanded]   = useState(null);  // name of server showing live tools, or null

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/settings/mcp');
      setConfig(await res.json());
      setError(null);
    } catch (e) {
      setError(`Failed to load: ${e.message}`);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Persist — saves to disk AND runs agent sync ────────────────────────────
  const persist = useCallback(async (updated) => {
    setSaving(true);
    setSaveStatus(null);
    setError(null);
    try {
      const res = await apiFetch('/api/settings/mcp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.detail ?? 'Save failed');
      }
      const data = await res.json();
      setConfig(updated);
      // Surface sync result from agent sync pipeline.
      const gen  = data?.sync?.generate ?? {};
      const ts   = new Date().toLocaleTimeString();
      const msg  = gen.success
        ? `Saved & synced — ${gen.enabled_count} enabled · ${gen.disabled_count} disabled · ${ts}`
        : `Saved (sync error: ${gen.error}) · ${ts}`;
      setSaveStatus({ ok: gen.success !== false, msg });
      return true;
    } catch (e) {
      setError(e.message);
      await load();
      return false;
    } finally {
      setSaving(false);
    }
  }, [load]);

  // ── Toggle enabled (list view) ─────────────────────────────────────────────
  const handleToggle = useCallback(async (name, value) => {
    if (!config) return;
    const updated = {
      ...config,
      mcpServers: {
        ...config.mcpServers,
        [name]: { ...config.mcpServers[name], enabled: value },
      },
    };
    setConfig(updated); // optimistic
    await persist(updated);
  }, [config, persist]);

  // ── Open editor ───────────────────────────────────────────────────────────
  const openEdit = (name, cfg) =>
    setEditor({ form: cfgToForm(name, cfg), isNew: false, originalName: name });
  const openAdd = () =>
    setEditor({ form: blankForm(), isNew: true, originalName: null });

  // ── Save from editor ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!editor || !config) return;
    const { form, isNew, originalName } = editor;
    const newName = form.name.trim();
    const cfg     = formToCfg(form);

    let servers = { ...config.mcpServers };
    if (!isNew && originalName !== newName) {
      // Rename: preserve position in the list.
      servers = Object.fromEntries(
        Object.entries(servers).map(([k, v]) => k === originalName ? [newName, cfg] : [k, v]),
      );
    } else {
      servers[newName] = cfg;
    }

    const ok = await persist({ ...config, mcpServers: servers });
    if (ok) setEditor(null);
  }, [editor, config, persist]);

  // ── Delete from editor ────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!editor || !config) return;
    const { originalName } = editor;
    if (!window.confirm(`Delete MCP server "${originalName}"?`)) return;
    const servers = { ...config.mcpServers };
    delete servers[originalName];
    const ok = await persist({ ...config, mcpServers: servers });
    if (ok) setEditor(null);
  }, [editor, config, persist]);

  // ── Render ────────────────────────────────────────────────────────────────
  const servers      = config ? Object.entries(config.mcpServers ?? {}) : [];
  const enabledCount = servers.filter(([, c]) => c.enabled !== false).length;

  return (
    <div className="p-4 h-full flex flex-col">

      {/* ── Editor view ── */}
      {editor && (
        <ServerEditor
          form={editor.form}
          setForm={(up) => setEditor((e) => ({
            ...e,
            form: typeof up === 'function' ? up(e.form) : up,
          }))}
          isNew={editor.isNew}
          onSave={handleSave}
          onCancel={() => setEditor(null)}
          onDelete={handleDelete}
          saving={saving}
        />
      )}

      {/* ── List view ── */}
      {!editor && <>
        {/* Header */}
        <div className="flex items-start justify-between mb-3 shrink-0">
          <div>
            <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">MCP Servers</h1>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
              <code className="text-[var(--color-accent)]">src/config/mcp.json</code>
              {' '}→ <code>.mcp.json</code> · <code>.cursor/mcp.json</code> · Codex · Gemini
            </p>
            {config && (
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                {enabledCount} of {servers.length} enabled
              </p>
            )}
          </div>
          <button onClick={openAdd}
            className="px-3 py-1.5 text-xs rounded bg-[var(--color-accent)]/15 hover:bg-[var(--color-accent)]/25
              text-[var(--color-accent)] cursor-pointer transition-colors whitespace-nowrap shrink-0">
            + Add Server
          </button>
        </div>

        {/* Save status */}
        {saveStatus && (
          <div className={`mb-3 px-3 py-2 text-xs rounded border shrink-0
            ${saveStatus.ok
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30'}`}>
            {saveStatus.msg}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-3 px-3 py-2 text-xs rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30 shrink-0">
            {error}
          </div>
        )}

        {/* Server list */}
        <div className="flex-1 overflow-y-auto">
          {!config ? (
            <div className="py-8 text-center text-sm text-[var(--color-text-muted)] italic">Loading…</div>
          ) : servers.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--color-text-muted)] italic border border-dashed border-[var(--color-border)] rounded">
              No servers yet — click <span className="text-[var(--color-accent)]">+ Add Server</span> to create one.
            </div>
          ) : (
            <div className="border border-[var(--color-border)] rounded overflow-hidden divide-y divide-[var(--color-border)]">
              {servers.map(([name, cfg]) => {
                const enabled  = cfg.enabled !== false;
                const isOpen   = expanded === name;
                return (
                  <div key={name}
                    className={enabled ? 'bg-[var(--color-bg-secondary)]' : 'bg-[var(--color-bg-secondary)]/40'}>
                    <div
                      onClick={() => setExpanded(isOpen ? null : name)}
                      className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.03] cursor-pointer">

                      <span className={`text-[10px] text-[var(--color-text-muted)] transition-transform shrink-0
                        ${isOpen ? 'rotate-90' : ''}`}>▸</span>

                      <div className={`flex-1 min-w-0 ${!enabled ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">{name}</span>
                          <TypeBadge type={cfg.type} />
                        </div>
                        <ServerDetail cfg={cfg} />
                      </div>

                      {/* Edit — visible on hover */}
                      <button onClick={(e) => { e.stopPropagation(); openEdit(name, cfg); }}
                        className="opacity-0 group-hover:opacity-100 px-2 py-1 text-[11px] rounded
                          text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
                          hover:bg-white/10 cursor-pointer transition-all whitespace-nowrap">
                        Edit
                      </button>

                      {/* Enable toggle — immediate save + sync */}
                      <div onClick={(e) => e.stopPropagation()}>
                        <Toggle value={enabled} onChange={(v) => handleToggle(name, v)} disabled={saving} />
                      </div>
                    </div>

                    {/* Click-to-expand — live tools/list queried fresh, no cache */}
                    {isOpen && (
                      <div className="px-3 pb-1">
                        <ToolInspector name={name} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className="mt-3 text-[11px] text-[var(--color-text-muted)] shrink-0">
          Saving writes <code>src/config/mcp.json</code> and runs <code>aw agent sync</code> automatically.
        </p>
      </>}
    </div>
  );
}

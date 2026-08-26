// McpGatewayNamedConfigs — the scoped-endpoint editor for the MCP Gateway app.
//
// A "named config" (profile) exposes a SUBSET of the gateway's upstreams at
// `/mcp/<name>`, next to the unscoped `/mcp`. Only that subset appears on
// tools/list, and a call to anything else is rejected — so a client handed the
// crispal endpoint physically cannot reach the rest of the workspace.
//
// Some upstreams carry a further per-profile policy, nested under the upstream
// row it configures (rather than as a separate section) so it reads as "this
// configures the server above":
//   agents-platform — which agents/workflows this profile may run, and which
//                     need Telegram approval first.
//   knowledge base  — which KB index its tools are restricted to.
//   presentations   — which namespace its presentations live in.
//
// Backed by GET/PUT /api/apps/mcp-gateway/admin/configs, which persists to the
// gateway's own gateway.json and applies without a restart.
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth';

const ENDPOINT = '/api/apps/mcp-gateway/admin/configs';

// Comma/space-separated globs <-> array. An empty list means "unrestricted",
// which is expressed by the key being absent, so we drop it rather than
// persisting `[]` (see the gateway's normalize_config_spec).
function parseList(raw) {
  return (raw || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

function joinList(value) {
  return [].concat(value || []).join(', ');
}

function roleMatcher(policyUpstreams, role) {
  const names = new Set(policyUpstreams?.[role] || []);
  return (name) => names.has(name);
}

function GlobField({ label, hint, value, placeholder, tone, onCommit }) {
  // Uncommitted-while-typing (defaultValue + onBlur): re-deriving the array on
  // every keystroke would eat the separator the user is halfway through typing.
  return (
    <label className={`mcpgw-cfg-field${tone ? ` is-${tone}` : ''}`}>
      <span className="mcpgw-cfg-field-label">{label}</span>
      {hint && <span className="mcpgw-cfg-field-hint">{hint}</span>}
      <input
        type="text"
        defaultValue={value}
        placeholder={placeholder}
        spellCheck="false"
        onBlur={(e) => onCommit(e.target.value)}
      />
    </label>
  );
}

function AgentsPolicy({ spec, setKey }) {
  return (
    <div className="mcpgw-cfg-policy">
      <div className="mcpgw-cfg-policy-head">
        <strong>Agents Platform run policy</strong>
        <span>
          Case-insensitive globs for what this profile may run. Comma-separated.
          Empty = unrestricted. Read-only tools are never gated.
        </span>
      </div>
      <GlobField
        label="Allowed agents"
        value={joinList(spec.run_agents_allow)}
        placeholder="* (all agents)"
        onCommit={(raw) => setKey('run_agents_allow', parseList(raw))}
      />
      <GlobField
        label="Allowed workflows"
        value={joinList(spec.run_workflows_allow)}
        placeholder="* (all workflows)"
        onCommit={(raw) => setKey('run_workflows_allow', parseList(raw))}
      />
      <div className="mcpgw-cfg-policy-head">
        <span>
          Require Telegram approval before running. A match blocks the call until you
          approve on your phone; a denial or timeout fails closed. Use <code>*</code> to
          gate everything and list the exceptions below.
        </span>
      </div>
      <GlobField
        label="Agents needing approval"
        value={joinList(spec.run_agents_approval)}
        placeholder="(none)"
        tone="warn"
        onCommit={(raw) => setKey('run_agents_approval', parseList(raw))}
      />
      <GlobField
        label="Workflows needing approval"
        value={joinList(spec.run_workflows_approval)}
        placeholder="(none)"
        tone="warn"
        onCommit={(raw) => setKey('run_workflows_approval', parseList(raw))}
      />
      <div className="mcpgw-cfg-policy-head">
        <span>
          <b>Always allow</b> — runs straight through even when it matches the approval
          globs above. Approval <code>*</code> plus always-allow <code>crispal*</code> reads
          as "everything needs approval except crispal".
        </span>
      </div>
      <GlobField
        label="Agents always allowed"
        value={joinList(spec.run_agents_always_allow)}
        placeholder="(none)"
        tone="ok"
        onCommit={(raw) => setKey('run_agents_always_allow', parseList(raw))}
      />
      <GlobField
        label="Workflows always allowed"
        value={joinList(spec.run_workflows_always_allow)}
        placeholder="(none)"
        tone="ok"
        onCommit={(raw) => setKey('run_workflows_always_allow', parseList(raw))}
      />
    </div>
  );
}

export default function McpGatewayNamedConfigs() {
  const [configs, setConfigs] = useState({});
  const [candidates, setCandidates] = useState([]);
  const [policyUpstreams, setPolicyUpstreams] = useState({});
  const [endpointTemplate, setEndpointTemplate] = useState('http://127.0.0.1:9200/mcp/{name}');
  const [expanded, setExpanded] = useState(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState('');

  const names = useMemo(() => Object.keys(configs).sort(), [configs]);
  const isAgents = roleMatcher(policyUpstreams, 'agents_platform');
  const isKb = roleMatcher(policyUpstreams, 'knowledge_base');
  const isPresentation = roleMatcher(policyUpstreams, 'presentation');

  const absorb = (body) => {
    setConfigs(body.configs || {});
    setCandidates(body.candidates || []);
    setPolicyUpstreams(body.policy_upstreams || {});
    if (body.endpoint_template) setEndpointTemplate(body.endpoint_template);
  };

  useEffect(() => {
    let alive = true;
    apiFetch(ENDPOINT)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.error) throw new Error(body.error || `Load failed (${res.status})`);
        if (alive) absorb(body);
      })
      .catch((err) => { if (alive) setMessage({ ok: false, text: String(err.message || err) }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const mutate = (next) => { setConfigs(next); setDirty(true); setMessage(null); };

  const setKey = (cfgName, key, value) => {
    const spec = { ...(configs[cfgName] || {}) };
    if (Array.isArray(value) ? value.length === 0 : !value) delete spec[key];
    else spec[key] = value;
    mutate({ ...configs, [cfgName]: spec });
  };

  const toggleUpstream = (cfgName, server) => {
    const current = new Set((configs[cfgName]?.upstreams) || []);
    if (current.has(server)) current.delete(server); else current.add(server);
    mutate({ ...configs, [cfgName]: { ...configs[cfgName], upstreams: Array.from(current) } });
  };

  const addConfig = () => {
    const name = newName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!name || configs[name]) return;
    mutate({ ...configs, [name]: { upstreams: [] } });
    setNewName('');
    setAdding(false);
    setExpanded(name);
  };

  // Inline two-step confirm rather than window.confirm(): an app settings panel
  // renders inside an iframe where the native dialogs are suppressed, so a
  // confirm() here silently returns false and the delete never happens.
  const deleteConfig = (name) => {
    const next = { ...configs };
    delete next[name];
    mutate(next);
    setPendingDelete(null);
    if (expanded === name) setExpanded(null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch(ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body.error || `Save failed (${res.status})`);
      absorb(body);
      setDirty(false);
      setMessage({ ok: true, text: 'Saved — scoped endpoints are live now, no restart needed.' });
    } catch (err) {
      setMessage({ ok: false, text: String(err.message || err) });
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      // Clipboard unavailable (non-secure context) — the URL is on screen to select.
    }
  };

  const endpointFor = (name) => endpointTemplate.replace('{name}', name);

  if (loading) {
    return (
      <section className="mcpgw" data-testid="mcpgw-configs">
        <div className="appcfg-loading">
          <span className="appcfg-spinner" aria-hidden="true" />
          <span>Loading scoped endpoints...</span>
        </div>
      </section>
    );
  }

  return (
    <section className="mcpgw" data-testid="mcpgw-configs">
      <div className="mcpgw-head">
        <div>
          <h4>Scoped endpoints ({names.length})</h4>
          <p>
            Each named config exposes a subset of the gateway at <code>/mcp/&#123;name&#125;</code>.
            Only its tools appear on <code>tools/list</code>; a call to anything else is rejected.
          </p>
        </div>
        <button type="button" className="mcpgw-token-btn" onClick={() => setAdding(true)}
          data-testid="mcpgw-config-add">
          + Add config
        </button>
      </div>

      {message && (
        <div className={`mcpgw-msg ${message.ok ? 'is-ok' : 'is-err'}`} data-testid="mcpgw-configs-msg">
          {message.text}
        </div>
      )}

      {adding && (
        <div className="mcpgw-cfg-add">
          <input
            type="text"
            value={newName}
            autoFocus
            spellCheck="false"
            placeholder="config-name (letters, digits, - and _)"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addConfig();
              if (e.key === 'Escape') { setAdding(false); setNewName(''); }
            }}
          />
          <button type="button" className="mcpgw-token-btn" disabled={!newName.trim()} onClick={addConfig}>
            Create
          </button>
          <button type="button" className="mcpgw-token-btn"
            onClick={() => { setAdding(false); setNewName(''); }}>
            Cancel
          </button>
        </div>
      )}

      {names.length === 0 && !adding && (
        <p className="mcpgw-empty">No scoped endpoints yet — everything reaches the full gateway at /mcp.</p>
      )}

      <div className="mcpgw-cfg-list">
        {names.map((name) => {
          const spec = configs[name] || {};
          const selected = spec.upstreams || [];
          const open = expanded === name;
          // Upstreams the config already names but the gateway no longer knows
          // are shown too, so a save can't silently drop them.
          const orphans = selected.filter((s) => !candidates.some((c) => c.name === s));
          const rows = [
            ...candidates,
            ...orphans.map((n) => ({ name: n, type: 'missing', running: false, tools: 0 })),
          ];
          return (
            <div className="mcpgw-cfg" key={name}>
              <div className="mcpgw-cfg-head">
                <button type="button" className="mcpgw-cfg-toggle"
                  onClick={() => setExpanded(open ? null : name)}>
                  <span className={`mcpgw-cfg-caret${open ? ' is-open' : ''}`} aria-hidden="true">▶</span>
                  <span className="mcpgw-row-name">{name}</span>
                  <span className="mcpgw-badge">
                    {selected.length} server{selected.length === 1 ? '' : 's'}
                  </span>
                </button>
                <code className="mcpgw-cfg-endpoint">{endpointFor(name)}</code>
                <button type="button" className="mcpgw-token-btn"
                  onClick={() => copy(endpointFor(name), `ep-${name}`)}>
                  {copied === `ep-${name}` ? 'Copied' : 'Copy URL'}
                </button>
                {pendingDelete === name ? (
                  <>
                    <button type="button" className="mcpgw-token-btn is-danger"
                      onClick={() => deleteConfig(name)}>Confirm</button>
                    <button type="button" className="mcpgw-token-btn"
                      onClick={() => setPendingDelete(null)}>Keep</button>
                  </>
                ) : (
                  <button type="button" className="mcpgw-token-btn is-danger"
                    onClick={() => setPendingDelete(name)}>Delete</button>
                )}
              </div>

              {open && (
                <div className="mcpgw-cfg-body">
                  {rows.length === 0 && (
                    <p className="mcpgw-empty">No upstreams available on this gateway yet.</p>
                  )}
                  {rows.map((c) => {
                    const on = selected.includes(c.name);
                    return (
                      <div className="mcpgw-cfg-upstream" key={c.name}>
                        <div className="mcpgw-cfg-upstream-row">
                          <span className="mcpgw-row-name">{c.name}</span>
                          <span className={`mcpgw-badge${c.type === 'missing' ? ' is-custom' : ''}`}>
                            {c.type === 'missing' ? 'not on this gateway' : c.type}
                          </span>
                          {c.type !== 'missing' && !c.running && (
                            <span className="mcpgw-badge is-custom">down</span>
                          )}
                          <span className="mcpgw-cfg-spacer" />
                          <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label={`${on ? 'Remove' : 'Add'} ${c.name}`}
                            className={`mcpgw-switch${on ? ' is-on' : ''}`}
                            onClick={() => toggleUpstream(name, c.name)}
                          />
                        </div>

                        {on && isAgents(c.name) && (
                          <AgentsPolicy spec={spec} setKey={(k, v) => setKey(name, k, v)} />
                        )}

                        {on && isKb(c.name) && (
                          <div className="mcpgw-cfg-policy">
                            <div className="mcpgw-cfg-policy-head">
                              <strong>Knowledge base index</strong>
                              <span>
                                Restricts this profile's KB tools to one index (or a few,
                                comma-separated). Empty = global.
                              </span>
                            </div>
                            <GlobField
                              label="Index"
                              value={joinList(spec.kb_index)}
                              placeholder="(empty = global)"
                              onCommit={(raw) => {
                                const list = parseList(raw);
                                setKey(name, 'kb_index', list.length <= 1 ? (list[0] || '') : list);
                              }}
                            />
                          </div>
                        )}

                        {on && isPresentation(c.name) && (
                          <div className="mcpgw-cfg-policy">
                            <div className="mcpgw-cfg-policy-head">
                              <strong>Presentation namespace</strong>
                              <span>
                                Presentations this profile creates are tagged with this namespace,
                                and list/update/delete/share/export are restricted to it.
                                Empty = global.
                              </span>
                            </div>
                            <GlobField
                              label="Namespace"
                              value={spec.presentation_namespace || ''}
                              placeholder="(empty = global)"
                              onCommit={(raw) => setKey(name, 'presentation_namespace', raw.trim())}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="appcfg-actions">
        <button type="button" className="appcfg-save" disabled={saving || !dirty} onClick={save}
          data-testid="mcpgw-configs-save">
          {saving ? 'Saving...' : 'Save scoped endpoints'}
        </button>
      </div>
    </section>
  );
}

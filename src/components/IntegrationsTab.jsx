import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth';

function maskKey(key) {
  if (!key) return '';
  return '•'.repeat(Math.min(key.length, 40));
}

/**
 * Workspace API Key — a single shared secret other apps/MCPs present as an
 * X-Api-Key header to authenticate into this workspace (see aw-workspace's
 * src/api/workspace_api_key.py + IdentityGuard). Auto-generated on first
 * boot; only action here is reveal/copy/regenerate — no manual entry.
 */
function WorkspaceApiKeyIntegration() {
  const [key, setKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/settings/workspace-api-key')
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.detail || `Load failed (${res.status})`);
        if (alive) setKey(body.key);
      })
      .catch((e) => { if (alive) setError(String(e.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const copyKey = async () => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — reveal toggle still lets manual copy.
    }
  };

  const regenerate = async () => {
    if (regenerating) return;
    if (!window.confirm('Regenerate the workspace API key? Any app/MCP using the current key will need the new one.')) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await apiFetch('/api/settings/workspace-api-key/regenerate', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.detail || `Regenerate failed (${res.status})`);
      setKey(body.key);
      setVisible(true);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Workspace API Key</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-500/15 text-green-400">
            Auto-generated
          </span>
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Shared secret other apps/MCPs present as an <code>X-Api-Key</code> header to
        authenticate into this workspace — no per-app config needed, they just read it
        directly (env/DB). Regenerating invalidates the previous key immediately.
      </p>

      {error && <div className="text-xs text-red-400">{error}</div>}

      {loading ? (
        <div className="text-xs text-[var(--color-text-muted)]">Loading...</div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
              text-[var(--color-text-primary)] font-mono truncate" data-testid="workspace-api-key-value">
              {visible ? key : maskKey(key)}
            </code>
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              aria-label={visible ? 'Hide API key' : 'Reveal API key'}
            >
              {visible ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              onClick={copyKey}
              className="px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div>
            <button
              onClick={regenerate}
              disabled={regenerating}
              className="px-4 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {regenerating ? 'Regenerating...' : 'Regenerate'}
            </button>
          </div>
        </>
      )}

      <div className="pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">
        Persisted in this workspace's own settings table, and mirrored to <code>AW_WORKSPACE_API_KEY</code>{' '}
        in its <code>.env</code> file on every generate/regenerate — any process outside the
        workspace container (a standalone MCP server, for instance) can read it from there.
      </div>
    </div>
  );
}

// Offered presets for a key's lifetime. The API itself takes an arbitrary
// `expires_in_seconds` (null = never) — these are just the three choices
// worth a click.
const EXPIRY_PRESETS = [
  { label: '1 hour', seconds: 3600 },
  { label: '90 days', seconds: 90 * 24 * 3600 },
  { label: 'Never', seconds: null },
];

const EMPTY_RULE = { app: '', paths: '', methods: '' };

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function rulesToForm(rules) {
  if (!rules || !rules.length) return [{ ...EMPTY_RULE }];
  return rules.map((r) => ({
    app: r.app || '',
    paths: (r.paths || []).join(', '),
    methods: (r.methods || []).join(', '),
  }));
}

function formToRules(form) {
  return form
    .filter((r) => r.app.trim() && splitList(r.paths).length)
    .map((r) => {
      const rule = { app: r.app.trim(), paths: splitList(r.paths) };
      const methods = splitList(r.methods);
      if (methods.length) rule.methods = methods;
      return rule;
    });
}

function expiryLabel(key) {
  if (key.revoked_at) return 'Revoked';
  if (key.expires_at == null) return 'Never expires';
  const left = key.expires_at * 1000 - Date.now();
  if (left <= 0) return 'Expired';
  const hours = left / 3600000;
  return hours < 48 ? `Expires in ${Math.round(hours)}h` : `Expires in ${Math.round(hours / 24)}d`;
}

/**
 * Scoped API keys — the second credential class next to the workspace master
 * key above. A *scope* is a named, reusable set of app-route rules
 * (mount-relative paths, `/tv/*`-style, optionally narrowed to some HTTP
 * methods); a *key* binds to one scope, carries the `awsk_` prefix, has a
 * selectable expiry and revokes instantly. Enforcement is entirely
 * server-side in aw-workspace's IdentityGuard — see
 * docs/design/scoped-api-keys.md.
 *
 * The full token is shown exactly once, right after minting: only its sha256
 * is stored, so a lost token is re-minted, never recovered.
 */
function ScopedApiKeysIntegration() {
  const [scopes, setScopes] = useState([]);
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scopeDraft, setScopeDraft] = useState(null); // null = editor closed
  const [keyDraft, setKeyDraft] = useState(null); // null = dialog closed
  const [minted, setMinted] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (url, opts) => {
    const res = await apiFetch(url, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.detail || `Request failed (${res.status})`);
    return body;
  }, []);

  const load = useCallback(async () => {
    try {
      const [scopeBody, keyBody] = await Promise.all([
        call('/api/settings/api-scopes'),
        call('/api/settings/api-keys'),
      ]);
      setScopes(scopeBody.scopes || []);
      setKeys(keyBody.keys || []);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const saveScope = () => run(async () => {
    const rules = formToRules(scopeDraft.rules);
    if (!scopeDraft.name.trim()) throw new Error('Give the scope a name');
    if (!rules.length) throw new Error('A scope needs at least one rule with an app and a path');
    const payload = { name: scopeDraft.name.trim(), rules };
    if (scopeDraft.id) {
      await call(`/api/settings/api-scopes/${scopeDraft.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await call('/api/settings/api-scopes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    setScopeDraft(null);
  });

  const deleteScope = (scope) => run(async () => {
    if (!window.confirm(`Delete scope "${scope.name}"? Keys bound to it must be deleted first.`)) return;
    await call(`/api/settings/api-scopes/${scope.id}`, { method: 'DELETE' });
  });

  const mintKey = () => run(async () => {
    if (!keyDraft.name.trim()) throw new Error('Give the key a name');
    if (!keyDraft.scope_id) throw new Error('Pick a scope');
    const body = await call('/api/settings/api-keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: keyDraft.name.trim(),
        scope_id: keyDraft.scope_id,
        expires_in_seconds: EXPIRY_PRESETS[keyDraft.expiry].seconds,
      }),
    });
    setKeyDraft(null);
    setMinted(body);
  });

  const revokeKey = (key) => run(async () => {
    if (!window.confirm(`Revoke key "${key.name}"? Any caller using it stops working immediately.`)) return;
    await call(`/api/settings/api-keys/${key.id}/revoke`, { method: 'POST' });
  });

  const deleteKey = (key) => run(async () => {
    if (!window.confirm(`Delete key "${key.name}"? This frees its scope for deletion.`)) return;
    await call(`/api/settings/api-keys/${key.id}`, { method: 'DELETE' });
  });

  const copyToken = async () => {
    if (!minted?.token) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — the token is on screen for manual copy.
    }
  };

  const btn = 'px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]';
  const input = 'px-2 py-1 text-xs rounded bg-white/5 border border-[var(--color-border)] text-[var(--color-text-primary)]';

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 space-y-3"
      data-testid="scoped-api-keys">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">Scoped API Keys</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-500/15 text-blue-400">
          awsk_
        </span>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        A key that can call exactly one set of app routes — sent in the same{' '}
        <code>X-Api-Key</code> header, told apart by its <code>awsk_</code> prefix. Paths are{' '}
        <em>mount-relative</em> (<code>/tv/power</code>, <code>/tv/*</code>): exact match or a
        trailing <code>/*</code>. Scoped keys never reach framework routes, so one can
        never mint another.
      </p>

      {error && <div className="text-xs text-red-400" data-testid="scoped-api-keys-error">{error}</div>}

      {minted && (
        <div className="rounded border border-[var(--color-accent)] bg-white/5 p-3 space-y-2"
          data-testid="minted-token">
          <div className="text-xs text-[var(--color-text-primary)]">
            Copy <strong>{minted.name}</strong> now — this is the only time it is shown.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
              text-[var(--color-text-primary)] font-mono truncate" data-testid="minted-token-value">
              {minted.token}
            </code>
            <button type="button" onClick={copyToken} className={btn}>{copied ? 'Copied' : 'Copy'}</button>
            <button type="button" onClick={() => setMinted(null)} className={btn}>Done</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-[var(--color-text-muted)]">Loading...</div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">Scope definitions</span>
              <button
                type="button"
                className={btn}
                onClick={() => setScopeDraft({ id: null, name: '', rules: [{ ...EMPTY_RULE }] })}
              >
                New scope
              </button>
            </div>
            {!scopes.length && (
              <div className="text-xs text-[var(--color-text-muted)]">No scopes yet.</div>
            )}
            {scopes.map((scope) => (
              <div key={scope.id} className="flex items-start justify-between gap-2 text-xs
                px-2.5 py-1.5 rounded bg-white/5 border border-[var(--color-border)]"
                data-testid={`scope-row-${scope.name}`}>
                <div className="min-w-0">
                  <div className="text-[var(--color-text-primary)] font-medium">{scope.name}</div>
                  <div className="text-[var(--color-text-muted)] font-mono truncate">
                    {(scope.rules || []).map((r) => (
                      `${r.app}: ${(r.paths || []).join(' ')}${r.methods ? ` [${r.methods.join(' ')}]` : ''}`
                    )).join(' · ')}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    className={btn}
                    onClick={() => setScopeDraft({ id: scope.id, name: scope.name, rules: rulesToForm(scope.rules) })}
                    aria-label={`Edit scope ${scope.name}`}
                  >
                    Edit
                  </button>
                  <button type="button" className={btn} onClick={() => deleteScope(scope)}
                    aria-label={`Delete scope ${scope.name}`}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {scopeDraft && (
            <div className="rounded border border-[var(--color-border)] bg-white/5 p-3 space-y-2"
              data-testid="scope-editor">
              <input
                className={`${input} w-full`}
                placeholder="Scope name, e.g. xiaomi-tv"
                aria-label="Scope name"
                value={scopeDraft.name}
                onChange={(e) => setScopeDraft({ ...scopeDraft, name: e.target.value })}
              />
              {scopeDraft.rules.map((rule, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={`${input} w-28`}
                    placeholder="app slug"
                    aria-label={`Rule ${i + 1} app slug`}
                    value={rule.app}
                    onChange={(e) => setScopeDraft({
                      ...scopeDraft,
                      rules: scopeDraft.rules.map((r, j) => (j === i ? { ...r, app: e.target.value } : r)),
                    })}
                  />
                  <input
                    className={`${input} flex-1`}
                    placeholder="/tv/*, /light/power"
                    aria-label={`Rule ${i + 1} paths`}
                    value={rule.paths}
                    onChange={(e) => setScopeDraft({
                      ...scopeDraft,
                      rules: scopeDraft.rules.map((r, j) => (j === i ? { ...r, paths: e.target.value } : r)),
                    })}
                  />
                  <input
                    className={`${input} w-28`}
                    placeholder="methods (all)"
                    aria-label={`Rule ${i + 1} methods`}
                    value={rule.methods}
                    onChange={(e) => setScopeDraft({
                      ...scopeDraft,
                      rules: scopeDraft.rules.map((r, j) => (j === i ? { ...r, methods: e.target.value } : r)),
                    })}
                  />
                </div>
              ))}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={btn}
                  onClick={() => setScopeDraft({ ...scopeDraft, rules: [...scopeDraft.rules, { ...EMPTY_RULE }] })}
                >
                  Add rule
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={saveScope}
                  className="px-4 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {scopeDraft.id ? 'Save scope' : 'Create scope'}
                </button>
                <button type="button" className={btn} onClick={() => setScopeDraft(null)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--color-text-primary)]">Keys</span>
              <button
                type="button"
                className={btn}
                disabled={!scopes.length}
                onClick={() => setKeyDraft({ name: '', scope_id: scopes[0]?.id || '', expiry: 2 })}
              >
                New key
              </button>
            </div>
            {!keys.length && (
              <div className="text-xs text-[var(--color-text-muted)]">No scoped keys yet.</div>
            )}
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between gap-2 text-xs
                px-2.5 py-1.5 rounded bg-white/5 border border-[var(--color-border)]"
                data-testid={`key-row-${key.name}`}>
                <div className="min-w-0">
                  <div className="text-[var(--color-text-primary)] font-medium">
                    {key.name}{' '}
                    <code className="font-mono text-[var(--color-text-muted)]">{key.key_hint}…</code>
                  </div>
                  <div className="text-[var(--color-text-muted)]">
                    {key.scope_name} · {expiryLabel(key)}
                    {key.last_used_at ? ` · last used ${new Date(key.last_used_at * 1000).toLocaleString()}` : ' · never used'}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {!key.revoked_at && (
                    <button type="button" className={btn} onClick={() => revokeKey(key)}
                      aria-label={`Revoke key ${key.name}`}>
                      Revoke
                    </button>
                  )}
                  <button type="button" className={btn} onClick={() => deleteKey(key)}
                    aria-label={`Delete key ${key.name}`}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {keyDraft && (
            <div className="rounded border border-[var(--color-border)] bg-white/5 p-3 space-y-2"
              data-testid="key-dialog">
              <input
                className={`${input} w-full`}
                placeholder="Key name, e.g. alexa-lambda"
                aria-label="Key name"
                value={keyDraft.name}
                onChange={(e) => setKeyDraft({ ...keyDraft, name: e.target.value })}
              />
              <div className="flex gap-2">
                <select
                  className={`${input} flex-1`}
                  aria-label="Scope"
                  value={keyDraft.scope_id}
                  onChange={(e) => setKeyDraft({ ...keyDraft, scope_id: e.target.value })}
                >
                  {scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select
                  className={`${input} w-32`}
                  aria-label="Expiry"
                  value={keyDraft.expiry}
                  onChange={(e) => setKeyDraft({ ...keyDraft, expiry: Number(e.target.value) })}
                >
                  {EXPIRY_PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={mintKey}
                  className="px-4 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  Create key
                </button>
                <button type="button" className={btn} onClick={() => setKeyDraft(null)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">
        An app only stops accepting the <em>master</em> key once its config carries{' '}
        <code>auth_type: scoped</code> (<code>POST /api/apps/&lt;slug&gt;/config</code>) — scoped
        keys work wherever their scope says either way, and loopback{' '}
        <code>local_paths</code> callers are never affected.
      </div>
    </div>
  );
}

export default function IntegrationsTab() {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);

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

  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Integrations</h2>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Workspace-level credentials, one card each. WhatsApp lives under{' '}
          <code className="bg-white/10 px-1 rounded">Settings → AW → Workspace Agent</code> for now
          (it needs the always-running connector process, not just an MCP).
        </p>
      </div>

      {error && <div className="text-xs text-red-400 mb-3">{error}</div>}
      {!config && !error && <div className="text-xs text-[var(--color-text-muted)]">Loading...</div>}

      <div className="space-y-4 max-w-2xl">
        <WorkspaceApiKeyIntegration />
        <ScopedApiKeysIntegration />
      </div>
    </div>
  );
}

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

/**
 * Settings > Integrations — friendlier, single-purpose config UI for
 * third-party accounts that back onto a plain stdio MCP server (as
 * opposed to Settings > MCP Servers, which is the generic raw editor for
 * every MCP including internal AW ones).
 *
 * Writes go through the same PUT /api/settings/mcp endpoint McpServersTab
 * uses — this is just a friendlier front door for one env var at a time,
 * not a separate storage mechanism.
 */

function PlaudIntegration({ config, onSaved }) {
  const serverCfg = config?.mcpServers?.['aw-plaud'];
  const [token, setToken] = useState(serverCfg?.env?.PLAUD_BEARER_TOKEN || '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // { ok, msg }

  useEffect(() => {
    setToken(serverCfg?.env?.PLAUD_BEARER_TOKEN || '');
  }, [serverCfg]);

  const connected = Boolean(serverCfg?.env?.PLAUD_BEARER_TOKEN);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setStatus(null);
    try {
      const next = {
        ...config,
        mcpServers: {
          ...config.mcpServers,
          'aw-plaud': {
            ...(config.mcpServers['aw-plaud'] || {
              enabled: true,
              type: 'stdio',
              command: '.venv/aw/bin/python',
              args: ['src/mcp/aw_plaud.py'],
            }),
            env: {
              ...(config.mcpServers['aw-plaud']?.env || { PYTHONUNBUFFERED: '1' }),
              PLAUD_BEARER_TOKEN: token.trim(),
            },
          },
        },
      };
      const res = await apiFetch('/api/settings/mcp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.detail ?? 'Save failed');
      }
      setStatus({ ok: true, msg: 'Saved & synced.' });
      onSaved?.(next);
    } catch (e) {
      setStatus({ ok: false, msg: e.message });
    } finally {
      setSaving(false);
    }
  }, [config, token, onSaved]);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Plaud</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            connected ? 'bg-green-500/15 text-green-400' : 'bg-white/10 text-[var(--color-text-muted)]'
          }`}>
            {connected ? 'Configured' : 'Not configured'}
          </span>
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        AI recorder (Note / NotePin / Note Pro). Unofficial web API — the official
        OAuth API is still in private beta, so this uses a bearer token captured from
        a logged-in <code>web.plaud.ai</code> session. Exposes recordings, transcripts,
        summaries, and raw audio as MCP tools (<code>plaud_list_recordings</code>,{' '}
        <code>plaud_get_transcript</code>, <code>plaud_get_summary</code>,{' '}
        <code>plaud_download_audio</code>).
      </p>

      <ol className="space-y-2 text-xs text-[var(--color-text-muted)] pl-1">
        <li className="flex gap-2">
          <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold">1</span>
          Log in at <code>web.plaud.ai</code> in your normal browser.
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold">2</span>
          Open DevTools (F12) → <strong className="text-[var(--color-text-secondary)]">Network</strong>, click any recording to trigger a request.
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold">3</span>
          Find a request to <code>api.plaud.ai</code> → Headers → Request Headers → copy the <code>authorization</code> value (starts with <code>Bearer …</code>).
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold">4</span>
          Paste it below and save.
        </li>
      </ol>

      <div>
        <label className="text-xs font-semibold text-[var(--color-text-primary)] block mb-1">
          Bearer token
        </label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Bearer eyJhbGciOi..."
          className="w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
            text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-[var(--color-accent)]/60"
        />
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
          Short-lived JWT (~24h) — no auto-refresh yet, re-paste when tools start failing with a 401.
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !token.trim()}
          className="px-4 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {status && (
          <span className={`text-xs ${status.ok ? 'text-green-400' : 'text-red-400'}`}>{status.msg}</span>
        )}
      </div>

      <div className="pt-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">
        Test it by asking your agent: <em>"usa o MCP do Plaud pra listar minhas últimas gravações"</em>.
        See <code>skills/aw-plaud/SKILL.md</code> for the full tool reference.
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
          Third-party accounts, one card each. Under the hood these all configure a stdio MCP
          server's env — same storage as <code className="bg-white/10 px-1 rounded">Settings → MCP Servers</code>,
          just a guided front door. WhatsApp lives under{' '}
          <code className="bg-white/10 px-1 rounded">Settings → AW → Workspace Agent</code> for now
          (it needs the always-running connector process, not just an MCP).
        </p>
      </div>

      {error && <div className="text-xs text-red-400 mb-3">{error}</div>}
      {!config && !error && <div className="text-xs text-[var(--color-text-muted)]">Loading...</div>}

      <div className="space-y-4 max-w-2xl">
        <WorkspaceApiKeyIntegration />
        {config && <PlaudIntegration config={config} onSaved={setConfig} />}
      </div>
    </div>
  );
}

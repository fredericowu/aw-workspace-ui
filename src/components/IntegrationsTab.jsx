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
      </div>
    </div>
  );
}

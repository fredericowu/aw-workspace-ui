import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../auth';
import { apiUrl } from '../apiBase';
import { installWindowKbdSync, originForIframeSrc } from '../lib/appIframeKbd';

/**
 * Workspace > Skills tab.
 *
 * Lists every skill from `skills/` (the source of truth) and lets the user:
 *   - click a skill → opens its folder in code-server (separate browser window)
 *   - + New Skill   → scaffold `skills/<name>/SKILL.md` with frontmatter stub
 *   - Sync now      → POST /api/skills/sync (mirrors to .cursor/.claude)
 *   - Delete        → row-level button
 *
 * The watchdog file watcher in awserver picks up edits made via code-server,
 * so the click-to-open flow is the primary editor: edit there, save, sync
 * propagates automatically. The "Sync now" button is a manual escape hatch
 * for paranoia / drift.
 */
export default function SkillsTab() {
  const [skills, setSkills] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [creating, setCreating] = useState(false);

  // Keep the "open in code-server" popup (window.open, not an iframe — see
  // handleOpen below) in sync with the "suppress on-screen keyboard" toggle,
  // same contract as the iframe-app windows in WindowManager.jsx. Both refs
  // start empty: nothing has been opened yet.
  const codeServerWinRef = useRef(null);
  const codeServerOriginRef = useRef(null);
  useEffect(() => installWindowKbdSync(
    () => codeServerWinRef.current,
    () => codeServerOriginRef.current,
  ), []);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/skills');
      const data = await res.json();
      setSkills(data.skills || []);
      setError(null);
    } catch (e) {
      setError(`Failed to load skills: ${e.message}`);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSync = useCallback(async () => {
    setBusy(true);
    setSyncStatus(null);
    try {
      // /api/skills/sync now proxies to the unified /api/agent/sync, which
      // returns { skills: [...], mcp: [...], results: <skills alias> }.
      // We show counts for both halves so the button reflects everything
      // it actually does (the old name "Sync now" still fits — it just
      // syncs more under the hood now).
      const res = await apiFetch('/api/agent/sync', { method: 'POST' });
      const data = await res.json();
      const totals = (data.skills || data.results || []).reduce(
        (acc, r) => ({
          added: acc.added + (r.added?.length || 0),
          updated: acc.updated + (r.updated?.length || 0),
          deleted: acc.deleted + (r.deleted?.length || 0),
        }),
        { added: 0, updated: 0, deleted: 0 },
      );
      const mcp = (data.mcp || []);
      const mcpChanged = mcp.filter((r) => r.success && r.changed).length;
      const mcpFailed = mcp.filter((r) => !r.success);
      const ts = new Date().toLocaleTimeString();
      const skillsStr =
        totals.added + totals.updated + totals.deleted === 0
          ? 'skills: ok'
          : `skills: +${totals.added} ~${totals.updated} -${totals.deleted}`;
      const mcpStr =
        mcp.length === 0
          ? 'mcp: skipped'
          : mcpFailed.length
            ? `mcp: ${mcpFailed.length} FAILED`
            : mcpChanged > 0
              ? `mcp: updated`
              : `mcp: ok`;
      setSyncStatus(`${skillsStr} · ${mcpStr} · ${ts}`);
      if (mcpFailed.length) {
        setError(`MCP sync failed: ${mcpFailed.map((r) => `${r.target} (${r.error})`).join('; ')}`);
      }
      await refresh();
    } catch (e) {
      setError(`Sync failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleOpen = useCallback(async (name) => {
    setError(null);
    try {
      const res = await apiFetch(`/api/skills/${encodeURIComponent(name)}/open`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || `Failed to open ${name}`);
        return;
      }
      // Open in a separate browser window — code-server's bind mount writes
      // back to disk, the file watcher re-syncs automatically.
      const fullUrl = apiUrl(data.url);
      codeServerWinRef.current = window.open(fullUrl, `aw-skill-${name}`, 'popup=1,width=1400,height=900');
      codeServerOriginRef.current = originForIframeSrc(fullUrl);
    } catch (e) {
      setError(`Open failed: ${e.message}`);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    const name = (window.prompt('New skill name (lowercase, hyphens):') || '').trim();
    if (!name) return;
    const description = (window.prompt('Short description (optional):') || '').trim();
    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || `Failed to create ${name}`);
        return;
      }
      await refresh();
      // Auto-open the new skill in code-server.
      await handleOpen(name);
    } catch (e) {
      setError(`Create failed: ${e.message}`);
    } finally {
      setCreating(false);
    }
  }, [refresh, handleOpen]);

  const handleDelete = useCallback(async (name) => {
    if (!window.confirm(`Delete skill "${name}"? This removes skills/${name}/ and propagates the delete to .cursor and .claude.`)) {
      return;
    }
    setError(null);
    try {
      const res = await apiFetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.detail || `Failed to delete ${name}`);
        return;
      }
      await refresh();
    } catch (e) {
      setError(`Delete failed: ${e.message}`);
    }
  }, [refresh]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">Skills</h1>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
            Source of truth: <code className="text-[var(--color-accent)]">skills/</code> — synced to{' '}
            <code>.cursor/skills/</code> and <code>.claude/skills/</code> on save.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {syncStatus && (
            <span className="text-[11px] text-[var(--color-text-muted)] font-mono">{syncStatus}</span>
          )}
          <button
            onClick={handleSync}
            disabled={busy}
            data-testid="skills-sync-now"
            className="px-3 py-1.5 text-xs rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)] cursor-pointer disabled:opacity-50 transition-colors"
            title="Mirror skills/ to .cursor/skills/ and .claude/skills/"
          >
            {busy ? 'Syncing…' : '↻ Sync now'}
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            data-testid="skills-new"
            className="px-3 py-1.5 text-xs rounded bg-[var(--color-accent)]/15 hover:bg-[var(--color-accent)]/25 text-[var(--color-accent)] cursor-pointer disabled:opacity-50 transition-colors"
          >
            + New Skill
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 text-xs rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30">
          {error}
        </div>
      )}

      {skills.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-[var(--color-text-muted)] italic border border-dashed border-[var(--color-border)] rounded">
          No skills yet. Click <span className="text-[var(--color-accent)]">+ New Skill</span> to create one.
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded overflow-hidden divide-y divide-[var(--color-border)]">
          {skills.map((s) => (
            <div
              key={s.name}
              data-testid={`skill-row-${s.name}`}
              className="group flex items-start gap-3 px-3 py-2.5 bg-[var(--color-bg-secondary)] hover:bg-white/[0.03] transition-colors"
            >
              <button
                onClick={() => handleOpen(s.name)}
                data-testid={`skill-open-${s.name}`}
                className="flex-1 text-left min-w-0 cursor-pointer"
                title={`Open ${s.rel_path} in code-server`}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="text-[13px] text-[var(--color-text-primary)] font-medium truncate">{s.name}</span>
                  <code className="text-[10px] text-[var(--color-text-muted)] truncate">{s.rel_path}</code>
                  {s.owner && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-[var(--color-text-muted)] shrink-0"
                      title={`Provided by the "${s.owner}" app — not editable here`}
                    >
                      {s.owner}
                    </span>
                  )}
                </div>
                {s.description && (
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-1 line-clamp-2">
                    {s.description}
                  </div>
                )}
              </button>
              {s.editable !== false && (
                <button
                  onClick={() => handleDelete(s.name)}
                  data-testid={`skill-delete-${s.name}`}
                  className="opacity-0 group-hover:opacity-100 px-2 py-1 text-[11px] rounded text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 cursor-pointer transition-all"
                  title={`Delete ${s.name}`}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 text-[11px] text-[var(--color-text-muted)] leading-relaxed">
        <p>
          Click a skill to open its folder in code-server (separate window). Edits there save to{' '}
          <code>skills/&lt;name&gt;/SKILL.md</code> directly; the awserver file watcher detects the
          change and re-syncs to per-agent directories within ~½ second.
        </p>
      </div>
    </div>
  );
}

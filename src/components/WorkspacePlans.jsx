/**
 * Workspace > Plans — spec-driven plan editor.
 *
 * Three-pane layout:
 *   - Left:    plan list (status badges, + New plan button, click to select)
 *   - Center:  code-server iframe scoped to specs/<slug>/
 *   - Right:   tasks tree parsed from tasks.md (placeholder for Phase 1;
 *              becomes live status + per-task status when sync ships)
 *
 * Top toolbar: [▶ Play] [Sync] [Open in VSCode ↗] [↻ Refresh]
 *
 * Phase-1 caveat: Play and Sync are wired to the backend stubs that
 * return 501. The buttons exist so the placement is settled before
 * Phase 2/3 fills in behavior.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth';

// ─── tiny inline icons ────────────────────────────────────────────────

function PlayIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function SyncIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 11-3-6.7L21 8" />
      <polyline points="21 3 21 8 16 8" />
    </svg>
  );
}

function VSCodeOutIcon({ className = 'w-3.5 h-3.5' }) {
  // Code-bracket glyph — matches the affordance used on the Repos
  // submenu's "open in code-server" button so users learn it once.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function PlusIcon({ className = 'w-3 h-3' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon({ className = 'w-3 h-3' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    </svg>
  );
}

function RefreshIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  );
}

// ─── status badge ─────────────────────────────────────────────────────

const STATUS_STYLES = {
  // draft = no GH issues yet; muted gray.
  draft: 'bg-white/10 text-[var(--color-text-muted)]',
  // synced = on GH but not running; cool blue.
  synced: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
  // running = orchestrator active; warm pulse so it draws the eye.
  running: 'bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse',
  // done = all tasks closed; green.
  done: 'bg-green-500/15 text-green-300 border border-green-500/30',
};

function StatusBadge({ status }) {
  const cls = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-medium ${cls}`}>
      {status}
    </span>
  );
}

// ─── new-plan modal ───────────────────────────────────────────────────

function slugify(s) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function NewPlanModal({ open, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Auto-derive slug from title until the user manually edits the slug
  // field. Common pattern (Notion, Linear, etc.) — minimal friction
  // for the 99% case while still letting power users override.
  useEffect(() => {
    if (!touched) setSlug(slugify(title));
  }, [title, touched]);

  // Reset on open. Avoids stale state if the modal is reopened after
  // an error.
  useEffect(() => {
    if (open) {
      setTitle('');
      setSlug('');
      setTouched(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    if (!slug) {
      setError('Slug is required');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, title: title || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      onCreated?.(data.plan);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-5 w-[420px]"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">New plan</h2>

        <label className="block text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Title
        </label>
        <input
          autoFocus
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Authentication flow"
          className="w-full mb-3 px-2.5 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
        />

        <label className="block text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Slug <span className="text-[10px] normal-case text-[var(--color-text-muted)]/60">(directory name; auto-derived from title)</span>
        </label>
        <input
          type="text"
          value={slug}
          onChange={(e) => { setTouched(true); setSlug(slugify(e.target.value)); }}
          placeholder="auth-flow"
          className="w-full mb-3 px-2.5 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-[13px] font-mono text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
        />

        {error && (
          <div className="mb-3 px-2.5 py-1.5 text-[11px] rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] rounded text-[var(--color-text-muted)] hover:bg-white/[0.06]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !slug}
            className="px-3 py-1.5 text-[12px] rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── main panel ───────────────────────────────────────────────────────

export default function WorkspacePlans() {
  const [plans, setPlans] = useState([]);
  const [selected, setSelected] = useState(null); // slug
  const [detail, setDetail] = useState(null);     // full payload for selected
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch('/api/plans');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPlans(data.plans || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-select first plan if nothing is selected and plans exist.
  useEffect(() => {
    if (!selected && plans.length > 0) setSelected(plans[0].slug);
  }, [plans, selected]);

  // Fetch detail for the selected plan. Re-runs when the selection
  // changes or when the list refreshes (so newly-created plans get
  // their tasks re-parsed if the user added some externally).
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let cancelled = false;
    apiFetch(`/api/plans/${selected}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setDetail(d.plan); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [selected, plans]);

  const handleCreated = useCallback((plan) => {
    setSelected(plan.slug);
    refresh();
  }, [refresh]);

  const handleArchive = useCallback(async (slug) => {
    if (!confirm(`Archive plan "${slug}"? Files move to specs/.archived/.`)) return;
    try {
      const res = await apiFetch(`/api/plans/${slug}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (selected === slug) setSelected(null);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }, [selected, refresh]);

  // Run an action endpoint and refresh both list + detail so the
  // status badge and right-pane state update without a manual reload.
  // Each endpoint returns its own result shape — we render a short
  // human summary in the toast and stash the full payload for an
  // expandable "details" view if the user wants the raw output.
  const runAction = useCallback(async (action) => {
    if (!selected) return;
    setActionMsg(null);
    try {
      const res = await apiFetch(`/api/plans/${selected}/${action}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));

      // 4xx with a structured detail (orchestrator errors return
      // ``{detail: {error_kind, message}}`` from FastAPI). Render the
      // message verbatim — the engine writes them to be user-actionable.
      if (!res.ok) {
        const detail = typeof body.detail === 'object' && body.detail
          ? body.detail.message || JSON.stringify(body.detail)
          : body.detail || `HTTP ${res.status}`;
        setActionMsg({ kind: 'error', text: `${action}: ${detail}` });
        return;
      }

      // Success — pull the action-specific summary out of the response.
      let summary;
      if (action === 'sync' && body.sync) {
        const s = body.sync;
        if (!s.ok) {
          setActionMsg({ kind: 'error', text: `sync: ${s.error || 'failed'}` });
          return;
        }
        const created = s.issues_created.length;
        const edges = s.edges_added.length;
        summary = `sync ok — ${created} issue${created !== 1 ? 's' : ''} created, ${edges} dependency edge${edges !== 1 ? 's' : ''}`;
        if (s.warnings && s.warnings.length > 0) {
          // Surface the first warning inline; user can refresh to see more.
          summary += ` · ⚠ ${s.warnings[0]}`;
        }
        if (s.project_url) summary += ` · ${s.project_url}`;
      } else if (action === 'play' && body.play) {
        const p = body.play;
        summary = p.already_running
          ? `play: already running (task ${p.task_id})`
          : `play: started — task ${p.task_id}, parallelism cap ${p.parallel_cap}`;
      } else if (action === 'stop' && body.stop) {
        const s = body.stop;
        summary = s.wasnt_running
          ? 'stop: nothing was running'
          : `stop: halted (task ${s.task_id})`;
      } else {
        summary = `${action}: ok`;
      }
      setActionMsg({ kind: 'ok', text: summary });

      // Refresh list + detail so the status badge / completion bar
      // / orchestrator_task_id update immediately.
      refresh();
      if (selected) {
        apiFetch(`/api/plans/${selected}`)
          .then((r) => r.json())
          .then((d) => setDetail(d.plan))
          .catch(() => {});
      }
    } catch (e) {
      setActionMsg({ kind: 'error', text: `${action}: ${e.message}` });
    }
  }, [selected, refresh]);

  // Code-server iframe URL — uses the container_folder the backend
  // pre-computed (host /opt/agentic-workspace/specs/<slug> →
  // container /home/coder/project/specs/<slug>). Falls back to a
  // sensible default while detail loads so the iframe doesn't flicker
  // through an empty src.
  const iframeUrl = useMemo(() => {
    if (!detail?.container_folder) return null;
    return `/vscode/?folder=${encodeURIComponent(detail.container_folder)}`;
  }, [detail]);

  const openInPopup = useCallback(() => {
    if (!iframeUrl) return;
    window.open(iframeUrl, 'aw-vscode-plan', 'popup=1,width=1400,height=900');
  }, [iframeUrl]);

  return (
    <div className="flex-1 flex flex-col bg-[var(--color-bg-primary)] overflow-hidden">
      {/* Top toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">Plans</span>
        {selected && (
          <span className="text-[11px] text-[var(--color-text-muted)] font-mono">/ {selected}</span>
        )}
        <div className="flex-1" />
        {detail?.status === 'running' ? (
          // Running: Play turns into Stop. Same slot, different verb —
          // less visual noise than rendering both side by side.
          <button
            onClick={() => runAction('stop')}
            disabled={!selected}
            title="Halt the orchestrator (preserves session history)"
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop
          </button>
        ) : (
          <button
            onClick={() => runAction('play')}
            disabled={!selected || detail?.status === 'draft'}
            title={
              detail?.status === 'draft'
                ? 'Sync the plan to GitHub before playing — orchestrator needs issues to track'
                : 'Run the orchestrator agent on this plan'
            }
            className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PlayIcon />
            Play
          </button>
        )}
        <button
          onClick={() => runAction('sync')}
          disabled={!selected || detail?.status === 'running'}
          title={
            detail?.status === 'running'
              ? 'Stop the orchestrator before re-syncing'
              : 'Push tasks to GitHub Projects — creates issues, sets dependencies'
          }
          className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <SyncIcon />
          Sync
        </button>
        <button
          onClick={openInPopup}
          disabled={!iframeUrl}
          title="Open this plan in a popped-out code-server window"
          className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <VSCodeOutIcon />
          Open in VSCode
        </button>
        <button
          onClick={refresh}
          title="Refresh plan list"
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/[0.06]"
        >
          <RefreshIcon />
        </button>
      </div>

      {actionMsg && (
        <div
          className={`px-3 py-1.5 text-[11px] border-b ${
            actionMsg.kind === 'ok'
              ? 'bg-green-500/10 text-green-300 border-green-500/20'
              : actionMsg.kind === 'error'
              ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/20'
              : 'bg-sky-500/10 text-sky-300 border-sky-500/20'
          }`}
        >
          {actionMsg.text}
          <button
            className="ml-2 opacity-50 hover:opacity-100"
            onClick={() => setActionMsg(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Three-pane body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left: plan list ─────────────────────────────────────── */}
        <div className="w-[260px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Plans · {plans.length}
            </span>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 border border-[var(--color-accent)]/30"
              title="Create a new plan"
            >
              <PlusIcon />
              New
            </button>
          </div>

          {error && (
            <div className="m-2 px-2 py-1 text-[11px] rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
              Loading…
            </div>
          ) : plans.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
              <div className="text-xs text-[var(--color-text-muted)] italic mb-3">
                No plans yet.
              </div>
              <button
                onClick={() => setShowNew(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 border border-[var(--color-accent)]/30"
              >
                <PlusIcon />
                Create your first plan
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {plans.map((p) => (
                <div
                  key={p.slug}
                  onClick={() => setSelected(p.slug)}
                  className={`group flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]/50 cursor-pointer transition-colors ${
                    selected === p.slug
                      ? 'bg-[var(--color-accent)]/10 border-l-2 border-l-[var(--color-accent)]'
                      : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[12px] text-[var(--color-text-primary)] truncate">
                        {p.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={p.status} />
                      <span className="text-[10px] text-[var(--color-text-muted)] font-mono truncate">
                        {p.task_count} task{p.task_count !== 1 ? 's' : ''}
                      </span>
                      {p.completion > 0 && (
                        <span className="text-[10px] text-[var(--color-text-muted)]">
                          · {Math.round(p.completion * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleArchive(p.slug); }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                    title="Archive plan"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Center: code-server iframe ──────────────────────────── */}
        <div className="flex-1 min-w-0 bg-[var(--color-bg-primary)]">
          {selected && iframeUrl ? (
            <iframe
              key={selected /* re-mount when slug changes so VSCode re-roots its workspace */}
              src={iframeUrl}
              title={`Editor for ${selected}`}
              className="w-full h-full border-0"
              allow="clipboard-read; clipboard-write"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)] italic">
              {plans.length === 0
                ? 'Create a plan to start editing.'
                : 'Select a plan to open the editor.'}
            </div>
          )}
        </div>

        {/* ── Right: tasks tree ───────────────────────────────────── */}
        <div className="w-[280px] shrink-0 border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col">
          <div className="px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Tasks {detail?.tasks ? `· ${detail.tasks.length}` : ''}
            </span>
          </div>

          {!detail ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)] italic">
              {selected ? 'Loading…' : 'No plan selected'}
            </div>
          ) : detail.tasks.length === 0 ? (
            <div className="flex-1 flex items-center justify-center px-4 text-center text-xs text-[var(--color-text-muted)] italic">
              No tasks yet. Edit <code className="font-mono not-italic">tasks.md</code> in the editor to add some.
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-2">
              {detail.tasks.map((t) => {
                const issueId = detail.meta?.issue_map?.[t.id];
                const issueStatus = detail.meta?.issue_status?.[t.id];
                const blockedByOpen = t.deps.some((d) => detail.meta?.issue_status?.[d] !== 'closed' && detail.meta?.issue_map?.[d]);
                return (
                  <div
                    key={t.id}
                    className="px-2 py-1.5 mb-1 rounded hover:bg-white/[0.04] text-[11px]"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-mono text-[var(--color-text-muted)]">{t.id}</span>
                      {t.parallel && (
                        <span
                          className="px-1 py-0.5 rounded text-[9px] font-mono bg-purple-500/15 text-purple-300 border border-purple-500/30"
                          title="Parallelizable — orchestrator may run alongside siblings"
                        >
                          [P]
                        </span>
                      )}
                      {issueStatus === 'closed' && <span className="text-green-400" title="Closed on GitHub">✓</span>}
                      {blockedByOpen && <span className="text-amber-400" title="Blocked by open dependency">⊘</span>}
                      {issueId && (
                        <span className="text-[9px] text-sky-400 ml-auto" title="Linked to GitHub">↗</span>
                      )}
                    </div>
                    <div className="text-[var(--color-text-primary)] leading-snug">
                      {t.description}
                    </div>
                    {t.deps.length > 0 && (
                      <div className="mt-0.5 text-[9px] text-[var(--color-text-muted)] font-mono">
                        ← {t.deps.join(', ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {detail && detail.last_synced_at && (
            <div className="px-3 py-1.5 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]">
              Last sync: {new Date(detail.last_synced_at).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      <NewPlanModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}

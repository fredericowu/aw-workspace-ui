/**
 * PlansPanel — the floating-window flavour of Workspace > Plans.
 *
 * Shaped to live inside a draggable WindowManager panel, mirroring the
 * Debugger / Tasks pattern. Layout:
 *
 *   ┌───────── header (drag handle, maximise, close) ─────────┐
 *   │ [Agent ▾]  [Flow ▾]   [▶ Start | ↻ Restart]   [ + new ] │
 *   ├──────────────┬──────────────────────────────────────────┤
 *   │ Plan list    │ TerminalWindow (minimal)                 │
 *   │  (slugs,     │   ↑ runs the chosen agent                │
 *   │   status,    │   ↑ on Start: POST /api/terminals,       │
 *   │   archive)   │      then write the chosen flow's        │
 *   │              │      `/spec-kit:<flow> <slug>` prompt    │
 *   └──────────────┴──────────────────────────────────────────┘
 *
 * There's no vscode iframe here — users that
 * still want the editor pop it open via the Repos > code-server tile,
 * or the Workspace > Plans floating window's "Open in VSCode" button
 * (TODO: phase-2; deliberately omitted here to keep the first cut tight).
 *
 * Switching the agent picker after a session is already live triggers
 * a Keep-or-Discard confirm dialog so users don't accidentally throw
 * away an agent that's mid-edit. "Keep" leaves the old terminal in
 * the global Agents nav; "Discard" DELETEs it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../auth';
import TerminalWindow from './TerminalWindow';

// ── icons ─────────────────────────────────────────────────────────────

function PlayIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function RestartIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
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

// ── status badge ──────────────────────────────────────────────────────

const STATUS_STYLES = {
  draft: 'bg-white/10 text-[var(--color-text-muted)]',
  synced: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
  running: 'bg-amber-500/15 text-amber-300 border border-amber-500/30 animate-pulse',
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

// ── new-plan modal ──────────────────────────────────────────────────

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

  useEffect(() => { if (!touched) setSlug(slugify(title)); }, [title, touched]);
  useEffect(() => {
    if (open) {
      setTitle(''); setSlug(''); setTouched(false); setError(null); setBusy(false);
    }
  }, [open]);

  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    if (!slug) { setError('Slug is required'); return; }
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
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <form
        className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-5 w-[420px]"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">New plan</h2>
        <label className="block text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Title</label>
        <input
          autoFocus type="text" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Authentication flow"
          className="w-full mb-3 px-2.5 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-[13px] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
        />
        <label className="block text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
          Slug <span className="text-[10px] normal-case text-[var(--color-text-muted)]/60">(directory name; auto-derived from title)</span>
        </label>
        <input
          type="text" value={slug}
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
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-[12px] rounded text-[var(--color-text-muted)] hover:bg-white/[0.06]">Cancel</button>
          <button type="submit" disabled={busy || !slug} className="px-3 py-1.5 text-[12px] rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── confirm modal (Keep / Discard previous session on agent swap) ─────

function SwapConfirmModal({ open, onKeep, onDiscard, onCancel, prevAgentLabel, nextAgentLabel }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-5 w-[440px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
          Switch agent: {prevAgentLabel} → {nextAgentLabel}
        </h2>
        <p className="text-[12px] text-[var(--color-text-muted)] mb-4 leading-snug">
          The {prevAgentLabel} session is still running. Keep it (it stays in the
          Agents top-menu), or discard it (the terminal is closed and removed)?
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-[12px] rounded text-[var(--color-text-muted)] hover:bg-white/[0.06]">
            Cancel
          </button>
          <button onClick={onDiscard} className="px-3 py-1.5 text-[12px] rounded bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25">
            Discard previous
          </button>
          <button onClick={onKeep} className="px-3 py-1.5 text-[12px] rounded bg-[var(--color-accent)] text-white hover:opacity-90">
            Keep previous
          </button>
        </div>
      </div>
    </div>
  );
}

// ── flow defs (matches the spec-kit skill's three sub-commands) ───────

// Each flow injects a short directive that (a) tells the agent which
// spec-kit sub-command to run and (b) names the exact file under
// specs/<slug>/ it should be writing to. The slug-anchored phrasing
// matters: agents that lose context across long sessions will still
// know where the artifacts live, and the "scaffold if missing"
// language nudges Claude/Codex to create the file rather than refuse
// when it doesn't exist yet (common on a brand-new plan).
const FLOWS = [
  {
    id: 'specify',
    label: 'Specify (spec.md)',
    description: 'Frame the problem and outcome. Start here for a brand-new plan.',
    file: 'spec.md',
    prompt: (slug) =>
      `Invoke /spec-kit:specify and scaffold specs/${slug}/spec.md — frame the problem, outcome, success criteria, and non-goals for the "${slug}" plan. Ask me clarifying questions before writing.`,
  },
  {
    id: 'plan',
    label: 'Plan (plan.md)',
    description: 'Translate the spec into architecture / data model / touch points.',
    file: 'plan.md',
    prompt: (slug) =>
      `Invoke /spec-kit:plan and scaffold specs/${slug}/plan.md — translate specs/${slug}/spec.md into architecture, data shapes, integration points, and rollout. Stop short of writing code.`,
  },
  {
    id: 'tasks',
    label: 'Tasks (tasks.md)',
    description: 'Decompose the plan into one-PR-sized tasks with [P] markers.',
    file: 'tasks.md',
    prompt: (slug) =>
      `Invoke /spec-kit:tasks and scaffold specs/${slug}/tasks.md — decompose specs/${slug}/plan.md into numbered tasks (T001, T002, …) with [P] markers for parallelizable work and "(depends on: T00X)" clauses for sequencing. Match the format the AW orchestrator parses.`,
  },
];

// Pick the first flow whose target file is non-empty:
//   - all 3 empty → specify
//   - spec.md filled, plan.md empty → plan
//   - spec.md + plan.md filled, tasks.md empty → tasks
//   - all filled → tasks (re-run is the most likely user intent)
//
// `detail` is the GET /api/plans/:slug response; we look at `files` if
// present, otherwise default to specify.
function suggestFlow(detail) {
  const files = detail?.files || {};
  const isEmpty = (k) => !files[k] || (typeof files[k] === 'string' && files[k].trim().length < 20);
  if (isEmpty('spec.md')) return 'specify';
  if (isEmpty('plan.md')) return 'plan';
  return 'tasks';
}

// ── main panel ────────────────────────────────────────────────────────

// localStorage keys for the per-plan picker / session memory.
// Persisting the session id is what lets a browser refresh re-attach
// to the same agent terminal instead of losing it (the backend
// session survives — it shows up in the Agents top-menu — we just
// need to remember which terminal id belongs to which plan).
const LS_AGENT   = 'aw-plans-agent-by-slug';
const LS_FLOW    = 'aw-plans-flow-by-slug';
const LS_SESSION = 'aw-plans-session-by-slug';

function loadMap(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveMap(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// "Terminal" / bash is in the ai_agents config so users can spawn one
// from the Agents top-menu, but it's not a coding agent and the
// spec-kit slash commands wouldn't mean anything to it. Hide it from
// the Plans picker.
function isCodingAgent(a) {
  return a && a.type !== 'terminal';
}

export default function PlansPanel({
  aiAgents = [],
  terminals = [],
  insecureMap,
  onToggleInsecure,
  onWindowFocus,
  resumeMap,
  terminalReconnectSignals,
}) {
  // Filtered agent list — picker should never show "Terminal" / bash.
  const pickableAgents = useMemo(() => aiAgents.filter(isCodingAgent), [aiAgents]);

  const [plans, setPlans] = useState([]);
  const [selected, setSelected] = useState(null);   // slug
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  // Per-plan: chosen agent type + flow id + active terminal session id.
  // Keying by slug means switching plans restores the state for that
  // plan (e.g. you had Claude+specify mid-flight, swap to a different
  // plan with Codex+tasks, swap back — picker remembers your choice).
  // All three maps are persisted to localStorage so a browser refresh
  // re-attaches to the same agent session (validated below against the
  // live `terminals[]` so dead sessions get pruned).
  const [agentBySlug, setAgentBySlug]     = useState(() => loadMap(LS_AGENT));
  const [flowBySlug, setFlowBySlug]       = useState(() => loadMap(LS_FLOW));
  const [sessionBySlug, setSessionBySlug] = useState(() => loadMap(LS_SESSION));

  // Persist on change. Cheap (3 small JSON blobs) and avoids a
  // dedicated effect-per-key. Object identity changes only when one
  // of the maps mutates so writes stay sparse.
  useEffect(() => { saveMap(LS_AGENT,   agentBySlug);   }, [agentBySlug]);
  useEffect(() => { saveMap(LS_FLOW,    flowBySlug);    }, [flowBySlug]);
  useEffect(() => { saveMap(LS_SESSION, sessionBySlug); }, [sessionBySlug]);

  // Track whether the global terminals[] list has been initialized at
  // least once. The WS init message arrives a tick after mount; before
  // it does, the list is `[]` even when sessions actually exist.
  // Pruning during that window would wipe every persisted session id
  // — exactly what was making "refresh loses the terminal" reproducible.
  const terminalsHydratedRef = useRef(false);
  useEffect(() => {
    if (terminals && terminals.length > 0) terminalsHydratedRef.current = true;
  }, [terminals]);

  // Prune session entries whose terminal no longer exists. Only runs
  // once we've seen a non-empty terminals[] (so the initial empty
  // hydration doesn't wipe the map). Externally-killed agents still
  // get cleaned up on the next terminals_update broadcast.
  useEffect(() => {
    if (!terminals || !terminalsHydratedRef.current) return;
    const liveIds = new Set(terminals.map((t) => String(t.id)));
    setSessionBySlug((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [slug, sid] of Object.entries(prev)) {
        if (sid && !liveIds.has(String(sid))) {
          delete next[slug];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [terminals]);

  const [pendingSwap, setPendingSwap] = useState(null);    // { from, to } when confirming

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

  // Auto-select the first plan if nothing is selected
  useEffect(() => {
    if (!selected && plans.length > 0) setSelected(plans[0].slug);
  }, [plans, selected]);

  // Fetch detail for the selected plan. Clear the previous detail
  // immediately so the right pane doesn't render stale data
  // (suggested-flow, agent-session pointer, file-state) from the
  // previously-selected plan during the in-flight GET.
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetail(null);
    let cancelled = false;
    apiFetch(`/api/plans/${selected}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setDetail(d.plan); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [selected, plans]);

  // Default the picker selections once detail loads, but only if the
  // user hasn't already picked something for this slug. If the
  // remembered agent is `terminal` (e.g. legacy state from before we
  // filtered the picker), fall back to the first coding agent.
  useEffect(() => {
    if (!selected) return;
    setAgentBySlug((prev) => {
      const remembered = prev[selected];
      const isValid = remembered && pickableAgents.some((a) => a.type === remembered);
      if (isValid) return prev;
      return { ...prev, [selected]: pickableAgents[0]?.type || 'claude' };
    });
    setFlowBySlug((prev)  => prev[selected] ? prev : { ...prev, [selected]: suggestFlow(detail) });
  }, [selected, detail, pickableAgents]);

  // Hydrate agent/flow/session from .aw.json (specs/<slug>/.aw.json
  // → meta.agent_session) whenever a plan's detail loads. The backend
  // is the source of truth across browsers/tabs/awserv restarts;
  // localStorage is just a faster paint cache. If the plan's meta
  // points at a session we don't already remember, adopt it; if it
  // contradicts our local state, prefer the backend (the user might
  // have started the session from a different browser).
  useEffect(() => {
    if (!selected || !detail) return;
    const sess = detail.meta?.agent_session;
    if (sess && sess.session_id) {
      setSessionBySlug((p) => p[selected] === sess.session_id ? p : { ...p, [selected]: sess.session_id });
      if (sess.agent_type) {
        setAgentBySlug((p) => p[selected] === sess.agent_type ? p : { ...p, [selected]: sess.agent_type });
      }
      if (sess.flow) {
        setFlowBySlug((p) => p[selected] === sess.flow ? p : { ...p, [selected]: sess.flow });
      }
    }
  }, [selected, detail]);

  const currentAgentType = selected ? agentBySlug[selected] : null;
  const currentFlowId    = selected ? flowBySlug[selected]  : null;
  const currentSessionId = selected ? sessionBySlug[selected] : null;
  const currentAgentDef  = aiAgents.find((a) => a.type === currentAgentType);
  const currentFlow      = FLOWS.find((f) => f.id === currentFlowId);
  // The per-session terminal record (so we can render TerminalWindow with
  // the right name / type even if the agent dies and is restarted).
  const currentTerminal  = (terminals || []).find((t) => String(t.id) === String(currentSessionId));
  const sessionAlive     = !!currentTerminal;

  // ── new plan / archive ──────────────────────────────────────────────

  const handleCreated = useCallback((plan) => { setSelected(plan.slug); refresh(); }, [refresh]);

  const handleArchive = useCallback(async (slug) => {
    if (!confirm(`Archive plan "${slug}"? Files move to specs/.archived/.`)) return;
    try {
      const res = await apiFetch(`/api/plans/${slug}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (selected === slug) setSelected(null);
      // also forget any picker state for this slug
      setAgentBySlug((p) => { const n = { ...p }; delete n[slug]; return n; });
      setFlowBySlug ((p) => { const n = { ...p }; delete n[slug]; return n; });
      setSessionBySlug((p) => { const n = { ...p }; delete n[slug]; return n; });
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }, [selected, refresh]);

  // ── start / restart agent + inject prompt ───────────────────────────

  // Inject the chosen flow prompt into the given terminal session.
  // Mirrors the Tasks scheduler injection: write the text, then a CR
  // after a short delay so the agent's TUI registers it as one input.
  const injectPrompt = useCallback(async (sessionId, slug, flowId) => {
    const flow = FLOWS.find((f) => f.id === flowId);
    if (!flow) return;
    const text = flow.prompt(slug);
    try {
      await apiFetch(`/api/terminals/${sessionId}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, send_enter: true }),
      });
    } catch (e) {
      setActionMsg({ kind: 'error', text: `inject: ${e.message}` });
    }
  }, []);

  // Persist (or clear) the agent-session pointer in the plan's
  // .aw.json. PUT body matches PlansRoutes.set_agent_session — fire
  // and forget, errors are non-fatal (the local state is still right;
  // worst case the next refresh has to spawn fresh).
  const persistAgentSession = useCallback(async (slug, sessionId, agentType, flow) => {
    try {
      if (sessionId) {
        await apiFetch(`/api/plans/${slug}/agent-session`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, agent_type: agentType, flow }),
        });
      } else {
        await apiFetch(`/api/plans/${slug}/agent-session`, { method: 'DELETE' });
      }
    } catch (e) {
      // Swallow — frontend keeps its local state, .aw.json just
      // doesn't get the breadcrumb. Refresh will fall back to the
      // start picker; user retries.
      console.warn('persistAgentSession failed', e);
    }
  }, []);

  // Start a new agent terminal for the current plan + agent + flow.
  // Uses the same /api/terminals POST shape as App.createAgent, plus
  // a `cwd: specs/<slug>` so the agent boots in the plan's folder
  // (spec-kit scaffolds land in the right place even if the agent
  // forgets the path mid-session). After a short settle delay (so
  // the CLI has its REPL up) we inject the chosen flow prompt and
  // persist the session pointer to .aw.json so a refresh re-attaches.
  const startSession = useCallback(async () => {
    if (!selected || !currentAgentDef || !currentFlow) return;
    const name = `Plan: ${selected} (${currentAgentDef.label})`;
    let command;
    if (currentAgentDef.type === 'claude') {
      // Claude needs an explicit session id so we can attach later /
      // surface it under Agents nav consistently.
      const sessionId = crypto.randomUUID();
      command = `${currentAgentDef.command || 'claude'} --session-id ${sessionId} --name "${name}" --dangerously-skip-permissions "tell me something good"`;
    } else {
      command = currentAgentDef.command || currentAgentDef.type;
    }
    setActionMsg(null);
    try {
      const res = await apiFetch('/api/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, command, type: currentAgentDef.type,
          cwd: `specs/${selected}`,  // resolved against the repo root by the backend
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data.error || `Failed to start ${currentAgentDef.label}`;
        const hint = data.hint ? `\n\n${data.hint}` : '';
        setActionMsg({ kind: 'error', text: `${msg}${hint}` });
        return;
      }
      setSessionBySlug((p) => ({ ...p, [selected]: data.id }));
      persistAgentSession(selected, data.id, currentAgentDef.type, currentFlowId);
      // Wait for the CLI to draw its REPL before pasting the prompt;
      // 1.2s matches what TasksTab uses for the same purpose.
      setTimeout(() => injectPrompt(data.id, selected, currentFlowId), 1200);
      // Intentionally no success toast — the terminal flicking on is
      // its own confirmation; the toast was just visual noise.
    } catch (e) {
      setActionMsg({ kind: 'error', text: `start: ${e.message}` });
    }
  }, [selected, currentAgentDef, currentFlow, currentFlowId, injectPrompt, persistAgentSession]);

  // Re-inject the current flow prompt into the live session ("start
  // fresh" — user wanted a way to re-run after the agent has wandered
  // off-topic without having to spin up a whole new terminal). Also
  // updates .aw.json so meta.agent_session.flow reflects what's now
  // live in the terminal.
  const restartFlow = useCallback(async () => {
    if (!currentSessionId || !selected || !currentFlowId) return;
    await injectPrompt(currentSessionId, selected, currentFlowId);
    persistAgentSession(selected, currentSessionId, currentAgentType, currentFlowId);
  }, [currentSessionId, selected, currentFlowId, currentAgentType, injectPrompt, persistAgentSession]);

  // ── agent swap (with Keep/Discard confirm) ─────────────────────────

  const requestAgentSwap = useCallback((nextAgentType) => {
    if (!selected) return;
    if (sessionAlive) {
      setPendingSwap({ from: currentAgentType, to: nextAgentType });
    } else {
      setAgentBySlug((p) => ({ ...p, [selected]: nextAgentType }));
    }
  }, [selected, currentAgentType, sessionAlive]);

  const acceptSwap = useCallback(async (mode /* 'keep' | 'discard' */) => {
    if (!pendingSwap || !selected) { setPendingSwap(null); return; }
    const oldSessionId = currentSessionId;
    if (mode === 'discard' && oldSessionId) {
      try { await apiFetch(`/api/terminals/${oldSessionId}`, { method: 'DELETE' }); } catch {}
    }
    // Either way, drop our reference — keep leaves the terminal alive
    // in the global Agents nav, discard already deleted it.
    setSessionBySlug((p) => { const n = { ...p }; delete n[selected]; return n; });
    setAgentBySlug((p) => ({ ...p, [selected]: pendingSwap.to }));
    // Clear the pointer in .aw.json — the new agent hasn't started
    // yet, and leaving the old session id in there would mis-direct
    // a fresh browser tab to a terminal that's no longer the
    // canonical one for this plan.
    persistAgentSession(selected, null);
    setPendingSwap(null);
  }, [pendingSwap, selected, currentSessionId, persistAgentSession]);

  // ── render ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-primary)] overflow-hidden">
      {/* Toolbar — drag handle is on the outer window header, this is
          the panel-internal action row. */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] shrink-0">
        {/* Agent picker */}
        <label className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Agent</label>
        <select
          value={currentAgentType || ''}
          onChange={(e) => requestAgentSwap(e.target.value)}
          disabled={!selected}
          className="px-2 py-1 text-[11px] rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-40"
        >
          {pickableAgents.map((a) => (
            <option key={a.type} value={a.type}>{a.label}</option>
          ))}
        </select>

        {/* Flow picker */}
        <label className="ml-2 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Flow</label>
        <select
          value={currentFlowId || ''}
          onChange={(e) => selected && setFlowBySlug((p) => ({ ...p, [selected]: e.target.value }))}
          disabled={!selected}
          title={currentFlow?.description || ''}
          className="px-2 py-1 text-[11px] rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-40"
        >
          {FLOWS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>

        {/* Start / Restart */}
        {sessionAlive ? (
          <button
            onClick={restartFlow}
            disabled={!selected || !currentFlow}
            title="Re-inject the current flow prompt into the live agent session"
            className="ml-2 flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RestartIcon />
            Restart flow
          </button>
        ) : (
          <button
            onClick={startSession}
            disabled={!selected || !currentAgentDef || !currentFlow}
            title={currentFlow ? `Start ${currentAgentDef?.label || ''} and inject "${currentFlow.prompt(selected || '<slug>')}"` : 'Pick an agent and flow first'}
            className="ml-2 flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PlayIcon />
            Start
          </button>
        )}

        <div className="flex-1" />
        {selected && (
          <span className="text-[10px] text-[var(--color-text-muted)] font-mono truncate max-w-[180px]" title={selected}>
            {selected}
          </span>
        )}
      </div>

      {/* Optional inline action / error toast */}
      {actionMsg && (
        <div
          className={`px-3 py-1 text-[11px] border-b shrink-0 ${
            actionMsg.kind === 'ok'
              ? 'bg-green-500/10 text-green-300 border-green-500/20'
              : 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/20'
          }`}
        >
          {actionMsg.text}
          <button className="ml-2 opacity-50 hover:opacity-100" onClick={() => setActionMsg(null)}>✕</button>
        </div>
      )}

      {/* Body: left list + right terminal */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Plan list */}
        <div className="w-[220px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col min-h-0">
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
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">Loading…</div>
          ) : plans.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
              <div className="text-xs text-[var(--color-text-muted)] italic mb-3">No plans yet.</div>
              <button
                onClick={() => setShowNew(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 border border-[var(--color-accent)]/30"
              >
                <PlusIcon /> Create your first plan
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
                      <span className="text-[12px] text-[var(--color-text-primary)] truncate">{p.title}</span>
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

        {/* Terminal area */}
        <div className="flex-1 min-w-0 min-h-0 bg-[var(--color-bg-primary)] flex flex-col">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-text-muted)] italic">
              {plans.length === 0 ? 'Create a plan to start.' : 'Select a plan from the left.'}
            </div>
          ) : !sessionAlive ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <div className="text-sm text-[var(--color-text-primary)] mb-1">
                Pick an agent and flow, then press Start.
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)] mb-4 leading-snug max-w-[440px]">
                The {currentAgentDef?.label || 'agent'} CLI will spawn here, then we'll
                inject <code className="font-mono text-[var(--color-text-primary)]">{currentFlow?.prompt(selected) || ''}</code>{' '}
                so it picks up the spec-kit skill for this plan.
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)] italic">
                {currentFlow?.description}
              </div>
            </div>
          ) : (
            // The terminal record may briefly lag the WS broadcast right
            // after creation — render a thin loading state until App's
            // terminals[] catches up rather than crashing TerminalWindow.
            !currentTerminal ? (
              <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)] italic">
                Spawning {currentAgentDef?.label || 'agent'}…
              </div>
            ) : (
              <div className="flex-1 min-h-0">
                <TerminalWindow
                  // React `key` keyed off slug + session so swapping
                  // plans (or starting a fresh session for the same
                  // plan) forces a clean unmount/remount. Without
                  // this, React reuses the same component instance
                  // and the previous plan's xterm DOM stays in place
                  // visually until output overwrites it — which is
                  // why "the terminal persists when I change plans".
                  key={`${selected}:${currentSessionId}`}
                  sessionId={String(currentSessionId)}
                  name={currentTerminal.name}
                  agentType={currentTerminal.type}
                  isClaude={currentTerminal.type === 'claude'}
                  isCopilot={currentTerminal.type === 'copilot'}
                  windowKey={`panel:plans:${currentSessionId}`}
                  insecure={(insecureMap || {})[String(currentSessionId)] || false}
                  onToggleInsecure={onToggleInsecure}
                  activeSessionId={(resumeMap || {})[String(currentSessionId)]}
                  reconnectSignal={((terminalReconnectSignals || {})[String(currentSessionId)] || 0)
                    + ((terminalReconnectSignals || {})['__server_restart__'] || 0)}
                  // chromeless: hide the terminal's own header (the
                  // outer Plans panel owns the chrome) but keep input
                  // wired so the user can actually type. `minimal`
                  // would also disable keystrokes (it's the read-only
                  // automation-terminal mode).
                  chromeless
                  onClose={() => {}}
                  onMinimize={() => {}}
                  onMaximize={() => {}}
                />
              </div>
            )
          )}
        </div>
      </div>

      <NewPlanModal open={showNew} onClose={() => setShowNew(false)} onCreated={handleCreated} />
      <SwapConfirmModal
        open={!!pendingSwap}
        prevAgentLabel={aiAgents.find((a) => a.type === pendingSwap?.from)?.label || pendingSwap?.from || ''}
        nextAgentLabel={aiAgents.find((a) => a.type === pendingSwap?.to)?.label || pendingSwap?.to || ''}
        onCancel={() => setPendingSwap(null)}
        onKeep={() => acceptSwap('keep')}
        onDiscard={() => acceptSwap('discard')}
      />
    </div>
  );
}

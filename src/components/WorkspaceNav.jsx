import { useState, useRef, useCallback, useEffect } from 'react';
import StatusDot from './StatusDot';
import SidebarPreview from './SidebarPreview';
import { startComponent, stopComponent, restartComponent } from '../hooks/useComponentStatus';
import { apiFetch, wsUrl, isAuthWsClose, notifyWsAuthFailed } from '../auth';
import { apiUrl } from '../apiBase';
import AppSlot from '../apps/AppSlot';
import { GITHUB_PRS_PATH, GITHUB_REFRESH_PATH, GITHUB_STREAM_PATH } from '../lib/githubApi';

/**
 * Top-bar nav entry for "Workspace". A hover popover that consolidates
 * everything that used to live in the left sidebar plus the standalone
 * Settings / Knowledge Base / Debugger / Repos top buttons.
 *
 * Layout (top to bottom):
 *   - Settings              (action)
 *   - Repos                 (submenu — repo list + actions)
 *   - Debugger              (action; pulses red when a debug session is paused)
 *   - ────────
 *   - Components            (submenu — components grouped by category)
 *
 * Submenus open to the right of the parent row. Only one submenu can be
 * open at a time. The popover closes CLOSE_DELAY_MS after the mouse
 * genuinely leaves everything (root, popover, and any submenu — each
 * explicitly cancels the pending close on mouseenter, not just via
 * bubbling, so it never closes mid-move while crossing the dead-zone gaps
 * between rows and their submenus), on click-outside, or on picking an
 * item.
 */

const HIDDEN_CATEGORIES = new Set(['System']);
const CATEGORY_ORDER = ['Platform', 'APIs', 'Apps', 'Docker', 'Service', 'Tools'];

// ---- Tiny inline icons ------------------------------------------------------

function ChevronRight() {
  return (
    <svg className="w-3 h-3 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
    </svg>
  );
}

function ReposIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
    </svg>
  );
}

function ApisIcon() {
  // Bolt/lightning glyph — visually echoes Hoppscotch's brand mark and
  // reads as "fast/request" without needing color. Keeps the muted-text
  // palette consistent with Repos / KB icons.
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

// Named icon set for workspace apps — kept in sync with AwConfigTab.jsx IconPicker
// and the _ICON_SVGS dict in app_proxy.py (used on the splash page).
const WORKSPACE_APP_ICONS = {
  bolt:     <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>,
  globe:    <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  code:     <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  terminal: <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  database: <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
  git:      <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>,
  cloud:    <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>,
  shield:   <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  mail:     <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  star:     <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  box:      <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
  monitor:  <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  'book-open': <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
};

/**
 * Renders the icon for a workspace app nav entry.
 * - Named icon (e.g. "bolt", "globe"): renders inline SVG from registry
 * - URL / path (starts with http / / / data:): renders as <img>
 * - Empty / unknown: falls back to ApisIcon (bolt)
 */
function WorkspaceAppIcon({ icon, label }) {
  if (!icon) return <ApisIcon />;
  if (icon.startsWith('http') || icon.startsWith('/') || icon.startsWith('data:')) {
    return (
      <img
        src={icon}
        alt=""
        className="w-3.5 h-3.5 shrink-0 object-contain rounded-sm"
        style={{ opacity: 0.75 }}
      />
    );
  }
  if (WORKSPACE_APP_ICONS[icon]) return WORKSPACE_APP_ICONS[icon];
  // Unknown name → first letter in a tiny box
  return (
    <span className="w-3.5 h-3.5 shrink-0 rounded-sm text-[8px] font-bold flex items-center justify-center leading-none bg-white/10 text-[var(--color-text-muted)]">
      {(label || icon || '?')[0].toUpperCase()}
    </span>
  );
}

function StackIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

// Clipboard-with-checkmark — reads as "test/verification record".
// ---- Component --------------------------------------------------------------

export default function WorkspaceNav({
  setView,
  components,
  openWindows,
  onToggleWindow,
  onAction,
  onOpenSettings,
  onOpenApp,
  workspaceApps,
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState(null); // 'repos' | 'components' | null
  const rootRef = useRef(null);
  const closeTimer = useRef(null);
  // CLOSE_DELAY_MS must comfortably outlast the time it takes to move the
  // pointer across the dead-zone gaps between the button and the popover
  // (mt-2) and between a row and its submenu (ml-1) — those gaps aren't
  // covered by any element, so the pointer is briefly over neither during a
  // normal diagonal move, and a too-short delay closed the menu mid-move.
  const CLOSE_DELAY_MS = 500;

  // Floating log/terminal preview, identical to the old sidebar's hover preview.
  // Triggered by hovering a row inside the Components submenu (300 ms grace).
  const [hoverItem, setHoverItem] = useState(null); // { key, type, name, component, rect }
  const hoverTimer = useRef(null);

  const handleItemHover = useCallback((key, type, name, component, e) => {
    clearTimeout(hoverTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => {
      setHoverItem({ key, type, name, component, rect });
    }, 300);
  }, []);

  const handleItemLeave = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setHoverItem(null);
  }, []);

  // Cancels any pending auto-close — called on mouseenter of the root AND,
  // explicitly, of every submenu popover (not just relying on bubbling from
  // the root), so re-entering after crossing a dead-zone gap always keeps
  // the menu open regardless of how long that crossing takes.
  const handleEnter = useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);
  const scheduleClose = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setSubmenu(null);
      setHoverItem(null);
    }, CLOSE_DELAY_MS);
  }, []);
  useEffect(() => () => {
    clearTimeout(closeTimer.current);
    clearTimeout(hoverTimer.current);
  }, []);

  // Click-outside-to-close as a second, independent path — e.g. clicking
  // straight into the page instead of moving the mouse away.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        clearTimeout(closeTimer.current);
        setOpen(false);
        setSubmenu(null);
        setHoverItem(null);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const enterSub = (name) => () => {
    setSubmenu(name);
  };
  const closeSub = () => setSubmenu(null);

  // ---- Repos: WS subscription, lives as long as WorkspaceNav is mounted -----
  const [repos, setRepos] = useState([]);
  const [reposError, setReposError] = useState(null);
  const [busyRepo, setBusyRepo] = useState(null);
  const [flash, setFlash] = useState({});

  useEffect(() => {
    let ws;
    let reconnectTimer;
    let closed = false;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl(GITHUB_STREAM_PATH));
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'github_init' || msg.type === 'github_update') {
              setRepos(msg.repos || []);
              setReposError(msg.error || null);
            }
          } catch {}
        };
        ws.onclose = (event) => {
          // A bad/expired token gets 4401 forever — retrying just hot-loops
          // silently against the auth wall. Stop, and surface it instead.
          if (isAuthWsClose(event.code)) {
            setReposError('Session expired — log in again');
            notifyWsAuthFailed();
            return;
          }
          if (!closed) reconnectTimer = setTimeout(connect, 5000);
        };
        ws.onerror = () => ws.close();
      } catch {
        if (!closed) reconnectTimer = setTimeout(connect, 5000);
      }
    };
    apiFetch(GITHUB_PRS_PATH).then((r) => r.json()).then((d) => setRepos(d.repos || [])).catch(() => {});
    connect();
    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      if (ws) { ws.onclose = null; try { ws.close(); } catch {} }
    };
  }, []);

  const flashFor = (path, kind, ms = 2000) => {
    setFlash((p) => ({ ...p, [path]: kind }));
    setTimeout(() => setFlash((p) => { const n = { ...p }; delete n[path]; return n; }), ms);
  };

  const refreshRepos = useCallback(async () => {
    try {
      const res = await apiFetch(GITHUB_REFRESH_PATH, { method: 'POST' });
      const d = await res.json();
      setRepos(d.repos || []);
    } catch {}
  }, []);

  // /api/git/pull was a phantom endpoint — never existed in the backend
  // (core or app). Real pull/push now live on aw-app-git's own mount
  // (apps/git/git_app/plugin.py), which hot-reloads independently of
  // aw-workspace core.
  const pullRepo = async (r) => {
    setBusyRepo(r.path);
    setReposError(null);
    try {
      const res = await apiFetch('/api/apps/git/pull', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: r.path }),
      });
      const data = await res.json();
      if (data.success) { flashFor(r.path, 'success'); refreshRepos(); }
      else { flashFor(r.path, 'error'); setReposError(`${r.name}: ${data.error || 'pull failed'}`); }
    } catch (e) {
      flashFor(r.path, 'error');
      setReposError(`${r.name}: ${e.message}`);
    } finally {
      setBusyRepo(null);
    }
  };

  const pushRepo = async (r) => {
    setBusyRepo(r.path);
    setReposError(null);
    try {
      const res = await apiFetch('/api/apps/git/push', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: r.path }),
      });
      const data = await res.json();
      if (data.success) { flashFor(r.path, 'success'); refreshRepos(); }
      else { flashFor(r.path, 'error'); setReposError(`${r.name}: ${data.error || 'push failed'}`); }
    } catch (e) {
      flashFor(r.path, 'error');
      setReposError(`${r.name}: ${e.message}`);
    } finally {
      setBusyRepo(null);
    }
  };

  // Up-arrow: ask aw-app-diff-tool to render a diff, then open its window
  // directly with the diff_id from this POST's own response (no need to wait
  // on that app's diff_open WS broadcast — the other entry point, an agent's
  // show_diff MCP call, needs the broadcast since nobody in this tab
  // triggered it; a click here already has the id in hand). On failure we
  // keep the popover open and surface the error inline (e.g. "No changes
  // found"), otherwise the user clicks and gets zero feedback.
  const diffRepo = async (r) => {
    setBusyRepo(r.path);
    setReposError(null);
    try {
      const res = await apiFetch('/api/apps/diff-tool/diffs/render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: r.path,
          ref: r.diff_ref || 'HEAD~1',
          title: `${r.name}${r.ahead ? `: ${r.ahead} ahead` : ''}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.success) {
        flashFor(r.path, 'success');
        window.__awOpenAppWindow?.('diff-tool.viewer', data.diff_id, `${r.name} diff`);
        setOpen(false);
        setSubmenu(null);
      } else {
        flashFor(r.path, 'error');
        setReposError(`${r.name}: ${data?.error || 'diff failed'}`);
      }
    } catch (e) {
      flashFor(r.path, 'error');
      setReposError(`${r.name}: ${e.message}`);
    } finally {
      setBusyRepo(null);
    }
  };

  // Open a plain terminal then write `cd '<path>'\r` once attached.
  // Avoids the shlex issue we hit before with a piped `cd ... && exec $SHELL`.
  const openRepoTerminal = async (r) => {
    try {
      const res = await apiFetch('/api/terminals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: r.name }),
      });
      const data = await res.json();
      if (!data.id) {
        flashFor(r.path, 'error');
        setReposError(`${r.name}: failed to create terminal`);
        return;
      }
      if (window.__awOpenTerminal) {
        window.__awOpenTerminal(data.id);
        setOpen(false);
      }
      const escaped = (r.path || '').replace(/'/g, "'\\''");
      setTimeout(() => {
        apiFetch(`/api/terminals/${data.id}/write`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `cd '${escaped}'\r` }),
        }).catch(() => {});
      }, 350);
    } catch (e) {
      flashFor(r.path, 'error');
      setReposError(`${r.name}: ${e.message}`);
    }
  };

  // Open the repo in code-server (this workspace's browser-based VS Code),
  // via the aw-app-code-server app route — not a `vscode://` desktop URI or
  // the monolith's `vscode.app.<host>` subdomain, neither of which exist
  // here. Repo paths are already absolute under /opt/aw-workspace, which is
  // exactly where aw-app-code-server mounts the workspace tree, so no path
  // rewrite is needed. Routed through apiUrl() (not a raw relative
  // window.open) because on a BYOD three-plane deployment the SPA can be
  // served from a bare host with no same-origin /api/apps/* route.
  const openRepoInCodeServer = (r) => {
    const payload = JSON.stringify([['openFile', `vscode-remote:${r.path}`]]);
    const url = `/api/apps/code-server/?folder=${encodeURIComponent(r.path)}&payload=${encodeURIComponent(payload)}`;
    window.open(apiUrl(url), 'aw-vscode-file', 'popup=1,width=1400,height=900');
    setOpen(false);
  };

  // ---- Components: group by category ---------------------------------------
  const groups = {};
  (components || []).forEach((c) => {
    const cat = c.category || 'Other';
    if (HIDDEN_CATEGORIES.has(cat)) return;
    if (c.menu_display === false) return;
    (groups[cat] = groups[cat] || []).push(c);
  });
  const sortedCategories = Object.keys(groups).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  return (
    <div className="relative" ref={rootRef} onMouseEnter={handleEnter} onMouseLeave={scheduleClose}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1 text-xs rounded transition-colors cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5"
      >
        Workspace
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-2"
          style={{ minWidth: 240, maxWidth: 320 }}
        >
          {/* Settings */}
          <button
            onClick={() => { setOpen(false); onOpenSettings?.(); }}
            onMouseEnter={closeSub}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer text-left"
          >
            <GearIcon />
            <span className="text-[13px] text-[var(--color-text-primary)]">Settings</span>
          </button>

          {/* Decoupled-apps (F6 Cap 2): nav entries an installed app registers
              into core.nav.workspace render here (e.g. the Repos migration's
              signed RepoNav contribution). Empty until an app contributes. */}
          <AppSlot slot="core.nav.workspace" />

          {/* Repos */}
          <div className="relative" onMouseEnter={enterSub('repos')}>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer">
              <ReposIcon />
              <span className="flex-1 text-[13px] text-[var(--color-text-primary)]">Repos</span>
              {repos.length > 0 && (
                <span className="text-[10px] text-[var(--color-text-muted)]">{repos.length}</span>
              )}
              <ChevronRight />
            </div>
            {submenu === 'repos' && (
              <div
                onMouseEnter={handleEnter}
                className="absolute left-full top-0 ml-1 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-2"
                style={{ minWidth: 360, maxWidth: 520 }}
              >
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                  <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                    Repositories · {repos.length}
                  </span>
                  <button
                    onClick={refreshRepos}
                    className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                    title="Refresh repo status"
                  >
                    ↻ Refresh
                  </button>
                </div>
                {reposError && (
                  <div className="mx-1 mb-2 px-2 py-1 text-[11px] rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30">
                    {reposError}
                  </div>
                )}
                {repos.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)] italic">
                    No repos configured.
                  </div>
                ) : (
                  <div className="overflow-y-auto" style={{ maxHeight: '70vh' }}>
                    {repos.map((r) => {
                      const busy = busyRepo === r.path;
                      const fl = flash[r.path];
                      return (
                        <div
                          key={r.name}
                          className={`group flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-pointer ${
                            fl === 'success' ? 'bg-green-500/10' :
                            fl === 'error' ? 'bg-red-500/10' :
                            'hover:bg-white/[0.05]'
                          }`}
                          onClick={() => openRepoInCodeServer(r)}
                          title={`Open ${r.path} in VSCode (code-server)`}
                        >
                          <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] text-[var(--color-text-primary)] truncate">{r.name}</span>
                              {r.dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Has local changes" />}
                              {r.diff_ref && r.ahead > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--color-accent)]/15 text-[var(--color-accent)] shrink-0">
                                  +{r.ahead}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-[var(--color-text-muted)] truncate">{r.branch || '?'}</div>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => pullRepo(r)}
                              disabled={busy}
                              className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-green-400 transition-colors disabled:opacity-50"
                              title="Fetch & pull latest"
                            >
                              <svg className={`w-3.5 h-3.5 ${busy ? 'animate-spin [animation-direction:reverse]' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 5v14M5 12l7 7 7-7" />
                              </svg>
                            </button>
                            <button
                              onClick={() => pushRepo(r)}
                              disabled={busy}
                              className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-fuchsia-400 transition-colors disabled:opacity-50"
                              title="Push to remote"
                            >
                              {/* Upload-tray glyph (arrow + baseline) — distinct
                                  from the Diff button's plain up-arrow below,
                                  which stays a diff action, not push. */}
                              <svg className={`w-3.5 h-3.5 ${busy ? 'animate-spin [animation-direction:reverse]' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 3v12" />
                                <path d="M7 8l5-5 5 5" />
                                <path d="M5 21h14" />
                              </svg>
                            </button>
                            <button
                              onClick={() => diffRepo(r)}
                              className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                              title="Show diff"
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 19V5M5 12l7-7 7 7" />
                              </svg>
                            </button>
                            <button
                              onClick={() => openRepoTerminal(r)}
                              className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-amber-400 transition-colors"
                              title={`Open terminal in ${r.name}`}
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="4 17 10 11 4 5" />
                                <line x1="12" y1="19" x2="20" y2="19" />
                              </svg>
                            </button>
                            <button
                              onClick={() => openRepoInCodeServer(r)}
                              className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-sky-400 transition-colors"
                              title={`Open ${r.name} in VSCode (code-server)`}
                            >
                              {/* Code-bracket glyph — visually distinct from
                                  the row-level grid icon and the terminal's
                                  chevron. Matches the "open in editor"
                                  affordance used elsewhere in the UI. */}
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="16 18 22 12 16 6" />
                                <polyline points="8 6 2 12 8 18" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Workspace Apps — dynamic list from aw.json workspace_apps.
              Only entries with menu === "workspace" land here; "apps" goes
              to the AppsNav popover, "top" goes to the top bar. No fallback
              when the list is empty — the legacy APIs/Hoppscotch entry was
              removed from this menu. */}
          {(workspaceApps || [])
            .filter(app => app.menu === 'workspace')
            .map(app => (
              <button
                key={app.id}
                onClick={() => {
                  onOpenApp?.(app.id);
                  setOpen(false);
                }}
                onMouseEnter={closeSub}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer text-left"
              >
                <WorkspaceAppIcon icon={app.icon} label={app.label} />
                <span className="text-[13px] text-[var(--color-text-primary)]">{app.label}</span>
              </button>
            ))}

          {/* Whiteboard: contributed by aw-app-whiteboard into the
              core.nav.workspace slot (see the <AppSlot slot="core.nav.workspace" />
              mount near Settings above) — decoupled from core per the same
              2026-08-04 decision that moved Tasks. Empty until that app is
              installed and its bundle loads. */}

          {/* Remote Desktop: moved out of core into aw-app-remote-screen
              (2026-08-15) — the app contributes its own nav entry, so core
              no longer carries one. */}

          {/* Tasks: contributed by aw-app-tasks into the core.nav.workspace
              slot (see the <AppSlot slot="core.nav.workspace" /> mount near
              Settings above) — decoupled from core per the same 2026-08-04
              decision that moved the Agents nav into aw-app-code-agent-clis.
              Empty until that app is installed and its bundle loads. */}

          {/* Components */}
          <div className="relative" onMouseEnter={enterSub('components')}>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer">
              <StackIcon />
              <span className="flex-1 text-[13px] text-[var(--color-text-primary)]">Components</span>
              <ChevronRight />
            </div>
            {submenu === 'components' && (
              <div
                onMouseEnter={handleEnter}
                className="absolute left-full top-0 ml-1 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-2"
                style={{ minWidth: 280, maxWidth: 360 }}
              >
                <div className="overflow-y-auto" style={{ maxHeight: '70vh' }}>
                  {sortedCategories.length === 0 ? (
                    <div className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)] italic">
                      No components.
                    </div>
                  ) : sortedCategories.map((category) => (
                    <div key={category} className="mb-2 last:mb-0">
                      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                        {category}
                      </div>
                      {groups[category].map((c) => {
                        const isOpen = openWindows.has(c.key);
                        const isRunning = c.status === 'running' || c.status === 'boot';
                        return (
                          <div
                            key={c.key}
                            className={`group flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-pointer ${
                              isOpen
                                ? 'bg-white/[0.06] text-[var(--color-text-primary)]'
                                : 'hover:bg-white/[0.04]'
                            }`}
                            onClick={() => { onToggleWindow(c.key); setOpen(false); }}
                            onMouseEnter={(e) => handleItemHover(c.key, 'component', c.key, c, e)}
                            onMouseLeave={handleItemLeave}
                          >
                            <StatusDot status={c.status} />
                            <span className="flex-1 truncate text-[13px] text-[var(--color-text-primary)]">{c.key}</span>
                            <span className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {!isRunning && (
                                <button onClick={() => Promise.resolve(startComponent(c.key)).then(onAction)} className="p-1 rounded hover:bg-white/10" title="Start">
                                  <svg className="w-3.5 h-3.5 text-green-400" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                                </button>
                              )}
                              {isRunning && (
                                <>
                                  <button onClick={() => Promise.resolve(stopComponent(c.key)).then(onAction)} className="p-1 rounded hover:bg-white/10" title="Stop">
                                    <svg className="w-3.5 h-3.5 text-red-400" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                                  </button>
                                  <button onClick={() => Promise.resolve(restartComponent(c.key)).then(onAction)} className="p-1 rounded hover:bg-white/10" title="Restart">
                                    <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                                  </button>
                                </>
                              )}
                            </span>
                            {c.port && (
                              <span className="group-hover:hidden text-[11px] text-[var(--color-text-muted)] shrink-0">:{c.port}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* Floating log preview — appears 300 ms after hovering a component row
          inside the Components submenu. Pointer-events: none, so it never
          competes with the popover's mouse-leave timing. */}
      {hoverItem && (
        <SidebarPreview
          componentKey={hoverItem.key}
          component={hoverItem.component}
          anchorRect={hoverItem.rect}
          type={hoverItem.type}
          name={hoverItem.name}
        />
      )}
    </div>
  );
}

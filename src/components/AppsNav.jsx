import { useState, useRef, useCallback, useEffect } from 'react';
import StatusDot from './StatusDot';
import { startComponent, stopComponent, restartComponent } from '../hooks/useComponentStatus';
import { apiFetch } from '../auth';

/**
 * Top-bar nav entry for "Apps". A hover popover that lists every
 * workspace_apps entry whose `menu` field is "apps" (the default for
 * new apps). Sits to the right of the Workspace nav button.
 *
 * Each row:
 *   - status dot (live component health, when an `app.component` is set)
 *   - icon (named SVG or custom URL/path)
 *   - label
 *   - hover-visible start / stop / restart buttons (same shape used in
 *     Sidebar's components list) — only when `app.component` is set so
 *     we know which docker service to control. No port shown; this
 *     popover is the "launch + control" surface, not the diagnostic one.
 *
 * Clicking the row body calls `onOpenApp(app.id)` which opens the
 * floating AppProxyWindow. Clicking a control button stops propagation
 * so it doesn't also open the window.
 */

// ---- Icon set — kept in sync with WorkspaceNav.jsx WORKSPACE_APP_ICONS -----

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
};

function FallbackIcon() {
  // Bolt — matches the muted-text palette used elsewhere.
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

function AppIcon({ icon, label }) {
  if (!icon) return <FallbackIcon />;
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
  return (
    <span className="w-3.5 h-3.5 shrink-0 rounded-sm text-[8px] font-bold flex items-center justify-center leading-none bg-white/10 text-[var(--color-text-muted)]">
      {(label || icon || '?')[0].toUpperCase()}
    </span>
  );
}

// ---- Component --------------------------------------------------------------

export default function AppsNav({ workspaceApps, components, onOpenApp }) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const closeTimer = useRef(null);

  const handleEnter = useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);
  const handleLeave = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // "Start building" launches the App Builder claude session. We POST to
  // /api/app-builder/start which reads aw.json.app_builder.command_template
  // and spawns it as a new terminal. The terminal_update WS event then
  // surfaces it in the UI's Agents list automatically. Disabled while in
  // flight so a double-click doesn't open two sessions.
  const handleStartBuilding = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    try {
      const res = await apiFetch('/api/app-builder/start', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      const sid = data?.session_id;
      if (!sid || !window.__awOpenTerminal) return;

      // Auto-pop the terminal window. There's a race between
      //   a) HTTP response (carries the session_id)
      //   b) /ws/status terminal_update broadcast (registers the
      //      session in App's `terminals` state)
      // Calling __awOpenTerminal before (b) lands sometimes adds the
      // window key to openWindows before WindowManager has positioned
      // it cleanly — the user sees nothing. The deterministic fix is to
      // wait for the `aw-terminals-update` event matching THIS session
      // and open afterwards. We also keep a 1.5s safety timeout in case
      // the WS event was missed (e.g. tab was throttled in the
      // background) so the button never feels like a dead-end.
      const openOnce = (() => {
        let fired = false;
        return () => {
          if (fired) return;
          fired = true;
          window.removeEventListener('aw-terminals-update', onUpdate);
          window.__awOpenTerminal(sid);
        };
      })();
      function onUpdate(e) {
        const d = e?.detail || {};
        if (d.action === 'create' && (d.session_id === sid || d.terminal?.id === sid)) {
          openOnce();
        }
      }
      window.addEventListener('aw-terminals-update', onUpdate);
      setTimeout(openOnce, 1500);
    } catch (_) {
      // Surfacing errors here is low-value — the terminal-update WS
      // event will either show the new session or it won't. Console
      // suffices for diagnostics.
      // eslint-disable-next-line no-console
      console.warn('Start building failed', _);
    } finally {
      setStarting(false);
      setOpen(false);
    }
  }, [starting]);

  const apps = (workspaceApps || [])
    .filter((a) => a.menu === 'apps')
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

  // The Apps entry stays visible even when zero apps are configured,
  // because "Start building" is always available. (Previously we hid
  // the popover when apps.length === 0; that's no longer the right
  // behaviour now that the popover is the entry point for new apps.)

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1 text-xs rounded transition-colors cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5"
      >
        Apps
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-2"
          style={{ minWidth: 220, maxWidth: 320 }}
        >
          {apps.length === 0 && (
            <div className="px-2 py-1.5 text-[11px] text-[var(--color-text-muted)]">
              No apps yet — start building one below.
            </div>
          )}
          {apps.map((app) => {
            const compStatus = app.component
              ? (components.find((c) => c.key === app.component)?.status || 'off')
              : null;
            const isRunning = compStatus === 'running' || compStatus === 'boot';
            // Row is a div (not button) so we can nest control buttons
            // inside it — nested <button> elements are invalid HTML and
            // some browsers swallow the inner click.
            return (
              <div
                key={app.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onOpenApp?.(app.id);
                  setOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenApp?.(app.id);
                    setOpen(false);
                  }
                }}
                className="group w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer text-left"
                title={`${app.label}${compStatus ? ` · ${compStatus}` : ''}`}
              >
                {compStatus ? <StatusDot status={compStatus} /> : <span className="w-1.5 h-1.5 shrink-0" />}
                <AppIcon icon={app.icon} label={app.label} />
                <span className="flex-1 text-[13px] text-[var(--color-text-primary)] truncate">{app.label}</span>
                {/* Hover-only control buttons. stopPropagation on the
                    wrapper so the buttons don't also fire onOpenApp. */}
                {app.component && (
                  <span
                    className="hidden group-hover:flex items-center gap-0.5 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isRunning && (
                      <button
                        onClick={() => startComponent(app.component)}
                        className="p-1 rounded hover:bg-white/10 cursor-pointer"
                        title="Start"
                      >
                        <svg className="w-3.5 h-3.5 text-green-400" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      </button>
                    )}
                    {isRunning && (
                      <>
                        <button
                          onClick={() => stopComponent(app.component)}
                          className="p-1 rounded hover:bg-white/10 cursor-pointer"
                          title="Stop"
                        >
                          <svg className="w-3.5 h-3.5 text-red-400" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                        </button>
                        <button
                          onClick={() => restartComponent(app.component)}
                          className="p-1 rounded hover:bg-white/10 cursor-pointer"
                          title="Restart"
                        >
                          <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                        </button>
                      </>
                    )}
                  </span>
                )}
              </div>
            );
          })}

          {/* Divider + "Start building" — always the last item. Triggers
              POST /api/app-builder/start which spawns the configured
              claude CLI in a new terminal. The terminal_update WS event
              wires the new session into the UI's Agents list. */}
          {apps.length > 0 && <div className="my-1 h-px bg-white/10" aria-hidden="true" />}
          <div
            role="button"
            tabIndex={0}
            onClick={handleStartBuilding}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleStartBuilding();
              }
            }}
            className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-left ${
              starting ? 'opacity-60 pointer-events-none' : 'hover:bg-white/[0.06]'
            }`}
            title="Start a new App Builder claude session"
          >
            <span className="w-1.5 h-1.5 shrink-0" />
            <svg
              className="w-3.5 h-3.5 shrink-0 text-[var(--color-accent,#4a9eff)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="flex-1 text-[13px] text-[var(--color-text-primary)] truncate">
              {starting ? 'Starting…' : 'Start building'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

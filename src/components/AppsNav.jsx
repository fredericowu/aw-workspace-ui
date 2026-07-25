import { useState, useCallback } from 'react';
import { apiFetch } from '../auth';
import AppLauncher from './AppLauncher';

/**
 * Top-bar nav entry for "Apps". Click opens the full-screen "Mission
 * Control" App Launcher (see AppLauncher.jsx) — a live-tile grid of every
 * workspace_apps entry whose `menu` field is "apps" (the default for new
 * apps), sorted by `order`. Sits to the right of the Workspace nav button.
 *
 * Data wiring is unchanged from the old hover popover this replaced:
 * `workspaceApps`/`components` still come straight from App.jsx's real
 * `/api/settings/aw` + `/api/components` state — AppLauncher.jsx does the
 * same filter/sort/status-lookup the popover used to do inline.
 *
 * Clicking a tile calls `onOpenApp(app.id)` which opens the floating
 * AppProxyWindow, same as before.
 */
export default function AppsNav({ workspaceApps, components, onOpenApp }) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);

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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-3 py-1 text-xs rounded transition-colors cursor-pointer ${
          open
            ? 'text-[var(--color-text-primary)] bg-white/[0.07]'
            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5'
        }`}
      >
        Apps
      </button>

      {open && (
        <AppLauncher
          workspaceApps={workspaceApps}
          components={components}
          starting={starting}
          onOpenApp={(appId) => {
            onOpenApp?.(appId);
            setOpen(false);
          }}
          onStartBuilding={handleStartBuilding}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

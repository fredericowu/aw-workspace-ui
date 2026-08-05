import { useState, useCallback } from 'react';
import AppLauncher from './AppLauncher';
import { consumeUiRefreshNeeded, reloadForUiRefresh } from '../apps/uiRefresh';

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
export default function AppsNav({ workspaceApps, components, onOpenApp, onOpenInstalledApp }) {
  const [open, setOpen] = useState(false);

  // Closing the Apps panel is the one place every install/config-save path
  // funnels through (Marketplace and the config gear both live inside
  // AppLauncher, which this mounts/unmounts). If anything marked a pending
  // UI refresh (an app whose manifest declares requires_ui_refresh — see
  // ../apps/uiRefresh), do a real navigation reload instead of just
  // unmounting, so a newly-contributed nav entry/slot actually shows up.
  const closeLauncher = useCallback(() => {
    if (consumeUiRefreshNeeded()) { reloadForUiRefresh(); return; }
    setOpen(false);
  }, []);

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
          onOpenApp={(appId) => {
            onOpenApp?.(appId);
            setOpen(false);
          }}
          onOpenInstalledApp={(appId) => {
            onOpenInstalledApp?.(appId);
            setOpen(false);
          }}
          onClose={closeLauncher}
        />
      )}
    </div>
  );
}

// App — the Direção B (Signal Amber) dashboard shell: topbar nav, windows
// area (WindowShell-hosted AppWindow/SettingsPanel instances), and the
// full-screen AppLauncher overlay. Wires the shape from the ux-proto
// prototype's app.js (state.windows / openWindow / openAppLauncher /
// renderNavTabs) into a real React component tree.

import { useCallback, useEffect, useState } from "react";
import Topbar from "./components/Topbar.jsx";
import WindowShell from "./components/WindowShell.jsx";
import { ShellIcon } from "./components/Icons.jsx";
import { Content as AppWindowContent, descriptor as appWindowDescriptor } from "./components/AppWindow.jsx";
import { Content as SettingsContent, descriptor as settingsDescriptor } from "./components/SettingsPanel.jsx";
import AppLauncher from "./components/AppLauncher.jsx";
import { apiGet } from "./api/client.js";

// Small static fallback so the launcher/app-window flow is demoable even
// before /api/settings/aw + /api/components exist on the fresh aw-backend
// (see loadWorkspaceApps() below — this is what production/ux-proto's
// WORKSPACE_APPS starts as before the first successful fetch).
const FALLBACK_APPS = [
  { id: "ux-proto", label: "UX Proto", icon: "code", key: "docker:aw-custom-ux-proto", hasStatus: true, running: true, color: "#6366f1" },
  { id: "crispal", label: "Crispal", icon: "box", key: "docker:aw-custom-crispal", hasStatus: true, running: true, color: "#059669" },
  { id: "kanban", label: "Kanban", icon: "database", key: "docker:aw-custom-kanban", hasStatus: false, running: false, color: "#ca8a04" },
];

const APP_TILE_PALETTE = ["#6366f1", "#059669", "#ca8a04", "#db2777", "#0284c7", "#7c3aed", "#dc2626", "#0d9488", "#9333ea", "#ea580c"];
function colorForApp(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return APP_TILE_PALETTE[hash % APP_TILE_PALETTE.length];
}

// Real app LIST — GET /api/settings/aw -> workspace_apps (menu === 'apps'),
// crossed with GET /api/components for running/stopped state. Same shape
// as production's AppsNav.jsx / the ux-proto prototype's loadWorkspaceApps.
// NOTE: as of this pass these two endpoints have not been confirmed to
// exist yet on the fresh aw-backend (repos/aw-backend, api.aw.tekflox.com)
// — this call is plumbing, and callers should expect it may 404 until the
// endpoint is ported. On any failure we keep whatever apps we already had
// (the static fallback on first load).
async function loadWorkspaceApps() {
  const [config, components] = await Promise.all([apiGet("/api/settings/aw"), apiGet("/api/components")]);
  const byKey = new Map((components || []).map((c) => [c.key, c.status]));
  return (config.workspace_apps || [])
    .filter((a) => a.menu === "apps")
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
    .map((a) => {
      const status = a.component ? byKey.get(a.component) : undefined;
      return {
        id: a.id,
        label: a.label,
        icon: a.icon,
        component: a.component,
        key: a.component || a.id,
        hasStatus: !!a.component,
        running: status === "running" || status === "boot",
        color: colorForApp(a.id),
      };
    });
}

let winCounter = 0;

export default function App() {
  const [openDropdown, setOpenDropdown] = useState(null);
  const [appLauncherOpen, setAppLauncherOpen] = useState(false);
  const [windows, setWindows] = useState([]); // { key, type, title, icon, meta }
  const [focusedKey, setFocusedKey] = useState(null);
  const [apps, setApps] = useState(FALLBACK_APPS);
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((msg) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2600);
  }, []);

  // Warm the app list once on mount — matches the prototype's page-load
  // warm-up call, so the launcher doesn't show an empty grid on first open.
  useEffect(() => {
    loadWorkspaceApps()
      .then((list) => {
        if (list.length) setApps(list);
      })
      .catch((err) => {
        console.warn("Could not load real app list from aw-backend, showing fallback apps:", err);
      });
  }, []);

  const closeAllDropdowns = useCallback(() => {
    setOpenDropdown(null);
  }, []);

  const toggleDropdown = useCallback((key) => {
    setAppLauncherOpen(false);
    setOpenDropdown((prev) => (prev === key ? null : key));
  }, []);

  const focusWindow = useCallback((key) => {
    setFocusedKey(key);
  }, []);

  const openWindow = useCallback((type, title, icon, meta = {}, opts = {}) => {
    setWindows((prev) => {
      const dupe = prev.find((w) => w.type === type && (meta.key ? w.meta.key === meta.key : opts.singleton));
      if (dupe) {
        setFocusedKey(dupe.key);
        return prev;
      }
      winCounter += 1;
      const key = `${type}:${meta.key || winCounter}`;
      setFocusedKey(key);
      return [...prev, { key, type, title, icon, meta }];
    });
  }, []);

  const closeWindow = useCallback((key) => {
    setWindows((prev) => prev.filter((w) => w.key !== key));
  }, []);

  const openAppWindow = useCallback(
    (app) => {
      openWindow("appWindow", app.label, "bolt", app);
      setAppLauncherOpen(false);
    },
    [openWindow]
  );

  const openSettings = useCallback(() => {
    openWindow("settingsPanel", "Settings", "gear", {}, { singleton: true });
    setOpenDropdown(null);
  }, [openWindow]);

  const openAppLauncher = useCallback(() => {
    setOpenDropdown(null);
    setAppLauncherOpen(true);
  }, []);

  const closeAppLauncher = useCallback(() => setAppLauncherOpen(false), []);

  const handleLogout = useCallback(() => {
    addToast("Log out — nothing actually happens yet (first pass)");
  }, [addToast]);

  return (
    <div id="shell">
      <Topbar
        openDropdown={openDropdown}
        onToggleDropdown={toggleDropdown}
        onCloseAll={closeAllDropdowns}
        appLauncherOpen={appLauncherOpen}
        onOpenAppLauncher={openAppLauncher}
        onOpenSettings={openSettings}
        onLogout={handleLogout}
      />

      <div id="body-row">
        <div id="main">
          <div id="windows-area">
            {windows.map((w) => {
              const descriptor = w.type === "settingsPanel" ? settingsDescriptor : appWindowDescriptor;
              return (
                <WindowShell
                  key={w.key}
                  windowKey={w.key}
                  title={w.title}
                  icon={<ShellIcon name={w.icon} />}
                  chrome={descriptor.chrome}
                  defaultSize={descriptor.size}
                  focused={focusedKey === w.key}
                  onFocus={() => focusWindow(w.key)}
                  onClose={() => closeWindow(w.key)}
                >
                  {w.type === "settingsPanel" ? (
                    <SettingsContent toast={addToast} />
                  ) : (
                    <AppWindowContent app={w.meta} />
                  )}
                </WindowShell>
              );
            })}
          </div>

          {windows.length === 0 ? (
            <div id="home-empty">
              <div className="home-empty-inner">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 21V9" />
                </svg>
                <p>Nothing open.</p>
                <p className="muted">Choose something from the menus above to get started.</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {appLauncherOpen ? <AppLauncher apps={apps} onOpenApp={openAppWindow} onClose={closeAppLauncher} /> : null}

      <div id="toast-stack">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

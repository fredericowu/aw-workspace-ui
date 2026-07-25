// Topbar — Home/Agents/Presentation/Workspace/Apps nav, mirroring the
// prototype's renderNavTabs()/renderAgentsDropdown()/etc (ux-proto app.js,
// ~line 416-520). This pass ports the tab shape, active/open states, and
// simple placeholder dropdown content — full dropdown content (real agent
// sessions list, real presentation list, repos/tasks/components submenus)
// is deferred to a future pass (see README's parity table).

import { useEffect, useRef } from "react";
import Logo from "./Logo.jsx";
import { IconChevDown } from "./Icons.jsx";

const AGENT_LAUNCHERS = ["Claude", "Codex", "Gemini", "Cursor"];

function AgentsDropdown() {
  return (
    <div className="popover" style={{ minWidth: 260 }}>
      <div className="popover-section-title">New</div>
      {AGENT_LAUNCHERS.map((n) => (
        <button type="button" className="popover-item" key={n}>
          <span className="flex1">{n}</span>
        </button>
      ))}
      <div className="popover-sep" />
      <div className="popover-section-title">Sessions</div>
      <div className="empty-note">No open sessions.</div>
    </div>
  );
}

function PresentationDropdown() {
  return (
    <div className="popover" style={{ minWidth: 280 }}>
      <div className="empty-note">No presentations yet.</div>
    </div>
  );
}

function WorkspaceDropdown({ onOpenSettings }) {
  return (
    <div className="popover" style={{ minWidth: 260 }}>
      <button type="button" className="popover-item" onClick={onOpenSettings}>
        <span className="flex1">Settings</span>
      </button>
      <div className="popover-sep" />
      <div className="popover-section-title">Workspace</div>
      <div className="empty-note">Repos / Tasks / Components — coming soon.</div>
    </div>
  );
}

export default function Topbar({
  openDropdown,
  onToggleDropdown,
  onCloseAll,
  appLauncherOpen,
  onOpenAppLauncher,
  onOpenSettings,
  onLogout,
}) {
  const rootRef = useRef(null);

  // Click-outside closes any open dropdown (the prototype's app.js does
  // this via a document-level click listener too).
  useEffect(() => {
    if (!openDropdown) return undefined;
    function handleClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        onCloseAll();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openDropdown, onCloseAll]);

  return (
    <div id="topbar" ref={rootRef}>
      <div className="topbar-left">
        <Logo />
        <div className="nav-tabs" id="nav-tabs">
          <div className="nav-tab">
            <button type="button" className={`nav-tab-btn ${!openDropdown ? "active" : ""}`} onClick={onCloseAll}>
              Home
            </button>
          </div>
          <div className="nav-tab">
            <button
              type="button"
              className={`nav-tab-btn ${openDropdown === "agents" ? "open" : ""}`}
              onClick={() => onToggleDropdown("agents")}
            >
              Agents <IconChevDown />
            </button>
            {openDropdown === "agents" ? <AgentsDropdown /> : null}
          </div>
          <div className="nav-tab">
            <button
              type="button"
              className={`nav-tab-btn ${openDropdown === "presentation" ? "open" : ""}`}
              onClick={() => onToggleDropdown("presentation")}
            >
              Presentation <IconChevDown />
            </button>
            {openDropdown === "presentation" ? <PresentationDropdown /> : null}
          </div>
          <div className="nav-tab">
            <button
              type="button"
              className={`nav-tab-btn ${openDropdown === "workspace" ? "open" : ""}`}
              onClick={() => onToggleDropdown("workspace")}
            >
              Workspace <IconChevDown />
            </button>
            {openDropdown === "workspace" ? <WorkspaceDropdown onOpenSettings={onOpenSettings} /> : null}
          </div>
          <div className="nav-tab">
            <button type="button" className={`nav-tab-btn ${appLauncherOpen ? "open" : ""}`} onClick={onOpenAppLauncher}>
              Apps
            </button>
          </div>
        </div>
      </div>
      <div className="topbar-right">
        <button type="button" className="btn-linklike" onClick={onLogout} title="Sign out">
          Log Out
        </button>
      </div>
    </div>
  );
}

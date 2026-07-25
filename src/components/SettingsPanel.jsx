// SettingsPanel — Content-only module, no chrome of its own (WindowShell
// owns title/icon/chrome buttons/drag/resize/focus/z-order).
//
// 1:1 port of the prototype's src/components/SettingsPanel.js into real JSX.
//
// Real sub-tabs this decouples (src/app/src/components/*Tab.jsx):
// Appearance, AwConfig, Backup, FeedSubscriber, Integrations, McpServers,
// MetaDisplay, Proxy, Skills, TcpProxy, Users, Vpn, WhatsApp, Architecture,
// GitHub, Apps. This first pass mocks 4 (Appearance, MCP Servers, Skills,
// Users) to validate the shell pattern — the rest render a "coming soon"
// empty state instead of a dead end: the tab is real and selectable, its
// content just isn't built out yet.

import { useState } from "react";

export const descriptor = {
  title: "Settings",
  icon: "gear",
  chrome: { minimize: true, maximize: true, close: true },
  size: { width: 760, height: 520 },
  singleton: true,
};

const SECTIONS = [
  { key: "appearance", label: "Appearance", emoji: "🎨", mocked: true },
  { key: "aw-config", label: "AW Config", emoji: "⚙️", mocked: false },
  { key: "backup", label: "Backup", emoji: "💾", mocked: false },
  { key: "feed-subscriber", label: "Feed Subscriber", emoji: "📰", mocked: false },
  { key: "integrations", label: "Integrations", emoji: "🔌", mocked: false },
  { key: "mcp-servers", label: "MCP Servers", emoji: "🧩", mocked: true },
  { key: "meta-display", label: "Meta Display", emoji: "👓", mocked: false },
  { key: "proxy", label: "Proxy", emoji: "🌐", mocked: false },
  { key: "skills", label: "Skills", emoji: "✨", mocked: true },
  { key: "tcp-proxy", label: "TCP Proxy", emoji: "🔀", mocked: false },
  { key: "users", label: "Users", emoji: "👤", mocked: true },
  { key: "vpn", label: "VPN", emoji: "🔒", mocked: false },
  { key: "whatsapp", label: "WhatsApp", emoji: "💬", mocked: false },
  { key: "architecture", label: "Architecture", emoji: "🏗️", mocked: false },
  { key: "github", label: "GitHub", emoji: "🐙", mocked: false },
  { key: "apps", label: "Apps", emoji: "📦", mocked: false },
];

function AppearanceBody({ toast }) {
  return (
    <div>
      <div className="field-row">
        <label>Theme</label>
        <select>
          <option>Dark (default)</option>
          <option>Light</option>
          <option>System</option>
        </select>
      </div>
      <div className="field-row">
        <label>Accent color</label>
        <input type="text" defaultValue="#f5a623" />
      </div>
      <div className="field-row">
        <label>Font size</label>
        <select>
          <option>Small</option>
          <option defaultChecked>Medium</option>
          <option>Large</option>
        </select>
      </div>
      <button type="button" className="mock-btn primary" onClick={() => toast("Appearance saved (mock)")}>
        Save changes
      </button>
    </div>
  );
}

function McpServersBody({ toast }) {
  const servers = ["aw-knowledge-base", "aw-ux-proto", "aw-kanban", "aw-presentation", "aw-tasks"];
  return (
    <div>
      {servers.map((n) => (
        <div className="mock-row" key={n}>
          <span className="stgp-flex1">{n}</span>
          <span className="mock-badge green">running</span>
        </div>
      ))}
      <button type="button" className="mock-btn" style={{ marginTop: 8 }} onClick={() => toast("Reloaded MCP servers (mock)")}>
        Reload all
      </button>
    </div>
  );
}

function UsersBody({ toast }) {
  return (
    <div>
      <div className="mock-row">
        <span className="stgp-flex1">Frederico Wu</span>
        <span className="mock-badge">admin</span>
      </div>
      <button type="button" className="mock-btn" style={{ marginTop: 10 }} onClick={() => toast("Invite link copied (mock)")}>
        + Invite user
      </button>
    </div>
  );
}

function SkillsBody({ toast }) {
  const skills = ["aw", "aw-agents-flow", "aw-kanban", "aw-presentation", "aw-knowledge-base"];
  return (
    <div>
      {skills.map((n) => (
        <div className="mock-row" key={n}>
          <span className="stgp-flex1">{n}</span>
          <button type="button" className="mock-btn" onClick={() => toast(`${n} reloaded (mock)`)}>
            Reload
          </button>
        </div>
      ))}
    </div>
  );
}

function ComingSoonBody({ section }) {
  return (
    <div className="stgp-soon">
      <span className="stgp-soon-emoji">{section.emoji}</span>
      <p className="empty-note">{`${section.label} isn't wired up yet in this pass — coming soon.`}</p>
    </div>
  );
}

function SettingsBody({ activeKey, toast }) {
  switch (activeKey) {
    case "appearance":
      return <AppearanceBody toast={toast} />;
    case "mcp-servers":
      return <McpServersBody toast={toast} />;
    case "users":
      return <UsersBody toast={toast} />;
    case "skills":
      return <SkillsBody toast={toast} />;
    default:
      return <ComingSoonBody section={SECTIONS.find((s) => s.key === activeKey)} />;
  }
}

// Content — tabs + content area only. No titlebar, no close button, no
// drag/resize: the host window's chrome is somebody else's job.
export function Content({ toast = () => {} }) {
  const [activeKey, setActiveKey] = useState("appearance");
  const active = SECTIONS.find((s) => s.key === activeKey);

  return (
    <div className="stgp">
      <div className="stgp-sidebar">
        {SECTIONS.map((s) => (
          <button
            type="button"
            key={s.key}
            className={`stgp-nav-item ${s.key === activeKey ? "active" : ""}`}
            onClick={() => setActiveKey(s.key)}
          >
            <span className="stgp-nav-emoji">{s.emoji}</span>
            <span className="stgp-flex1">{s.label}</span>
            {!s.mocked ? <span className="stgp-nav-soon">soon</span> : null}
          </button>
        ))}
      </div>
      <div className="stgp-content">
        <h3 className="stgp-content-title">{active.label}</h3>
        <SettingsBody activeKey={activeKey} toast={toast} />
      </div>
    </div>
  );
}

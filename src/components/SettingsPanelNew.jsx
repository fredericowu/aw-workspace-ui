// SettingsPanelNew — the grouped/collapsible sidebar redesign of Settings
// (UX-Proto aw-redesign SettingsPanel.js layout: nav on the left, selected
// section's content on the right), living alongside the legacy tab-strip
// SettingsPanel so the two can be compared before the old one is retired.
//
// Two groups for now:
//  - General: same sections the legacy SettingsPanel exposes. Only "Users" is
//    wired to real functionality here — everything else is an intentional
//    "coming soon" placeholder rather than a dead link (Backup is tracked to
//    come back via a Kanban card).
//  - Apps: dynamically built from GET /api/apps (has_config === true), one
//    entry per installed app with configurable settings — reuses
//    AppConfigBody (the same body AppConfigWindow's modal renders) so both
//    surfaces stay in sync automatically.
import { useState, useEffect, useMemo } from 'react';
import UsersTab from './UsersTab';
import AppConfigBody from './AppConfigBody';
import AppIcon from './AppIcon';
import { listInstalledApps } from '../apps/appsApi';

const GENERAL_SECTIONS = [
  { key: 'aw', label: 'AW Config', ready: false },
  { key: 'users', label: 'Users', ready: true },
  { key: 'integrations', label: 'Integrations', ready: false },
  { key: 'tcp-proxy', label: 'TCP Proxy', ready: false },
  { key: 'vpn', label: 'VPN', ready: false },
  { key: 'proxy', label: 'Cookies', ready: false },
  { key: 'feed-subscriber', label: 'Feed Subscriber', ready: false },
  { key: 'backup', label: 'Backup', ready: false },
  { key: 'skills', label: 'Skills', ready: false },
  { key: 'mcp', label: 'MCP Servers', ready: false },
  { key: 'architecture', label: 'Architecture', ready: false },
];

function ChevronDown({ open }) {
  return (
    <svg
      className={`w-3 h-3 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ComingSoon({ label }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <p className="text-sm text-[var(--color-text-muted)]">
        <span className="text-[var(--color-text-primary)] font-medium">{label}</span> ainda não foi migrado
        pra essa tela nova — coming soon.
      </p>
    </div>
  );
}

export default function SettingsPanelNew() {
  const [expanded, setExpanded] = useState({ general: true, apps: true });
  const [selection, setSelection] = useState({ group: 'general', key: 'users' });
  const [apps, setApps] = useState([]);
  const [appsError, setAppsError] = useState(null);

  useEffect(() => {
    let alive = true;
    listInstalledApps()
      .then((d) => { if (alive) setApps((d || []).filter((a) => a.has_config)); })
      .catch((e) => { if (alive) setAppsError(String(e.message || e)); });
    return () => { alive = false; };
  }, []);

  const toggleGroup = (g) => setExpanded((prev) => ({ ...prev, [g]: !prev[g] }));

  const selectedApp = useMemo(
    () => (selection.group === 'apps' ? apps.find((a) => a.slug === selection.key) : null),
    [selection, apps]
  );
  const selectedSection = useMemo(
    () => (selection.group === 'general' ? GENERAL_SECTIONS.find((s) => s.key === selection.key) : null),
    [selection]
  );

  return (
    <div className="h-full flex bg-[var(--color-bg-primary)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-header)] overflow-y-auto py-2">
        {/* General group */}
        <div className="mb-1">
          <button
            onClick={() => toggleGroup('general')}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            <ChevronDown open={expanded.general} />
            General
          </button>
          {expanded.general && (
            <div>
              {GENERAL_SECTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSelection({ group: 'general', key: s.key })}
                  className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-[13px] text-left transition-colors ${
                    selection.group === 'general' && selection.key === s.key
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5'
                  }`}
                >
                  <span className="flex-1 truncate">{s.label}</span>
                  {!s.ready && <span className="text-[9px] text-[var(--color-text-muted)] shrink-0">soon</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Apps group */}
        <div>
          <button
            onClick={() => toggleGroup('apps')}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            <ChevronDown open={expanded.apps} />
            Apps
            {apps.length > 0 && <span className="ml-auto text-[10px] normal-case font-normal">{apps.length}</span>}
          </button>
          {expanded.apps && (
            <div>
              {appsError && (
                <div className="mx-3 my-1 px-2 py-1 text-[11px] rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)]">
                  {appsError}
                </div>
              )}
              {apps.length === 0 && !appsError && (
                <div className="pl-7 pr-3 py-2 text-[12px] text-[var(--color-text-muted)] italic">
                  No apps with settings.
                </div>
              )}
              {apps.map((a) => (
                <button
                  key={a.slug}
                  onClick={() => setSelection({ group: 'apps', key: a.slug })}
                  className={`w-full flex items-center gap-2 pl-7 pr-3 py-1.5 text-[13px] text-left transition-colors ${
                    selection.group === 'apps' && selection.key === a.slug
                      ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5'
                  }`}
                >
                  <AppIcon icon={a.icon} label={a.name} size={13} />
                  <span className="flex-1 truncate">{a.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {selection.group === 'general' && selectedSection && (
          selectedSection.ready
            ? (selectedSection.key === 'users' && <UsersTab />)
            : <ComingSoon label={selectedSection.label} />
        )}
        {selection.group === 'apps' && selectedApp && (
          <div className="max-w-lg">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">{selectedApp.name}</h3>
            <p className="text-[11px] text-[var(--color-text-muted)] mb-3">{selectedApp.slug} · v{selectedApp.version}</p>
            <AppConfigBody app={selectedApp} />
          </div>
        )}
        {selection.group === 'apps' && !selectedApp && apps.length > 0 && (
          <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
            Select an app on the left.
          </div>
        )}
      </div>
    </div>
  );
}

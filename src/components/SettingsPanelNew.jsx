// SettingsPanelNew — the grouped/collapsible sidebar redesign of Settings
// (UX-Proto aw-redesign SettingsPanel.js layout: nav on the left, selected
// section's content on the right), living alongside the legacy tab-strip
// SettingsPanel so the two can be compared before the old one is retired.
//
// Two groups for now:
//  - General: same sections the legacy SettingsPanel exposes. "Users" and
//    "Integrations" are wired to real functionality here — everything else
//    is an intentional "coming soon" placeholder rather than a dead link
//    (Backup is tracked to come back via a Kanban card).
//  - Apps: dynamically built from GET /api/apps (has_config === true), one
//    entry per installed app with configurable settings — reuses
//    AppConfigBody (the same body AppConfigWindow's modal renders) so both
//    surfaces stay in sync automatically.
//
// Responsive (2026-08-25): this component is mounted by BOTH shells — the
// desktop floating window (App.jsx) and the mobile sheet (MobileApp.jsx).
// Below 768px the fixed `w-56` sidebar ate 57% of a 390px viewport, so the
// narrow layout is list-then-detail instead: the nav fills the width, tapping
// a section swaps to its content with a back button. Above 768px nothing
// changed — `detailOpen` is not consulted on that path at all.
import { useState, useEffect, useMemo, useSyncExternalStore } from 'react';
import UsersTab from './UsersTab';
import IntegrationsTab from './IntegrationsTab';
import MarketplaceTab from './MarketplaceTab';
import NetworkingTab from './NetworkingTab';
import RemoteHostsTab from './RemoteHostsTab';
import ObservabilityTab from './ObservabilityTab';
import SkillsTab from './SkillsTab';
import AppConfigBody from './AppConfigBody';
import AppIcon from './AppIcon';
import ErrorBoundary from './ErrorBoundary';
import { listInstalledApps } from '../apps/appsApi';
import { buildSettingsIndex, matchSettingsEntry } from '../lib/settingsSearch';

const GENERAL_SECTIONS = [
  { key: 'users', label: 'Users', ready: true, description: 'Guest logins scoped to a fixed list of apps.' },
  { key: 'integrations', label: 'Integrations', ready: true, description: 'Connect external services and webhooks.' },
  { key: 'marketplace', label: 'Marketplace', ready: true, description: 'Install and manage apps from the catalog.' },
  { key: 'observability', label: 'Observability', ready: true, description: 'Metrics, traces and logs for this workspace.' },
  // Was `{ key: 'vpn', label: 'VPN' }`. Renamed, not just relabelled: the scope
  // grew from "a VPN with an exit node" to the tenant's whole private mesh, of
  // which the exit gate is one feature. Keeping `vpn` would also collide with
  // the legacy SettingsPanel's own `vpn` tab, which is a different thing
  // entirely (the WireGuard/Nord client config in VpnTab.jsx) — nothing outside
  // this file reads these keys today, so the collision is worth removing now
  // rather than after someone wires the two panels' ids together.
  { key: 'networking', label: 'Networking', ready: true, description: 'The tenant private mesh, exit nodes and VPN.' },
  { key: 'remote-hosts', label: 'Remote Hosts', ready: true, description: 'Linked hosts, and how to install aw-remote-host on a new one.' },
  { key: 'feed-subscriber', label: 'Feed Subscriber', ready: false, description: 'Watch external feeds and trigger agent runs.' },
  { key: 'backup', label: 'Backup', ready: false, description: 'Back up and restore workspace state.' },
  { key: 'skills', label: 'Skills', ready: true, description: 'Author and manage native and app-contributed skills.' },
  { key: 'mcp', label: 'MCP Servers', ready: false, description: 'Configure Model Context Protocol server connections.' },
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

// 767px, not a container width: this has to agree with App.jsx's own
// `window.innerWidth <= 768` shell switch, so the two can never disagree about
// which layout is on screen. A container-width observer would get the forced
// `#mobile` case backwards — that renders the mobile sheet full-bleed on a wide
// display, where the sidebar is the RIGHT layout and a narrow one would be a
// downgrade. The viewport is what actually decides whether there is room.
const NARROW_QUERY = '(max-width: 767px)';

function narrowMediaQuery() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(NARROW_QUERY)
    : null;
}

function subscribeNarrow(onChange) {
  const mq = narrowMediaQuery();
  if (!mq) return () => {};
  // addListener is the deprecated spelling, still the only one Safari < 14
  // supports — this screen is read on iPhones, so keep the fallback.
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else mq.addListener(onChange);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener('change', onChange);
    else mq.removeListener(onChange);
  };
}

const getNarrowSnapshot = () => narrowMediaQuery()?.matches ?? false;

// useSyncExternalStore rather than useState+useEffect: matchMedia IS an
// external store, and reading it in an effect meant a first paint at the wrong
// layout plus a setState-in-effect cascade (the lint rule that flagged it is
// right — on a phone that extra frame is a visible flash of the sidebar).
function useIsNarrow() {
  return useSyncExternalStore(subscribeNarrow, getNarrowSnapshot, () => false);
}

function BackChevron() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export default function SettingsPanelNew() {
  const [expanded, setExpanded] = useState({ general: true, apps: true });
  const [selection, setSelection] = useState({ group: 'general', key: 'users' });
  const [apps, setApps] = useState([]);
  const [appsError, setAppsError] = useState(null);
  const [query, setQuery] = useState('');
  const isNarrow = useIsNarrow();
  // Only consulted on the narrow path. The wide layout renders nav and content
  // side by side and ignores this entirely, so desktop behaviour is unchanged.
  // Starts false so the phone opens on the menu rather than dropping the user
  // straight into Users with no visible way back to the section list.
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    listInstalledApps()
      .then((d) => { if (alive) setApps((d || []).filter((a) => a.has_config)); })
      .catch((e) => { if (alive) setAppsError(String(e.message || e)); });
    return () => { alive = false; };
  }, []);

  const toggleGroup = (g) => setExpanded((prev) => ({ ...prev, [g]: !prev[g] }));

  // One entry point for both layouts: wide ignores detailOpen, narrow uses it
  // to swap the list out for the section.
  const select = (group, key) => {
    setSelection({ group, key });
    setDetailOpen(true);
  };

  const selectedApp = useMemo(
    () => (selection.group === 'apps' ? apps.find((a) => a.slug === selection.key) : null),
    [selection, apps]
  );
  const selectedSection = useMemo(
    () => (selection.group === 'general' ? GENERAL_SECTIONS.find((s) => s.key === selection.key) : null),
    [selection]
  );

  // Nav rows get taller on narrow — a 1.5-unit row is a fine mouse target and a
  // poor thumb one, and this list is the only way to reach anything here.
  const rowPad = isNarrow ? 'py-3' : 'py-1.5';
  const rowText = isNarrow ? 'text-[15px]' : 'text-[13px]';

  // base/fullHay depend only on the sections (a module constant) and the
  // fetched apps, so this only recomputes when the app list changes — not on
  // every keystroke. Match provenance (the "Matches X" hint) is query-
  // dependent and computed below, per keystroke, against this index.
  const settingsIndex = useMemo(() => buildSettingsIndex(GENERAL_SECTIONS, apps), [apps]);

  const searching = query.trim().length > 0;

  // Guards A14: an empty query must never be treated as "filter to nothing".
  // matchSettingsEntry() itself already returns matches:false for an empty
  // query, but `searching` is the single flag every filter below checks, so
  // there's exactly one place that can get this wrong.
  const matchHints = useMemo(() => {
    const map = new Map();
    if (!searching) return map;
    for (const entry of settingsIndex) {
      const result = matchSettingsEntry(entry, query);
      if (result.matches) map.set(`${entry.group}:${entry.key}`, result.hint);
    }
    return map;
  }, [settingsIndex, query, searching]);

  const visibleSections = searching
    ? GENERAL_SECTIONS.filter((s) => matchHints.has(`general:${s.key}`))
    : GENERAL_SECTIONS;
  const visibleApps = searching ? apps.filter((a) => matchHints.has(`apps:${a.slug}`)) : apps;

  // Auto-expand both groups while searching so a match is never hidden behind
  // a collapsed header — and never write this into `expanded` itself, or
  // clearing the query would leave whatever collapse state search forced
  // instead of restoring what the user had before (A12). toggleGroup keeps
  // writing `expanded` directly, untouched by search.
  const effectiveExpanded = searching ? { general: true, apps: true } : expanded;

  const noResults = searching && visibleSections.length === 0 && visibleApps.length === 0;

  const nav = (
    <div
      className={
        isNarrow
          ? 'w-full h-full flex flex-col bg-[var(--color-bg-primary)]'
          : 'w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg-header)] flex flex-col'
      }
    >
      <div className="shrink-0 p-2 border-b border-[var(--color-border)]">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search settings…"
          aria-label="Search settings"
          className="w-full bg-[var(--color-bg-secondary)] text-xs text-[var(--color-text-primary)] border border-[var(--color-border)] rounded px-2 py-1.5 outline-none focus:border-[var(--color-accent)]"
        />
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {/* General group — hidden entirely (not just collapsed) when a search
            is active and nothing in it matches (A10). */}
        {(!searching || visibleSections.length > 0) && (
          <div className="mb-1">
            <button
              onClick={() => toggleGroup('general')}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              <ChevronDown open={effectiveExpanded.general} />
              General
            </button>
            {effectiveExpanded.general && (
              <div>
                {visibleSections.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => select('general', s.key)}
                    className={`w-full flex items-center gap-2 pl-7 pr-3 ${rowPad} ${rowText} text-left transition-colors ${
                      !isNarrow && selection.group === 'general' && selection.key === s.key
                        ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5 active:bg-white/10'
                    }`}
                  >
                    <span className="flex-1 truncate">{s.label}</span>
                    {!s.ready && <span className="text-[9px] text-[var(--color-text-muted)] shrink-0">soon</span>}
                    {searching && matchHints.get(`general:${s.key}`) && (
                      <span data-testid="settings-search-hint" className="text-[9px] italic text-[var(--color-text-muted)] shrink-0">
                        {matchHints.get(`general:${s.key}`)}
                      </span>
                    )}
                    {isNarrow && <span className="text-[var(--color-text-muted)] shrink-0 rotate-180"><BackChevron /></span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Apps group — same hide-entirely-on-zero-match rule as General. */}
        {(!searching || visibleApps.length > 0) && (
          <div>
            <button
              onClick={() => toggleGroup('apps')}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              <ChevronDown open={effectiveExpanded.apps} />
              Apps
              {visibleApps.length > 0 && <span className="ml-auto text-[10px] normal-case font-normal">{visibleApps.length}</span>}
            </button>
            {effectiveExpanded.apps && (
              <div>
                {appsError && (
                  <div className="mx-3 my-1 px-2 py-1 text-[11px] rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)]">
                    {appsError}
                  </div>
                )}
                {visibleApps.length === 0 && !appsError && (
                  <div className="pl-7 pr-3 py-2 text-[12px] text-[var(--color-text-muted)] italic">
                    No apps with settings.
                  </div>
                )}
                {visibleApps.map((a) => (
                  <button
                    key={a.slug}
                    onClick={() => select('apps', a.slug)}
                    className={`w-full flex items-center gap-2 pl-7 pr-3 ${rowPad} ${rowText} text-left transition-colors ${
                      !isNarrow && selection.group === 'apps' && selection.key === a.slug
                        ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-white/5 active:bg-white/10'
                    }`}
                  >
                    <AppIcon icon={a.icon} label={a.name} size={isNarrow ? 16 : 13} />
                    <span className="flex-1 truncate">{a.name}</span>
                    {searching && matchHints.get(`apps:${a.slug}`) && (
                      <span data-testid="settings-search-hint" className="text-[9px] italic text-[var(--color-text-muted)] shrink-0">
                        {matchHints.get(`apps:${a.slug}`)}
                      </span>
                    )}
                    {isNarrow && <span className="text-[var(--color-text-muted)] shrink-0 rotate-180"><BackChevron /></span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {noResults && (
          <div className="px-3 py-6 text-center text-[12px] text-[var(--color-text-muted)]">
            No settings match "{query.trim()}".
          </div>
        )}
      </div>
    </div>
  );

  const content = (
    <div className="flex-1 min-w-0 overflow-y-auto p-4">
        {/* Keyed by selection so switching sections remounts a fresh boundary —
            a crashed section stays contained to itself and the sidebar (outside
            this boundary) still lets the user reach every other section. */}
        <ErrorBoundary
          key={`${selection.group}:${selection.key}`}
          label={selectedSection?.label || selectedApp?.name || 'Settings section'}
          fallback={
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <p className="text-sm text-[var(--color-danger)]">
                {selectedSection?.label || selectedApp?.name || 'This section'} crashed and
                couldn't be displayed. The rest of Settings still works — pick another section
                {isNarrow ? ' from the list behind Back.' : ' on the left.'}
              </p>
            </div>
          }
        >
          {selection.group === 'general' && selectedSection && (
            selectedSection.ready
              ? (
                (selectedSection.key === 'users' && <UsersTab />) ||
                (selectedSection.key === 'integrations' && <IntegrationsTab />) ||
                (selectedSection.key === 'marketplace' && <MarketplaceTab />) ||
                (selectedSection.key === 'networking' && <NetworkingTab />) ||
                (selectedSection.key === 'remote-hosts' && (
                  <RemoteHostsTab onNavigateToNetworking={() => select('general', 'networking')} />
                )) ||
                (selectedSection.key === 'observability' && <ObservabilityTab />) ||
                (selectedSection.key === 'skills' && <SkillsTab />)
              )
              : <ComingSoon label={selectedSection.label} />
          )}
          {selection.group === 'apps' && selectedApp && (
            // max-w-lg (512px) used to cap this no matter how wide the window
            // got, so resizing did nothing and every app panel scrolled inside a
            // narrow column. `max-w-4xl` still keeps form text at a readable
            // measure; `h-full min-h-0` is what lets a declarative panel's
            // iframe grow with the window instead of sitting at its 320px floor
            // while the pane scrolls around it (see .appcfg-appwindow in
            // index.css). `min-h-full` not `h-full`: a panel plus a long schema
            // form can exceed the pane, and capping it there squeezed the panel
            // to a few px instead of letting the pane scroll.
            <div className="flex flex-col min-h-full max-w-4xl">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">{selectedApp.name}</h3>
              <p className="text-[11px] text-[var(--color-text-muted)] mb-3">{selectedApp.slug} · v{selectedApp.version}</p>
              <AppConfigBody app={selectedApp} />
            </div>
          )}
          {selection.group === 'apps' && !selectedApp && apps.length > 0 && (
            <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
              {isNarrow ? 'Pick an app from the list.' : 'Select an app on the left.'}
            </div>
          )}
        </ErrorBoundary>
    </div>
  );

  // Wide: nav and content side by side — the original layout, untouched.
  if (!isNarrow) {
    return (
      <div className="h-full flex bg-[var(--color-bg-primary)] overflow-hidden">
        {nav}
        {content}
      </div>
    );
  }

  // Narrow: one column. The list IS the screen until a section is picked, then
  // the section is, with a back row to return. No fixed-width sidebar competing
  // for a 390px viewport, so nothing needs horizontal panning.
  const currentLabel = selectedSection?.label || selectedApp?.name || 'Settings';

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-primary)] overflow-hidden">
      {!detailOpen ? nav : (
        <>
          <button
            type="button"
            onClick={() => setDetailOpen(false)}
            // Explicit label: the visible crumb is three separate spans, and
            // the computed name for those differs between jsdom ("Settings/X")
            // and a real browser ("Settings / X") — which made the same test
            // pass in Playwright and fail in vitest. Naming it outright also
            // reads better than a path when it's announced aloud.
            aria-label={`Back to Settings — ${currentLabel}`}
            className="shrink-0 flex items-center gap-1.5 px-3 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-header)] text-[var(--color-text-primary)] text-[14px] font-medium active:bg-white/10"
          >
            <BackChevron />
            <span className="text-[var(--color-text-muted)]">Settings</span>
            <span className="text-[var(--color-text-muted)]">/</span>
            <span className="truncate">{currentLabel}</span>
          </button>
          {content}
        </>
      )}
    </div>
  );
}

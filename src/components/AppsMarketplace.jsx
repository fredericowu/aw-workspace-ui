// AppsMarketplace — the Marketplace panel opened from the Apps view. Loads the
// catalog (GET /api/apps/-/catalog → the curated tekflox/aw-marketplace
// apps.json) and lists AVAILABLE apps, each with an Install button that runs the
// framework install flow (POST /api/apps/install with the catalog app's
// repo/ref). On success the parent refreshes the installed list and, for a
// has_config app, opens its config window.
import { useEffect, useRef, useState } from 'react';
import AppIcon from './AppIcon';
import { wsUrl } from '../auth';
import { fetchCatalog, installApp, uninstallApp, getInstallStatus } from '../apps/appsApi';

const POLL_INTERVAL_MS = 2000;

const RESOURCE_LABEL = { low: 'Low', medium: 'Med', high: 'High' };

// CPU is the ONLY traffic-light dimension (green=low, amber=medium, red=high).
// Memory and disk are free-form *server-usage* estimates — a size string like
// "~200 MB", or "–" for something that never stays resident (e.g. the git CLI
// just installs; nothing runs in memory). Memory = server RAM (matters for
// heavy apps like aw-browser).
function ResourceBadges({ estimate }) {
  if (!estimate) return null;
  const cpu = estimate.cpu || 'low';
  const fmt = (v) => { const s = (v ?? '-').toString().trim(); return !s || s === '-' ? '–' : s; };
  return (
    <span className="appmkt-resources" aria-label="Resource estimate">
      <span className={`appmkt-res appmkt-res-${cpu}`} title={`CPU: ${RESOURCE_LABEL[cpu] || 'Low'}`}>
        <span className="appmkt-res-dot" aria-hidden="true" />
        CPU
      </span>
      <span className="appmkt-res appmkt-res-estimate" title={`Memory (server RAM): ${fmt(estimate.memory)}`}>
        <span className="appmkt-res-k">Mem</span> {fmt(estimate.memory)}
      </span>
      <span className="appmkt-res appmkt-res-estimate" title={`Disk: ${fmt(estimate.disk)}`}>
        <span className="appmkt-res-k">Disk</span> {fmt(estimate.disk)}
      </span>
    </span>
  );
}

// Renders nothing when the section is empty — an app with no MCP tools simply
// omits that section rather than announcing "None".
function WhatYouGetList({ title, items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="appmkt-wyg-group">
      <h4 className="appmkt-wyg-title">{title}</h4>
      <ul className="appmkt-wyg-list">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

// Poll GET /api/apps/{slug}/install-status until the background install
// (kicked off by installApp) lands on installed or failed. `alive` is a ref
// so a closed panel / unmounted component stops polling instead of leaking.
function pollInstallStatus(appId, alive) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (!alive.current) return;
      try {
        const status = await getInstallStatus(appId);
        if (!alive.current) return;
        if (status.status === 'installed') { resolve(status); return; }
        if (status.status === 'failed') { reject(new Error(status.error || 'install failed')); return; }
        setTimeout(tick, POLL_INTERVAL_MS);
      } catch (e) {
        reject(e);
      }
    };
    tick();
  });
}

export default function AppsMarketplace({ installedApps, onInstalled, onClose }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // slug -> true while installing
  const [query, setQuery] = useState('');
  const [selectedApp, setSelectedApp] = useState(null);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    let mounted = true;
    fetchCatalog()
      .then((data) => { if (mounted) setCatalog(data); })
      .catch((e) => { if (mounted) setError(String(e.message || e)); });
    return () => { mounted = false; };
  }, []);

  const installedVersions = new Map((installedApps || []).map((a) => [a.slug, a.version]));
  const installed = new Set(installedVersions.keys());

  // Live install-status push (workspace WS, see aw-workspace's
  // /ws/apps/install-status) — this is what makes "Installing…" survive a
  // page refresh: on connect the server replays every tracked job's current
  // state, so a reload mid-install (kicked off before this panel even
  // mounted, e.g. from another tab) shows the right button immediately
  // instead of a bare "Install" as if nothing had happened, and every
  // subsequent transition arrives instantly instead of waiting on a poll
  // tick. `notified` dedupes onInstalled — a job can be reported once by the
  // WS and once by doInstall()'s own poll fallback if both are racing.
  const notified = useRef(new Set());
  useEffect(() => {
    if (!catalog) return;
    let closed = false;
    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(wsUrl('/ws/apps/install-status'));
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type !== 'app_install_status' || !msg.job) return;
        const { app_id, status, error: jobError } = msg.job;
        const app = (catalog.apps || []).find((a) => a.id === app_id);
        if (!app) return;
        if (status === 'installing') {
          setBusy((b) => ({ ...b, [app_id]: true }));
          return;
        }
        setBusy((b) => ({ ...b, [app_id]: false }));
        if (status === 'installed' && !notified.current.has(app_id)) {
          notified.current.add(app_id);
          onInstalled?.(app);
        } else if (status === 'failed') {
          setError(`Install of ${app.name} failed: ${jobError || 'unknown error'}`);
        }
      };
      ws.onclose = () => { if (!closed) setTimeout(connect, 5000); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };
    connect();
    return () => { closed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  // Polling fallback (WS down / never connected) — same resume-after-reload
  // check as before, kept so a dropped WS doesn't leave the button stuck.
  useEffect(() => {
    if (!catalog) return;
    const pending = (catalog.apps || []).filter((app) => !installed.has(app.id));
    pending.forEach((app) => {
      getInstallStatus(app.id)
        .then((status) => {
          if (!alive.current || status.status !== 'installing' || busy[app.id]) return;
          setBusy((b) => ({ ...b, [app.id]: true }));
          pollInstallStatus(app.id, alive)
            .then(() => { if (alive.current && !notified.current.has(app.id)) { notified.current.add(app.id); onInstalled?.(app); } })
            .catch((e) => { if (alive.current) setError(`Install of ${app.name} failed: ${String(e.message || e)}`); })
            .finally(() => { if (alive.current) setBusy((b) => ({ ...b, [app.id]: false })); });
        })
        .catch(() => { /* no job / never installed — nothing to resume */ });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const doInstall = async (app) => {
    if (busy[app.id]) return;
    notified.current.delete(app.id);
    setBusy((b) => ({ ...b, [app.id]: true }));
    setError(null);
    try {
      await installApp({ repo: app.repo, ref: app.ref, app_id: app.id, signed: true });
      await pollInstallStatus(app.id, alive);
      if (alive.current && !notified.current.has(app.id)) {
        notified.current.add(app.id);
        onInstalled?.(app);
      }
    } catch (e) {
      if (alive.current) setError(`Install of ${app.name} failed: ${String(e.message || e)}`);
    } finally {
      if (alive.current) setBusy((b) => ({ ...b, [app.id]: false }));
    }
  };

  // Update = hot-uninstall (drain + journal reverse-replay) then reinstall at
  // the catalog's current ref — there's no in-place "upgrade" endpoint, but
  // this pair is already the framework's own supported flow (same one used
  // to deploy a fixed app version manually). Same busy/poll/notify plumbing
  // as a fresh install so the button states and WS/refresh-resume behavior
  // are identical either way.
  const doUpdate = async (app) => {
    if (busy[app.id]) return;
    notified.current.delete(app.id);
    setBusy((b) => ({ ...b, [app.id]: true }));
    setError(null);
    try {
      await uninstallApp(app.id);
      await installApp({ repo: app.repo, ref: app.ref, app_id: app.id, signed: true });
      await pollInstallStatus(app.id, alive);
      if (alive.current && !notified.current.has(app.id)) {
        notified.current.add(app.id);
        onInstalled?.(app);
      }
    } catch (e) {
      if (alive.current) setError(`Update of ${app.name} failed: ${String(e.message || e)}`);
    } finally {
      if (alive.current) setBusy((b) => ({ ...b, [app.id]: false }));
    }
  };

  const allApps = catalog?.apps || [];
  const q = query.trim().toLowerCase();
  const apps = q
    ? allApps.filter((app) => {
        const haystack = [app.name, app.description, ...(app.tags || [])].join(' ').toLowerCase();
        return haystack.includes(q);
      })
    : allApps;

  const detailApp = selectedApp ? allApps.find((a) => a.id === selectedApp) : null;

  const installButton = (app) => {
    const isInstalled = installed.has(app.id);
    if (isInstalled) {
      const installedVersion = installedVersions.get(app.id);
      const outdated = app.version && installedVersion && app.version !== installedVersion;
      if (!outdated) {
        return <span className="appmkt-installed" aria-label={`${app.name} installed`}>Installed</span>;
      }
      return (
        <button
          type="button"
          className="appmkt-install appmkt-update"
          onClick={(e) => { e.stopPropagation(); doUpdate(app); }}
          disabled={!!busy[app.id]}
          title={`Installed v${installedVersion} · latest v${app.version}`}
        >
          {busy[app.id] ? 'Updating…' : `Update to v${app.version}`}
        </button>
      );
    }
    return (
      <button
        type="button"
        className="appmkt-install"
        onClick={(e) => { e.stopPropagation(); doInstall(app); }}
        disabled={!!busy[app.id]}
      >
        {busy[app.id] ? 'Installing…' : 'Install'}
      </button>
    );
  };

  return (
    <div className="appmkt-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Marketplace">
      <div className="appmkt-panel" onClick={(e) => e.stopPropagation()}>
        {detailApp ? (
          <>
            <header className="appmkt-head">
              <div>
                <button type="button" className="appmkt-back" onClick={() => setSelectedApp(null)}>← Back</button>
                <h3 className="appmkt-title">{detailApp.name}</h3>
              </div>
              <button type="button" className="appmkt-close" onClick={onClose} aria-label="Close">✕</button>
            </header>

            {error && <p className="appmkt-error" data-testid="appmkt-error">{error}</p>}

            <div className="appmkt-detail">
              <div className="appmkt-detail-top">
                <span className="appmkt-icon appmkt-icon-lg">
                  <AppIcon icon={detailApp.icon} label={detailApp.name} size={36} />
                </span>
                <div className="appmkt-detail-meta">
                  <p className="appmkt-detail-publisher">by {detailApp.publisher || 'TekFlox'}</p>
                  <ResourceBadges estimate={detailApp.resource_estimate} />
                </div>
              </div>
              <p className="appmkt-item-desc">{detailApp.description}</p>

              {(detailApp.what_you_get?.mcp_tools?.length
                || detailApp.what_you_get?.ui_screens?.length
                || detailApp.what_you_get?.commands?.length) ? (
                <div className="appmkt-wyg">
                  <h4 className="appmkt-wyg-heading">What you get</h4>
                  <WhatYouGetList title="MCP Tools" items={detailApp.what_you_get?.mcp_tools} />
                  <WhatYouGetList title="UI Screens" items={detailApp.what_you_get?.ui_screens} />
                  <WhatYouGetList title="Runnable commands" items={detailApp.what_you_get?.commands} />
                </div>
              ) : null}

              <div className="appmkt-detail-actions">{installButton(detailApp)}</div>
            </div>
          </>
        ) : (
          <>
            <header className="appmkt-head">
              <div>
                <h3 className="appmkt-title">Marketplace</h3>
                <p className="appmkt-sub">
                  {catalog ? `${allApps.length} apps available` : 'Loading catalog…'}
                  {catalog?.stale ? ' · showing cached' : ''}
                </p>
              </div>
              <button type="button" className="appmkt-close" onClick={onClose} aria-label="Close">✕</button>
            </header>

            {catalog && allApps.length > 0 && (
              <input
                type="search"
                className="appmkt-search"
                placeholder="Search apps by name, description, or tag…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search apps"
              />
            )}

            {error && <p className="appmkt-error" data-testid="appmkt-error">{error}</p>}

            {catalog && allApps.length === 0 ? (
              <p className="appmkt-empty">No apps in the catalog.</p>
            ) : catalog && apps.length === 0 ? (
              <p className="appmkt-empty">nenhum app encontrado</p>
            ) : (
              <ul className="appmkt-list">
                {apps.map((app) => (
                  <li
                    className="appmkt-item"
                    key={app.id}
                    onClick={() => setSelectedApp(app.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelectedApp(app.id); }}
                  >
                    <span className="appmkt-icon"><AppIcon icon={app.icon} label={app.name} size={22} /></span>
                    <div className="appmkt-item-text">
                      <span className="appmkt-item-name">
                        {app.name}
                        {app.has_config && <span className="appmkt-badge">config</span>}
                      </span>
                      <span className="appmkt-item-publisher">by {app.publisher || 'TekFlox'}</span>
                      <span className="appmkt-item-desc">{app.description}</span>
                      <ResourceBadges estimate={app.resource_estimate} />
                    </div>
                    {installButton(app)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

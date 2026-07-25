import { useCallback, useEffect } from 'react';
import AppIcon from './AppIcon';

/**
 * Full-screen "Mission Control" App Launcher — replaces the old Apps
 * hover-popover with a live-tile grid (ported from the UX-Proto
 * `aw-redesign` prototype's AppLauncher.js, Direção B: Signal Amber pass).
 * Each app is a large tile shaped like a real screen (16:10); running apps
 * get an animated sheen + LIVE badge, stopped apps read dimmed. Data wiring
 * is unchanged — same `workspaceApps`/`components` props AppsNav.jsx always
 * consumed, filtered to menu==='apps' and sorted by `order`, exactly what
 * production has always done.
 *
 * `color` is a per-app tile wash computed locally (production doesn't ship
 * one) — purely decorative, like iOS app icons. Every chrome element
 * (title accent, hover glow, sheen, LIVE badge) stays on the shared amber
 * tokens so the launcher reads as one app, not six differently-branded
 * tiles.
 */

const APP_TILE_PALETTE = ['#6366f1', '#059669', '#ca8a04', '#db2777', '#0284c7', '#7c3aed', '#dc2626', '#0d9488', '#9333ea', '#ea580c'];
function colorForApp(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return APP_TILE_PALETTE[hash % APP_TILE_PALETTE.length];
}

function AppCard({ app, index, onOpen }) {
  const running = app.hasStatus && app.running;
  return (
    <button
      type="button"
      className={`applt-card ${app.hasStatus ? (running ? 'is-running' : 'is-stopped') : ''}`}
      style={{ '--tile': app.color, animationDelay: `${60 + index * 45}ms` }}
      onClick={() => onOpen(app)}
      aria-label={`Open ${app.label}${app.hasStatus && !running ? ' (stopped)' : ''}`}
    >
      <div className="applt-preview">
        <div className="applt-chrome">
          <span className="applt-dot" />
          <span className="applt-dot" />
          <span className="applt-dot" />
        </div>
        <div className="applt-wash" />
        <div className="applt-glyph">
          <AppIcon icon={app.icon} label={app.label} size={40} />
        </div>
        {running && <div className="applt-sheen" />}
        {running ? (
          <span className="applt-live">
            <span className="applt-live-pulse" />
            LIVE
          </span>
        ) : app.hasStatus ? (
          <span className="applt-paused">Stopped</span>
        ) : null}
      </div>
      <div className="applt-meta">
        <span className="applt-icon" style={{ background: app.color }}>
          <AppIcon icon={app.icon} label={app.label} size={16} />
        </span>
        <div className="applt-meta-text">
          <span className="applt-name">{app.label}</span>
          <span className="applt-state">
            {app.hasStatus ? (running ? 'Running now' : 'Tap to launch') : 'Tap to open'}
          </span>
        </div>
      </div>
    </button>
  );
}

// Always-present trailing tile — starts a new App Builder claude session
// (same POST /api/app-builder/start flow AppsNav.jsx's "Start building"
// row always triggered), styled like an app card so it reads as "add new"
// inside the same grid instead of a separate control.
function StartBuildingCard({ index, starting, onStart }) {
  return (
    <button
      type="button"
      className={`applt-card applt-card-start ${starting ? 'is-stopped' : ''}`}
      style={{ animationDelay: `${60 + index * 45}ms` }}
      onClick={onStart}
      disabled={starting}
      aria-label="Start building a new app"
    >
      <div className="applt-preview">
        <div className="applt-chrome">
          <span className="applt-dot" />
          <span className="applt-dot" />
          <span className="applt-dot" />
        </div>
        <div className="applt-wash" style={{ '--tile': 'var(--color-launcher-amber)' }} />
        <div className="applt-glyph applt-glyph-plus">+</div>
      </div>
      <div className="applt-meta">
        <span className="applt-icon" style={{ background: 'var(--color-launcher-amber)' }}>
          <span className="applt-icon-fallback">+</span>
        </span>
        <div className="applt-meta-text">
          <span className="applt-name">Start building</span>
          <span className="applt-state">{starting ? 'Starting…' : 'New App Builder session'}</span>
        </div>
      </div>
    </button>
  );
}

export default function AppLauncher({ workspaceApps, components, starting, onOpenApp, onStartBuilding, onClose }) {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const apps = (workspaceApps || [])
    .filter((a) => a.menu === 'apps')
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
    .map((a) => {
      const status = a.component ? components.find((c) => c.key === a.component)?.status : undefined;
      return {
        id: a.id,
        label: a.label,
        icon: a.icon,
        hasStatus: !!a.component,
        running: status === 'running' || status === 'boot',
        color: colorForApp(a.id),
      };
    });

  const runningCount = apps.filter((a) => a.hasStatus && a.running).length;

  return (
    <div className="applt-overlay" onClick={onClose}>
      <div className="applt-stage" onClick={(e) => e.stopPropagation()}>
        <header className="applt-head">
          <div className="applt-head-text">
            <h2 className="applt-title">
              Apps
              <span className="applt-title-accent" />
            </h2>
            <p className="applt-sub">
              {apps.length ? `${runningCount} running · ${apps.length} available` : 'Loading apps…'}
            </p>
          </div>
          <button type="button" className="applt-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {apps.length === 0 ? (
          <p className="applt-empty">No apps registered yet.</p>
        ) : (
          <div className="applt-grid">
            {apps.map((app, i) => (
              <AppCard key={app.id} app={app} index={i} onOpen={() => onOpenApp(app.id)} />
            ))}
            <StartBuildingCard index={apps.length} starting={!!starting} onStart={onStartBuilding} />
          </div>
        )}
      </div>
    </div>
  );
}

// AppLauncher — full-screen "Mission Control"-style launcher: each app is a
// large live tile whose preview area is shaped like a real screen (16:10),
// ready to receive a real screenshot of the running app later. Until that
// backend data exists, running apps show an animated placeholder (color
// glow + live sheen) and stopped apps show a dimmed frosted preview — same
// card structure either way, so wiring `app.screenshot` in later is a
// drop-in.
//
// 1:1 port of the prototype's src/components/AppLauncher.js (React via
// esm.sh, no build step there) into real JSX with a real `import React from
// 'react'`. Same icon set / props contract.
//
// props:
//   apps: [{ id, label, icon, color, hasStatus, running, screenshot? }]
//     - `icon`: same named/URL/fallback system production uses (see
//       AppsNav.jsx's AppIcon) — a known name from ICON_PATHS renders an
//       inline SVG, a string starting with http/`/`/data: renders as <img>,
//       anything else (or empty) falls back to the label's first letter.
//     - `hasStatus`: true only when the app has a `component` to track (i.e.
//       production set one) — apps without one show no running/stopped
//       badge at all, matching real AppsNav behavior (no fabricated status).
//     - screenshot: future real preview URL
//   onOpenApp(app): called when a card is clicked
//   onClose(): called on backdrop click, close button, or Escape

import { useCallback, useEffect } from "react";

// Same 12 named icons production ships today; anything else falls back to a
// letter badge, same as production.
const ICON_PATHS = {
  bolt: [["path", { d: "M13 2L4 14h7l-1 8 9-12h-7l1-8z" }]],
  globe: [
    ["circle", { cx: 12, cy: 12, r: 10 }],
    ["path", { d: "M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" }],
  ],
  code: [
    ["polyline", { points: "16 18 22 12 16 6" }],
    ["polyline", { points: "8 6 2 12 8 18" }],
  ],
  terminal: [
    ["polyline", { points: "4 17 10 11 4 5" }],
    ["line", { x1: 12, y1: 19, x2: 20, y2: 19 }],
  ],
  database: [
    ["ellipse", { cx: 12, cy: 5, rx: 9, ry: 3 }],
    ["path", { d: "M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" }],
    ["path", { d: "M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" }],
  ],
  git: [
    ["circle", { cx: 18, cy: 18, r: 3 }],
    ["circle", { cx: 6, cy: 6, r: 3 }],
    ["path", { d: "M6 21V9a9 9 0 0 0 9 9" }],
  ],
  cloud: [["path", { d: "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" }]],
  shield: [["path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" }]],
  mail: [
    ["path", { d: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" }],
    ["polyline", { points: "22,6 12,13 2,6" }],
  ],
  star: [["polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" }]],
  box: [["path", { d: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" }]],
  monitor: [
    ["rect", { x: 2, y: 3, width: 20, height: 14, rx: 2, ry: 2 }],
    ["line", { x1: 8, y1: 21, x2: 16, y2: 21 }],
  ],
};

function renderNamedIcon(name, size) {
  const Tags = ICON_PATHS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {Tags.map(([Tag, props], i) => (
        <Tag key={i} {...props} />
      ))}
    </svg>
  );
}

// Same resolution order as AppsNav.jsx's AppIcon: URL/path/data-uri -> <img>,
// known name -> inline SVG, anything else -> first-letter badge.
function AppIcon({ icon, label, size = 22 }) {
  if (icon && (icon.startsWith("http") || icon.startsWith("/") || icon.startsWith("data:"))) {
    return <img src={icon} alt="" style={{ width: size, height: size, objectFit: "contain" }} />;
  }
  if (icon && ICON_PATHS[icon]) return renderNamedIcon(icon, size);
  return (
    <span className="applt-icon-fallback" style={{ fontSize: Math.round(size * 0.55) }}>
      {(label || icon || "?")[0].toUpperCase()}
    </span>
  );
}

// One app = one live tile. The `.applt-preview` block is the screen slot:
// today it holds a placeholder, later it holds an <img src={app.screenshot}>
// at the exact same aspect ratio, so nothing about the layout shifts.
function AppCard({ app, index, onOpen }) {
  const hasStatus = !!app.hasStatus;
  const running = hasStatus && !!app.running;
  return (
    <button
      type="button"
      className={`applt-card ${hasStatus ? (running ? "is-running" : "is-stopped") : ""}`}
      style={{ "--tile": app.color, animationDelay: `${60 + index * 45}ms` }}
      onClick={() => onOpen(app)}
      aria-label={`Open ${app.label}${hasStatus && !running ? " (stopped)" : ""}`}
    >
      {/* ---- Screen preview slot (16:10) — real screenshot lands here later ---- */}
      <div className="applt-preview">
        {/* Fake window chrome so the empty slot still reads as "an app screen". */}
        <div className="applt-chrome">
          <span className="applt-dot" />
          <span className="applt-dot" />
          <span className="applt-dot" />
        </div>
        {/* Colour wash derived from the app's brand colour. */}
        <div className="applt-wash" />
        {/* Big watermark glyph — the "living thumbnail" stand-in. */}
        <div className="applt-glyph">
          <AppIcon icon={app.icon} label={app.label} size={40} />
        </div>
        {/* Real screenshot support is already here: pass app.screenshot to light it up. */}
        {app.screenshot ? <img className="applt-shot" src={app.screenshot} alt="" /> : null}
        {/* Animated sheen sweeps only for running apps → reads as "live". */}
        {running ? <div className="applt-sheen" /> : null}
        {/* Running / stopped indicator — only shown when the app actually has a
            tracked component (`hasStatus`); apps without one show nothing here,
            matching real AppsNav (no fabricated status dot). */}
        {running ? (
          <span className="applt-live">
            <span className="applt-live-pulse" />
            LIVE
          </span>
        ) : hasStatus ? (
          <span className="applt-paused">Stopped</span>
        ) : null}
      </div>
      {/* ---- Footer: name + state ---- */}
      <div className="applt-meta">
        <span className="applt-icon" style={{ background: app.color }}>
          <AppIcon icon={app.icon} label={app.label} size={16} />
        </span>
        <div className="applt-meta-text">
          <span className="applt-name">{app.label}</span>
          <span className="applt-state">{hasStatus ? (running ? "Running now" : "Tap to launch") : "Tap to open"}</span>
        </div>
      </div>
    </button>
  );
}

export default function AppLauncher({ apps, onOpenApp, onClose }) {
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

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
            <p className="applt-sub">{apps.length ? `${runningCount} running · ${apps.length} available` : "Loading apps…"}</p>
          </div>
          <button type="button" className="applt-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {apps.length ? (
          <div className="applt-grid">
            {apps.map((app, i) => (
              <AppCard key={app.id || app.label} app={app} index={i} onOpen={onOpenApp} />
            ))}
          </div>
        ) : (
          <p className="applt-empty">No apps registered yet.</p>
        )}
      </div>
    </div>
  );
}

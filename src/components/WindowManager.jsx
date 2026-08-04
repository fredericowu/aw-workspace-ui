import { useState, useRef, useCallback, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import LogWindow from './LogWindow';
import LogStream from './LogStream';
import TerminalWindow from './TerminalWindow';
import PresentationWindow from './PresentationWindow';
import RemoteDesktopWindow from './RemoteDesktopWindow';
import DiffWindow from './DiffWindow';
import BasicWindow from './BasicWindow';
import StubbornWindow from './StubbornWindow';
import TasksTab from './TasksTab';
import PlansPanel from './PlansPanel';
import TestsPanel from './TestsPanel';
import SettingsPanel from './SettingsPanel';
import { startComponent, stopComponent, restartComponent } from '../hooks/useComponentStatus';
import { apiFetch } from '../auth';

// Same convention as App.jsx / MobileApp.jsx — relative URLs work
// because the AW SPA is served from the same origin as the API.
const API_BASE = '';

/**
 * Start / Restart / Stop trio for the iframe-backed docker windows
 * (Browser, VSCode, Desktop).  Visually mirrors `<ControlButtons>` from
 * LogWindow but uses the tighter `p-1` padding the window header
 * already uses for Pop-out / Maximize / Close so the row stays uniform.
 *
 * After Start and Restart we remount the iframe in place. Closing and
 * reopening the parent window is fragile for managed app windows because
 * their state is owned by App.jsx, while AppProxyWindow already has a
 * reliable cross-origin reload path via iframeReloadKey.
 */
function DockerControls({ componentKey, status, onReloadWindow }) {
  const [busy, setBusy] = useState(null);

  const isOff = status === 'off';
  const isRunning = status === 'running' || status === 'boot';

  const reloadSoon = (delay = 600) => {
    setTimeout(() => onReloadWindow?.(), delay);
  };

  const onStart = async () => {
    setBusy('start');
    try {
      await startComponent(componentKey).catch(() => {});
      reloadSoon(600);
    } finally {
      setTimeout(() => setBusy(null), 400);
    }
  };

  const onRestart = async () => {
    setBusy('restart');
    try {
      await restartComponent(componentKey).catch(() => {});
      reloadSoon(800);
    } finally {
      setTimeout(() => setBusy(null), 600);
    }
  };

  const onStop = async () => {
    setBusy('stop');
    try {
      await stopComponent(componentKey).catch(() => {});
    } finally {
      setTimeout(() => setBusy(null), 400);
    }
  };

  const Spinner = () => (
    <svg className="w-3.5 h-3.5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );

  return (
    <>
      <button
        onClick={onStart}
        disabled={isRunning || !!busy}
        className="p-1 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        title="Start container"
      >
        {busy === 'start' ? <Spinner /> : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-green-400">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <button
        onClick={onRestart}
        disabled={!!busy}
        className="p-1 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        title="Restart component"
      >
        {busy === 'restart' ? <Spinner /> : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400">
            <path d="M1 4v6h6" />
            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
          </svg>
        )}
      </button>
      <button
        onClick={onStop}
        disabled={isOff || !!busy}
        className="p-1 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        title="Stop container"
      >
        {busy === 'stop' ? <Spinner /> : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-red-400">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        )}
      </button>
    </>
  );
}

function DebuggerIframe({ bringToFront, isFocused }) {
  const DAP_URL = 'http://127.0.0.1:15050';
  const [ready, setReady] = useState(false);
  const [dots, setDots] = useState('');

  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${DAP_URL}/services`, { signal: AbortSignal.timeout(2000) });
          if (res.ok) { setReady(true); return; }
        } catch {}
        await new Promise(r => setTimeout(r, 2000));
        setDots(d => d.length >= 3 ? '' : d + '.');
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [ready]);

  return (
    <div className="flex-1 relative" onMouseDown={bringToFront}>
      {!isFocused && <div className="absolute inset-0 z-10" onMouseDown={bringToFront} />}
      {ready ? (
        <iframe
          src={`${DAP_URL}/debugger`}
          className="absolute inset-0 w-full h-full border-0"
          title="Debugger (DAP Server)"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-primary)]">
          <div className="text-center">
            <svg className="w-8 h-8 mx-auto mb-3 text-red-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
            <div className="text-sm text-[var(--color-text-secondary)]">Starting DAP Server{dots}</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">Waiting for :15050</div>
          </div>
        </div>
      )}
    </div>
  );
}


function HoppscotchIframe({ bringToFront, isFocused }) {
  // Probe a known-cheap path on the upstream (the SPA root), kick off
  // docker:aw-hoppscotch if not ready, then poll
  // until reachable. Keeps the iframe black until the SPA can actually load.
  const [ready, setReady] = useState(false);
  const [dots, setDots] = useState('');
  const startedRef = useRef(false);

  // Hoppscotch is now on its own subdomain. URL is derived from the
  // current dashboard host so the same code works on dev.tekflox.com,
  // a future staging host, or any other apex — as long as a wildcard
  // *.<host> DNS record exists.
  const APIS_HOST = `apis.${window.location.host.replace(/^www\./, '')}`;
  const APIS_URL = `${window.location.protocol}//${APIS_HOST}`;

  useEffect(() => {
    if (ready) return;
    let cancelled = false;

    // Probe via awserv's components API instead of fetching the apis
    // subdomain directly — that would be a cross-origin fetch from
    // dev.tekflox.com to apis.dev.tekflox.com without an ACAO header,
    // so the browser blocks it (no CORS) and the readiness check
    // never succeeds → iframe stays stuck on "Starting Hoppscotch".
    //
    // The components endpoint lives on the same origin (dev.) and
    // reports container status as "running" once docker reports
    // healthy. Same readiness signal, no CORS headache.
    const checkReady = async () => {
      try {
        const res = await fetch('/api/components', {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return false;
        const list = await res.json();
        const c = list.find(x => x.key === 'docker:aw-hoppscotch');
        return !!c && (c.status === 'running' || c.status === 'boot');
      } catch { return false; }
    };

    const startAndPoll = async () => {
      if (await checkReady()) {
        if (!cancelled) setReady(true);
        return;
      }
      if (!startedRef.current) {
        startedRef.current = true;
        await startComponent('docker:aw-hoppscotch').catch(() => {});
      }
      await new Promise(r => setTimeout(r, 4000));
      while (!cancelled) {
        if (await checkReady()) {
          setDots('');
          if (!cancelled) setReady(true);
          return;
        }
        await new Promise(r => setTimeout(r, 2000));
        setDots(d => d.length >= 3 ? '' : d + '.');
      }
    };
    startAndPoll();
    return () => { cancelled = true; };
  }, [ready]);

  // Iframe loads the apis subdomain root. Caddy has a transparent
  // auth gate (see Caddyfile): if no access_token cookie, 302 to
  // /_aw_auth which awserv handles (mints cookies + 302 back to /).
  // Once cookies are set, future loads skip the bridge entirely.
  // Whether the iframe is loaded fresh or after long idle, the gate
  // handles cookie-less and cookie-present cases the same way.
  const src = `${APIS_URL}/`;

  return (
    <div className="flex-1 relative" onMouseDown={bringToFront}>
      {!isFocused && <div className="absolute inset-0 z-10" onMouseDown={bringToFront} />}
      {ready ? (
        <iframe
          src={src}
          className="absolute inset-0 w-full h-full border-0"
          title="Hoppscotch (APIs)"
          allow="clipboard-read; clipboard-write; microphone; autoplay"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-primary)]">
          <div className="text-center">
            <svg className="w-8 h-8 mx-auto mb-3 text-emerald-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
            </svg>
            <div className="text-sm text-[var(--color-text-secondary)]">Starting Hoppscotch{dots}</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">Waiting for Docker container</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Generic workspace-app iframe. Works for any app defined in aw.json
// workspace_apps.
//
// Component startup is handled server-side: the app-proxy serves a splash
// page when the upstream is unreachable, auto-starts the component, polls
// until it responds, then redirects — no React-level polling needed here.
//
// URL resolution: localhost URLs are mapped to the app subdomain
// {appId}.app.{hostname} (e.g. hoppscotch.app.dev.tekflox.com).
// Each workspace app gets its own TLS origin — no path-prefix rewriting
// needed, SPA asset paths resolve naturally, and the Caddy cookie gate
// handles auth transparently.
function AppIframe({ appId, label, url, componentKey, bringToFront, isFocused, reloadKey = 0, onReload }) {
  // Resolve src: localhost/127.0.0.1 URLs → {protocol}://{appId}.app.{hostname}/
  // so each workspace app gets its own TLS origin. The app-proxy handles component
  // startup (shows splash page, polls, redirects) — no React-level polling needed.
  //
  // Path + query params from the configured url are preserved so apps like
  // noVNC can receive launch params (e.g. ?autoconnect=1&resize=scale) while
  // the Python proxy still routes sub-resource requests to the correct origin.
  let src = url || '/';
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      const apex = window.location.hostname.replace(/^www\./, '');
      const base = `${window.location.protocol}//${appId}.app.${apex}`;
      // Keep any path (besides bare '/') and query string from the config url
      const trail = (parsed.pathname !== '/' ? parsed.pathname : '') + (parsed.search || '');
      src = trail ? `${base}/${trail.replace(/^\//, '')}` : `${base}/`;
    }
  } catch (_) { /* non-URL string — use as-is */ }

  // Load-failure detection:
  //
  // - reloadKey is owned by AppProxyWindow and bumped when the user clicks
  //   the title-bar "Reload iframe" button. It's part of the iframe's
  //   React `key` so a bump fully remounts the element — cleanest reload,
  //   no cross-origin contentWindow access required (the browser blocks
  //   it anyway).
  // - status: 'loading' until iframe fires onLoad → 'loaded'. If onLoad
  //   hasn't fired within LOAD_TIMEOUT_MS we flip to 'timeout' and surface
  //   a centered refresh overlay. Note: onLoad fires *even when the proxy
  //   serves an HTTP 502/504* (the response is still a valid HTML doc), so
  //   the timeout is the only reliable cross-origin failure signal we have.
  const LOAD_TIMEOUT_MS = 15000;
  const [status, setStatus] = useState('loading'); // 'loading' | 'loaded' | 'timeout'

  // Reset to 'loading' whenever we remount the iframe (src or reloadKey
  // change). The matching setStatus('loaded') runs from onLoad below.
  useEffect(() => {
    setStatus('loading');
    const t = setTimeout(() => {
      setStatus((s) => (s === 'loading' ? 'timeout' : s));
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [src, reloadKey]);

  return (
    <div className="flex-1 relative" onMouseDown={bringToFront}>
      {!isFocused && <div className="absolute inset-0 z-10" onMouseDown={bringToFront} />}
      <iframe
        key={reloadKey}
        src={src}
        className="absolute inset-0 w-full h-full border-0"
        title={label}
        allow="clipboard-read; clipboard-write; microphone; autoplay"
        onLoad={() => setStatus('loaded')}
      />
      {/* Centered failure overlay — only shown if the iframe hasn't fired
          onLoad within the timeout window. Sits above the focus shim so
          the user can click Reload without first focusing the window.
          The reload button calls back into AppProxyWindow which owns
          reloadKey, so this matches the title-bar Reload icon's behaviour
          exactly. */}
      {status === 'timeout' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[var(--color-bg-secondary)]/85 backdrop-blur-sm text-center px-6">
          <div className="text-xs text-[var(--color-text-muted)]">
            <div className="text-sm text-[var(--color-text-primary)] font-medium mb-1">
              {label || appId} isn't responding
            </div>
            The iframe hasn't loaded yet. The app may be starting up, restarting,
            or unreachable. You can keep waiting or reload now.
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); bringToFront?.(); onReload?.(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium bg-[var(--color-accent)] hover:opacity-90 text-white cursor-pointer transition-opacity"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Reload iframe
          </button>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// DevModePopover — inline editor for an app's Dev Mode config
// (dev_mode + watch_paths + watch_ignore). Used by AppProxyWindow's
// title-bar ⚡ dropdown. Local-state-while-editing pattern: changes
// only commit on Save so the backend watcher doesn't churn through a
// reconfigure on every keystroke.
function DevModePopover({ devConfig, onClose, onSave }) {
  const [devMode, setDevMode] = useState(!!devConfig.dev_mode);
  const [pathsText, setPathsText] = useState(
    (devConfig.watch_paths || []).join('\n')
  );
  const [ignoreText, setIgnoreText] = useState(
    (devConfig.watch_ignore || []).join('\n')
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSave = () => {
    onSave({
      dev_mode: devMode,
      // Split on newlines/commas, drop blanks. Backend de-dupes
      // anyway so we don't bother here.
      watch_paths: pathsText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
      watch_ignore: ignoreText.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
    });
  };

  return (
    <>
      {/* Backdrop — click-outside to dismiss without saving. */}
      <div
        className="absolute inset-0 z-30 bg-black/30"
        onClick={onClose}
      />
      {/* Panel — anchored under the title bar, right side. */}
      <div
        className="absolute top-10 right-2 z-40 w-80 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl shadow-black/50 p-3 text-xs text-[var(--color-text-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold uppercase tracking-wider text-[10px] text-[var(--color-text-muted)]">
            Dev Mode
          </span>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            title="Close"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <label className="flex items-center gap-2 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={devMode}
            onChange={(e) => setDevMode(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          <span>Auto-reload iframe on file changes</span>
        </label>

        <div className="mb-2">
          <label className="block text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
            Watch paths (one per line)
          </label>
          <textarea
            value={pathsText}
            onChange={(e) => setPathsText(e.target.value)}
            rows={4}
            placeholder="src/custom_apps/myapp"
            className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 font-mono text-[11px] resize-y"
          />
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
            Repo-root-relative. Empty disables watching for this app.
          </p>
        </div>

        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] mb-2"
        >
          {showAdvanced ? '▼ Hide advanced' : '▶ Advanced (ignore patterns)'}
        </button>
        {showAdvanced && (
          <div className="mb-2">
            <textarea
              value={ignoreText}
              onChange={(e) => setIgnoreText(e.target.value)}
              rows={4}
              placeholder="node_modules&#10;*.pyc&#10;.git"
              className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 font-mono text-[11px] resize-y"
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              gitignore-style globs, matched against basename and any path segment.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-[var(--color-text-muted)] hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1 rounded bg-[var(--color-accent)] text-white hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}


// ---------------------------------------------------------------------------
// AppProxyWindow — generic floating window for any workspace_apps entry.
// Window key: `app:{id}` (e.g. `app:browser`, `app:hoppscotch`).
//
// Title bar shows the app's configured icon (named key → inline SVG,
// URL/path → <img>), label, optional DockerControls, maximize and close.
// Content is an AppIframe that routes through the app-proxy subdomain.
// ---------------------------------------------------------------------------

// Icon render functions (className) => JSX — in sync with WorkspaceNav.jsx
// WORKSPACE_APP_ICONS and AwConfigTab.jsx NAMED_ICONS_PICKER.
const _PROXY_WIN_ICONS = {
  bolt:     (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>,
  globe:    (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  code:     (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  terminal: (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  database: (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
  git:      (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg>,
  cloud:    (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>,
  shield:   (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  mail:     (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  star:     (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  box:      (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
  monitor:  (c) => <svg className={c} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
};

/** Renders the app icon in the title bar (accent-colored). */
function AppWindowIcon({ icon, label }) {
  const cls = 'w-3.5 h-3.5 shrink-0 text-[var(--color-accent)]';
  if (!icon) return _PROXY_WIN_ICONS.monitor(cls);
  if (icon.startsWith('http') || icon.startsWith('/') || icon.startsWith('data:')) {
    return <img src={icon} alt="" className="w-3.5 h-3.5 shrink-0 object-contain rounded-sm" style={{ opacity: 0.85 }} />;
  }
  const render = _PROXY_WIN_ICONS[icon];
  if (render) return render(cls);
  // Unknown name → first letter badge
  return (
    <span className="w-3.5 h-3.5 shrink-0 rounded-sm text-[8px] font-bold flex items-center justify-center bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
      {(label || icon || '?')[0].toUpperCase()}
    </span>
  );
}

/**
 * AppProxyWindow — floating window for a workspace_apps entry.
 *
 * Props:
 *   appId          — the id from the workspace_apps entry (key minus "app:" prefix)
 *   workspaceApps  — the full workspace_apps array (to look up config)
 *   windowKey      — the full window key ("app:{id}")
 *   componentMap   — live component status map from the parent WindowManager
 *   onCloseWindow  — close callback
 *   onReopenWindow — reopen/toggle callback
 *   onMaximize     — maximize/restore callback
 *   maximizedKey   — currently maximized window key (for button label)
 *   bringToFront   — focus callback
 *   isFocused      — whether this window is on top
 */
function AppProxyWindow({
  appId,
  workspaceApps,
  windowKey,
  componentMap,
  onCloseWindow,
  onReopenWindow,
  onMaximize,
  maximizedKey,
  bringToFront,
  isFocused,
}) {
  const app = (workspaceApps || []).find((a) => a.id === appId)
    || { id: appId, label: appId, url: 'http://localhost' };

  // View toggle — when the app is backed by a docker component the user
  // can flip the window body between the live iframe (the app's UI) and
  // a streaming view of the component's logs. Same WS feed and rendering
  // used by Workspace > Components > <component>'s LogWindow, just with
  // no extra chrome since this window already has its own header.
  // Defaults to 'iframe' so opening an app always shows the UI first.
  const [viewMode, setViewMode] = useState('iframe');

  // Iframe reload key — bumped by the title-bar Reload button (and by the
  // timeout overlay's inline Reload). Owned here rather than inside
  // AppIframe so the title bar can drive the reload while the iframe
  // component just reacts to the prop. A bump triggers a full React
  // remount of the <iframe>, which is the only reliable cross-origin
  // refresh path (contentWindow.location is blocked by the browser).
  const [iframeReloadKey, setIframeReloadKey] = useState(0);
  const reloadIframe = () => setIframeReloadKey((k) => k + 1);
  const canViewLogs = !!app.component;

  // ── Dev Mode ────────────────────────────────────────────────────────
  // Dev Mode = "auto-reload my iframe whenever the AppWatcher (backend)
  // sees a file change in watch_paths". Three pieces here:
  //   1. Listen for `aw-app-reload` events (pushed by useComponentStatus
  //      when the WS payload's type is "app_reload") and remount this
  //      window's iframe iff event.detail.app_id === our appId.
  //   2. Load current dev_mode + watch_paths from
  //      GET /api/apps/{slug}/dev-config so the title-bar toggle reflects
  //      reality on first render (and after every aw-config-changed —
  //      e.g. an MCP edit or another tab toggling it).
  //   3. Show a ⚡ button + popover for editing the watch_paths list
  //      without leaving the window. PATCH triggers reload_aw_config on
  //      the backend, which in turn reconfigures AppWatcher.
  const [devConfig, setDevConfig] = useState(null);   // {dev_mode, watch_paths, watch_ignore} or null while loading
  const [devOpen, setDevOpen] = useState(false);      // popover visible?

  useEffect(() => {
    // Auto-reload listener — single subscription per AppProxyWindow.
    const handler = (e) => {
      const detail = e.detail || {};
      if (detail.app_id === appId) {
        setIframeReloadKey((k) => k + 1);
      }
    };
    window.addEventListener('aw-app-reload', handler);
    return () => window.removeEventListener('aw-app-reload', handler);
  }, [appId]);

  // Load (and reload) dev-config. We refetch when aw-config-changed
  // fires so manual edits / MCP toggles propagate without a page reload.
  const fetchDevConfig = useCallback(() => {
    apiFetch(`${API_BASE}/api/apps/${encodeURIComponent(appId)}/dev-config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDevConfig(d); })
      .catch(() => {});
  }, [appId]);

  useEffect(() => {
    fetchDevConfig();
    const onConfigChanged = () => fetchDevConfig();
    window.addEventListener('aw-config-changed', onConfigChanged);
    return () => window.removeEventListener('aw-config-changed', onConfigChanged);
  }, [fetchDevConfig]);

  const patchDevConfig = (patch) => {
    return apiFetch(`${API_BASE}/api/apps/${encodeURIComponent(appId)}/dev-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { setDevConfig(d); return d; })
      .catch(() => {});
  };
  // If the app loses its component association (e.g. config edit while
  // open), bounce back to the iframe view so we don't render an empty
  // log stream.
  useEffect(() => {
    if (!canViewLogs && viewMode === 'logs') setViewMode('iframe');
  }, [canViewLogs, viewMode]);

  // Resolve the external URL the same way AppIframe does — localhost →
  // app subdomain so the pop-out window gets auth + the splash page.
  const externalUrl = (() => {
    try {
      const parsed = new URL(app.url);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        const apex = window.location.hostname.replace(/^www\./, '');
        const base = `${window.location.protocol}//${app.id}.app.${apex}`;
        const trail = (parsed.pathname !== '/' ? parsed.pathname : '') + (parsed.search || '');
        return trail ? `${base}/${trail.replace(/^\//, '')}` : `${base}/`;
      }
    } catch (_) { /* non-URL — fall through */ }
    return app.url;
  })();

  return (
    <div className="relative flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
      {/* Dev Mode popover. Positioned absolute over the iframe so it
          doesn't push layout around when toggled. Closes on click
          outside via the backdrop. Editing is local until "Save" — we
          don't PATCH on every keystroke because the watcher would
          churn through reconfigure cycles. */}
      {devOpen && devConfig && (
        <DevModePopover
          devConfig={devConfig}
          onClose={() => setDevOpen(false)}
          onSave={(patch) => patchDevConfig(patch).then(() => setDevOpen(false))}
        />
      )}
      {/* Title bar */}
      <div className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0">
        <div className="flex items-center gap-2">
          <AppWindowIcon icon={app.icon} label={app.label} />
          <span className="text-xs font-medium text-[var(--color-text-primary)]">{app.label}</span>
          {viewMode === 'logs' && (
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] ml-1">logs</span>
          )}
        </div>
        <div className="flex items-center gap-1 no-drag" onMouseDown={(e) => e.stopPropagation()}>
          {/* Start/Stop/Restart only make sense when the backing component
              is a STANDALONE process the framework can independently
              start/stop/restart (a docker/podman container, or a
              `tier: inprocess` app that declares `runtime.standalone`).
              `standalone_app` defaults to true when the component entry
              doesn't carry the field (older/legacy docker components) so
              this is backward-compatible — only apps that explicitly
              report `standalone_app: false` (e.g. aw-app-proxy, whose
              routes register directly inside the aw-workspace process)
              lose the trio. See src.apps.manifest.Manifest.standalone_app. */}
          {app.component && componentMap[app.component]?.standalone_app !== false && (
            <DockerControls
              componentKey={app.component}
              status={componentMap[app.component]?.status || 'off'}
              onReloadWindow={reloadIframe}
            />
          )}
          {/* Logs toggle — only for apps backed by a docker component.
              Active state mirrors the WindowNav tab styling so the user
              gets clear feedback that they're now in log mode. */}
          {canViewLogs && (
            <button
              onClick={() => setViewMode((m) => (m === 'logs' ? 'iframe' : 'logs'))}
              className={`p-1 rounded cursor-pointer transition-colors ${
                viewMode === 'logs'
                  ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:bg-white/10'
              }`}
              title={viewMode === 'logs' ? 'Show app UI' : 'Show component logs'}
            >
              {/* "Lines" icon for logs / "Globe" icon for UI — gives the
                  user a quick visual indication of what's on the other
                  side of the toggle. */}
              {viewMode === 'logs' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              )}
            </button>
          )}
          {/* Dev Mode toggle — ⚡ icon flips dev_mode on/off via PATCH.
              When ON the AppWatcher backend watches `watch_paths` and
              pushes app_reload events that remount this iframe on every
              save. The popover (chevron) lets the user edit the watched
              paths inline without leaving the window. We show the
              button as soon as devConfig is loaded so the user sees
              ON/OFF state on first paint. */}
          {devConfig && (
            <>
              <button
                onClick={() => patchDevConfig({ dev_mode: !devConfig.dev_mode })}
                className={`p-1 rounded cursor-pointer transition-colors ${
                  devConfig.dev_mode
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                    : 'text-[var(--color-text-muted)] hover:bg-white/10'
                }`}
                title={
                  devConfig.dev_mode
                    ? `Dev Mode ON — iframe auto-reloads when files change in: ${(devConfig.watch_paths || []).join(', ') || '(no paths)'}`
                    : 'Dev Mode OFF — click to enable iframe auto-reload on file changes'
                }
              >
                {/* Lightning bolt — same family as the default app icon
                    so it reads as "live/active" when highlighted. */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill={devConfig.dev_mode ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </button>
              <button
                onClick={() => setDevOpen((v) => !v)}
                className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer"
                title="Edit Dev Mode watch paths"
              >
                {/* Caret-down — discloses the watch_paths editor popover. */}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </>
          )}
          {/* Reload iframe — purely client-side, refreshes just the
              embedded SPA without touching the docker container. Distinct
              icon (double-arrow circular refresh) from DockerControls'
              single-arrow Restart so the user can tell the two apart at
              a glance, even though they live in the same button row. */}
          <button
            onClick={reloadIframe}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer"
            title="Reload iframe (refresh the embedded app — does not restart the container)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
          <button
            onClick={() => {
              window.open(externalUrl, `aw-app-${app.id}`, 'popup=1,width=1400,height=900');
              onCloseWindow(windowKey);
            }}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer"
            title="Pop out to new window"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
          <button
            onClick={() => onMaximize?.(windowKey)}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer"
            title={maximizedKey === windowKey ? 'Restore' : 'Maximize'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          </button>
          <button
            onClick={() => onCloseWindow(windowKey)}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      {/* Content — iframe OR component logs depending on viewMode.
          The iframe stays mounted across toggles (display:none) so we
          don't reload the SPA every time the user peeks at logs. */}
      <div className={viewMode === 'iframe' ? 'flex-1 flex' : 'hidden'}>
        <AppIframe
          appId={app.id}
          label={app.label}
          url={app.url}
          componentKey={app.component}
          bringToFront={bringToFront}
          isFocused={isFocused}
          reloadKey={iframeReloadKey}
          onReload={reloadIframe}
        />
      </div>
      {viewMode === 'logs' && canViewLogs && (
        <LogStream
          componentKey={app.component}
          component={componentMap[app.component]}
        />
      )}
    </div>
  );
}

function managedWindowAppEntry(windowSpec, workspaceApps, componentMap) {
  if (windowSpec?.body?.type !== 'managed_app') return null;
  const body = windowSpec.body || {};
  const appId = body.app_id || windowSpec.app || body.kind;
  if (!appId) return null;

  const existing = (workspaceApps || []).find((a) => a.id === appId);
  const path = body.path || '/';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const apex = window.location.hostname.replace(/^www\./, '');
  const url = body.url || `${window.location.protocol}//${appId}.app.${apex}${normalizedPath}`;
  const componentCandidates = [
    body.component,
    windowSpec.component,
    existing?.component,
    `docker:aw-${appId}`,
    `docker:${appId}`,
  ].filter(Boolean);
  const component = componentCandidates.find((key) => componentMap[key])
    || body.component
    || windowSpec.component
    || existing?.component
    || null;

  return {
    ...(existing || {}),
    id: appId,
    label: windowSpec.title || existing?.label || existing?.name || appId,
    icon: windowSpec.icon || body.icon || existing?.icon,
    url,
    component,
  };
}


const MIN_W = 400;
const MIN_H = 200;
const STORAGE_KEY = 'aw-window-states';
const ZORDER_KEY = 'aw-window-zorder';

function loadFromStorage(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

export default function WindowManager({ openWindows, components, terminals, maxLines, onCloseWindow, onReopenWindow, onMinimizeWindow, onMaximize, maximizedKey, onAction, onRenameTerminal, onSessionSwitch, claudeSessionIds, copilotSessionIds, insecureMap, onToggleInsecure, onWindowFocus, focusTrigger, focusTriggers, presentations, onRenamePresentation, onDeletePresentation, diffs, layout, layoutTrigger, terminalReconnectSignals, resumeMap, aiAgents, workspaceApps, appWindowSpecs }) {
  // Derive agentType from terminals array for any session key
  const _getAgentType = (key) => {
    const sessionId = key.replace('terminal:', '');
    const t = (terminals || []).find(t => t.id === sessionId);
    if (!t) return null;
    const nonAgentTypes = ['terminal', 'stubborn', 'automation'];
    return nonAgentTypes.includes(t.type) ? null : (t.type || null);
  };
  const componentMap = {};
  components.forEach((c) => { componentMap[c.key] = c; });

  const containerRef = useRef(null);
  const [windowStates, setWindowStates] = useState(() => loadFromStorage(STORAGE_KEY, {}));
  const [zOrder, setZOrder] = useState(() => loadFromStorage(ZORDER_KEY, []));
  const [dragging, setDragging] = useState(false);
  const preMaximizeStates = useRef({});

  const windows = [...openWindows];

  // Persist to localStorage on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(windowStates));
  }, [windowStates]);

  useEffect(() => {
    localStorage.setItem(ZORDER_KEY, JSON.stringify(zOrder));
  }, [zOrder]);

  // Track container dimensions
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Initialize new windows — use saved position if available
  useEffect(() => {
    setWindowStates((prev) => {
      const next = { ...prev };
      let changed = false;
      windows.forEach((key) => {
        if (!next[key]) {
          const offset = (Object.keys(next).length % 6) * 30;
          next[key] = {
            x: 20 + offset,
            y: 20 + offset,
            w: Math.min(Math.max(containerSize.w - 60, MIN_W), 900),
            h: Math.min(Math.max(containerSize.h - 60, MIN_H), 500),
          };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setZOrder((prev) => {
      const next = prev.filter((k) => openWindows.has(k));
      windows.forEach((k) => { if (!next.includes(k)) next.push(k); });
      return next;
    });
  }, [windows.join(','), containerSize.w, containerSize.h]);

  // Apply layout presets
  useEffect(() => {
    if (!layout || windows.length === 0) return;
    applyLayout(layout);
  }, [layoutTrigger]);

  const applyLayout = useCallback((type) => {
    const { w: cw, h: ch } = containerSize;
    const gap = 4;
    const count = windows.length;
    if (count === 0) return;

    setWindowStates((prev) => {
      const next = { ...prev };
      if (type === 'horizontal') {
        const winW = Math.floor((cw - gap * (count - 1)) / count);
        windows.forEach((key, i) => {
          next[key] = { x: i * (winW + gap), y: 0, w: winW, h: ch };
        });
      } else if (type === 'vertical') {
        const winH = Math.floor((ch - gap * (count - 1)) / count);
        windows.forEach((key, i) => {
          next[key] = { x: 0, y: i * (winH + gap), w: cw, h: winH };
        });
      } else if (type === 'grid') {
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        const winW = Math.floor((cw - gap * (cols - 1)) / cols);
        const winH = Math.floor((ch - gap * (rows - 1)) / rows);
        windows.forEach((key, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          next[key] = { x: col * (winW + gap), y: row * (winH + gap), w: winW, h: winH };
        });
      } else if (type === 'maximize') {
        windows.forEach((key) => {
          next[key] = { x: 0, y: 0, w: cw, h: ch };
        });
      } else if (type === 'restore') {
        const defW = Math.min(Math.max(cw * 0.7, MIN_W), 900);
        const defH = Math.min(Math.max(ch * 0.6, MIN_H), 500);
        windows.forEach((key, i) => {
          const offset = i * 30;
          next[key] = {
            x: Math.floor((cw - defW) / 2) + offset,
            y: Math.floor((ch - defH) / 2) + offset,
            w: defW,
            h: defH,
          };
        });
      }
      return next;
    });
  }, [windows, containerSize]);

  const bringToFront = useCallback((key) => {
    onWindowFocus?.(key);
    setZOrder((prev) => {
      // Skip if already on top — avoids unnecessary re-render that kills onClick
      if (prev[prev.length - 1] === key) return prev;
      const next = prev.filter((k) => k !== key);
      next.push(key);
      return next;
    });
  }, []);


  // External focus trigger — bring a window to front when the counter changes
  useEffect(() => {
    if (focusTrigger && focusTrigger.counter > 0) {
      bringToFront(focusTrigger.key);
    }
  }, [focusTrigger?.counter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Multiple focus triggers — bring a window to front when any trigger counter changes
  const prevTriggersRef = useRef({});
  useEffect(() => {
    if (!focusTriggers) return;
    focusTriggers.forEach(({ key, counter }) => {
      if (counter > 0 && counter !== prevTriggersRef.current[key]) {
        bringToFront(key);
      }
      prevTriggersRef.current[key] = counter;
    });
  }, [focusTriggers?.map(t => t.counter).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateWindowState = useCallback((key, update) => {
    setWindowStates((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...update },
    }));
  }, []);

  // Save / restore window geometry around maximize transitions.
  //
  // Why a useEffect (instead of inline during render): the previous
  // implementation mutated `preMaximizeStates.current` and called
  // `setTimeout(updateWindowState, 0)` from inside the render body. That's
  // a render-time side effect — runs every render, deletes the saved state
  // unconditionally as soon as `isMax` flips, and the restore guard
  // (`ws.x===0 && ws.y===0 && …`) almost never matched in practice because
  // `ws` keeps its pre-max coords throughout the maximized state. Net
  // result: restoring landed the window at (0, 0) instead of where it was.
  //
  // Now the logic is event-shaped and idempotent: when `maximizedKey`
  // becomes a key, snapshot that key's geometry; when it goes back to
  // null, push the snapshot into windowStates and drop it.
  const prevMaximizedRef = useRef(null);
  useEffect(() => {
    const prev = prevMaximizedRef.current;
    const curr = maximizedKey;
    if (prev === curr) return;
    if (curr) {
      // Entering maximize for `curr` — snapshot if not already saved.
      const ws = windowStates[curr];
      if (ws && !preMaximizeStates.current[curr]) {
        preMaximizeStates.current[curr] = { x: ws.x, y: ws.y, w: ws.w, h: ws.h };
      }
    }
    if (prev && prev !== curr) {
      // Leaving maximize for `prev` — restore its saved geometry.
      const saved = preMaximizeStates.current[prev];
      if (saved) {
        delete preMaximizeStates.current[prev];
        updateWindowState(prev, saved);
      }
    }
    prevMaximizedRef.current = curr;
  }, [maximizedKey, updateWindowState, windowStates]);

  if (windows.length === 0) {
    return (
      <div ref={containerRef} className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
        <div className="text-center">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <p className="text-sm">Select a component from the sidebar to view logs</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Overlay to prevent iframes from stealing mouse events during drag/resize */}
      {dragging && <div className="absolute inset-0 z-[9999]" />}
      {windows.map((key) => {
        const ws = windowStates[key];
        if (!ws) return null;
        const isMax = maximizedKey === key;
        const zIndex = isMax ? 9000 : zOrder.indexOf(key) + 1;
        const appWindowSpec = (appWindowSpecs || {})[key];
        const managedApp = managedWindowAppEntry(appWindowSpec, workspaceApps, componentMap);

        // Maximize geometry comes from props — ws is preserved untouched
        // so the snapshot+restore useEffect above can put the window
        // back to where it was.
        const pos = isMax ? { x: 0, y: 0 } : { x: ws.x, y: ws.y };
        const size = isMax ? { width: containerSize.w, height: containerSize.h } : { width: ws.w, height: ws.h };

        return (
          <Rnd
            key={key}
            position={pos}
            size={size}
            minWidth={MIN_W}
            minHeight={MIN_H}
            bounds="parent"
            dragHandleClassName="drag-handle"
            // Exempt window controls (search/close/maximize/etc.) and
            // the title/icon cluster from drag initiation.  Without
            // this, iPhone Safari fires `touchstart` first, react-rnd
            // grabs it as a drag, and the button's synthesized click
            // is suppressed — taps on the header buttons appear dead.
            // The existing `onMouseDown={e => e.stopPropagation()}`
            // handlers only catch mouse events; `cancel` works for
            // touch and pointer too.
            cancel=".no-drag"
            style={{ zIndex }}
            disableDragging={isMax}
            enableResizing={isMax ? false : {
              top: true, right: true, bottom: true, left: true,
              topRight: true, topLeft: true, bottomRight: true, bottomLeft: true,
            }}
            onDragStart={() => { setDragging(true); bringToFront(key); }}
            onDragStop={(e, d) => {
              setDragging(false);
              // Don't persist (0,0) into ws while maximized — that would
              // clobber the pre-max position and make restore land at
              // the corner instead of where the window came from. The
              // snapshot/restore useEffect handles the maximized geometry
              // separately, so the live ws should only ever reflect the
              // un-maximized layout.
              if (!isMax) updateWindowState(key, { x: d.x, y: d.y });
            }}
            onResizeStart={() => setDragging(true)}
            onResizeStop={(e, dir, ref, delta, pos) => {
              setDragging(false);
              if (isMax) return;
              updateWindowState(key, {
                w: parseInt(ref.style.width),
                h: parseInt(ref.style.height),
                x: pos.x,
                y: pos.y,
              });
            }}
            resizeHandleStyles={{
              bottomRight: { cursor: 'nwse-resize' },
            }}
          >
            <div
              data-window-key={key}
              className="w-full h-full"
              onMouseDownCapture={() => bringToFront(key)}
            >
              {key.startsWith('diff:') ? (
                <DiffWindow
                  diff={(diffs || {})[key.replace('diff:', '')]}
                  windowKey={key}
                  onClose={() => onCloseWindow(key)}
                  onMaximize={onMaximize}
                  isMaximized={maximizedKey === key}
                  onFocus={() => bringToFront(key)}
                />
              ) : key.startsWith('presentation:') ? (
                <PresentationWindow
                  presentation={(presentations || []).find((c) => c.id === key.replace('presentation:', ''))}
                  windowKey={key}
                  onClose={() => onCloseWindow(key)}
                  onDelete={() => onDeletePresentation?.(key.replace('presentation:', ''))}
                  onMaximize={onMaximize}
                  isMaximized={maximizedKey === key}
                  onRename={onRenamePresentation}
                  onFocus={() => bringToFront(key)}
                />
              ) : key.startsWith('appwin:') && managedApp ? (
                <AppProxyWindow
                  appId={managedApp.id}
                  workspaceApps={[managedApp, ...(workspaceApps || []).filter((a) => a.id !== managedApp.id)]}
                  windowKey={key}
                  componentMap={componentMap}
                  onCloseWindow={onCloseWindow}
                  onReopenWindow={onReopenWindow}
                  onMaximize={onMaximize}
                  maximizedKey={maximizedKey}
                  bringToFront={() => bringToFront(key)}
                  isFocused={zOrder[zOrder.length - 1] === key}
                />
              ) : key.startsWith('appwin:') ? (
                <BasicWindow
                  title={appWindowSpec?.title}
                  spec={appWindowSpec?.spec}
                  windowSpec={appWindowSpec}
                  windowKey={key}
                  onClose={() => onCloseWindow(key)}
                  onMaximize={onMaximize}
                  isMaximized={maximizedKey === key}
                  onFocus={() => bringToFront(key)}
                />
              ) : key === 'panel:remote-desktop' ? (
                <RemoteDesktopWindow
                  windowKey={key}
                  onClose={() => onCloseWindow(key)}
                  onMaximize={onMaximize}
                  isMaximized={maximizedKey === key}
                />
              ) : key === 'debugger:dap' ? (
                <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
                  <div className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                      </svg>
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">Debugger</span>
                    </div>
                    <div className="flex items-center gap-1 no-drag" onMouseDown={(e) => e.stopPropagation()}>
                      <button onClick={() => {
                        window.open('http://127.0.0.1:15050/debugger', 'aw-debugger', 'popup=1,width=1400,height=900');
                        onCloseWindow(key);
                      }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title="Pop out to new window">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </button>
                      <button onClick={() => onMaximize?.(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title={maximizedKey === key ? 'Restore' : 'Maximize'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                      </button>
                      <button onClick={() => onCloseWindow(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  </div>
                  <DebuggerIframe bringToFront={() => bringToFront(key)} isFocused={zOrder[zOrder.length - 1] === key} />
                </div>
              ) : key === 'panel:tasks' ? (
                <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
                  <div className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">Tasks</span>
                    </div>
                    <div className="flex items-center gap-1 no-drag" onMouseDown={(e) => e.stopPropagation()}>
                      <button onClick={() => onMaximize?.(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title={maximizedKey === key ? 'Restore' : 'Maximize'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                      </button>
                      <button onClick={() => onCloseWindow(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto bg-[var(--color-bg-primary)]">
                    <TasksTab />
                  </div>
                </div>
              ) : key === 'panel:plans' ? (
                <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
                  <div className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0">
                    <div className="flex items-center gap-2">
                      {/* Same compass-with-checkmark glyph WorkspaceNav uses
                          for the Plans entry — keeps the visual association. */}
                      <svg className="w-3.5 h-3.5 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
                      </svg>
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">Plans</span>
                    </div>
                    <div className="flex items-center gap-1 no-drag" onMouseDown={(e) => e.stopPropagation()}>
                      <button onClick={() => onMaximize?.(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title={maximizedKey === key ? 'Restore' : 'Maximize'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                      </button>
                      <button onClick={() => onCloseWindow(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 bg-[var(--color-bg-primary)]">
                    <PlansPanel
                      aiAgents={aiAgents || []}
                      terminals={terminals || []}
                      insecureMap={insecureMap}
                      onToggleInsecure={onToggleInsecure}
                      onWindowFocus={onWindowFocus}
                      resumeMap={resumeMap}
                      terminalReconnectSignals={terminalReconnectSignals}
                    />
                  </div>
                </div>
              ) : key === 'panel:tests' ? (
                <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
                  <div className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 2h6a1 1 0 011 1v2H8V3a1 1 0 011-1z" />
                        <path d="M8 4H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2" />
                        <path d="M9 12l2 2 4-4" />
                      </svg>
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">Tests</span>
                    </div>
                    <div className="flex items-center gap-1 no-drag" onMouseDown={(e) => e.stopPropagation()}>
                      <button onClick={() => onMaximize?.(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title={maximizedKey === key ? 'Restore' : 'Maximize'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                      </button>
                      <button onClick={() => onCloseWindow(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[var(--color-bg-primary)]">
                    <TestsPanel />
                  </div>
                </div>
              ) : key === 'panel:settings' ? (
                <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
                  <div className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/>
                      </svg>
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">Settings</span>
                    </div>
                    <div className="flex items-center gap-1 no-drag" onMouseDown={(e) => e.stopPropagation()}>
                      <button onClick={() => onMaximize?.(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title={maximizedKey === key ? 'Restore' : 'Maximize'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                      </button>
                      <button onClick={() => onCloseWindow(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    <SettingsPanel />
                  </div>
                </div>
              ) : key === 'apis:hoppscotch' ? (
                <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
                  <div className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
                      </svg>
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">APIs · Hoppscotch</span>
                    </div>
                    <div className="flex items-center gap-1 no-drag" onMouseDown={(e) => e.stopPropagation()}>
                      <DockerControls
                        componentKey="docker:aw-hoppscotch"
                        status={componentMap['docker:aw-hoppscotch']?.status || 'off'}
                      />
                      <button onClick={() => {
                        window.open(`${window.location.protocol}//apis.${window.location.host.replace(/^www\./, '')}/`, 'aw-hoppscotch', 'popup=1,width=1400,height=900');
                        onCloseWindow(key);
                      }} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer" title="Pop out to new window">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </button>
                      <button onClick={() => onMaximize?.(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer" title={maximizedKey === key ? 'Restore' : 'Maximize'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
                      </button>
                      <button onClick={() => onCloseWindow(key)} className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  </div>
                  <HoppscotchIframe bringToFront={() => bringToFront(key)} isFocused={zOrder[zOrder.length - 1] === key} />
                </div>
              ) : key.startsWith('app:') ? (
                <AppProxyWindow
                  appId={key.slice(4)}
                  workspaceApps={workspaceApps}
                  windowKey={key}
                  componentMap={componentMap}
                  onCloseWindow={onCloseWindow}
                  onReopenWindow={onReopenWindow}
                  onMaximize={onMaximize}
                  maximizedKey={maximizedKey}
                  bringToFront={() => bringToFront(key)}
                  isFocused={zOrder[zOrder.length - 1] === key}
                />
              ) : key.startsWith('terminal:') && (terminals || []).find((t) => `terminal:${t.id}` === key)?.type === 'stubborn' ? (
                <StubbornWindow
                  sessionId={key.replace('terminal:', '')}
                  name={(terminals || []).find((t) => `terminal:${t.id}` === key)?.name || key}
                  presentations={presentations}
                  onOpenPresentation={(presentationId) => {
                    if (onReopenWindow) onReopenWindow(`presentation:${presentationId}`);
                  }}
                  terminalProps={{
                    sessionId: key.replace('terminal:', ''),
                    name: (terminals || []).find((t) => `terminal:${t.id}` === key)?.name || key,
                    windowKey: key,
                    onClose: () => onCloseWindow(key),
                    onMinimize: () => onMinimizeWindow?.(key),
                    onMaximize,
                    isMaximized: maximizedKey === key,
                    onRename: onRenameTerminal,
                    agentType: 'claude',
                    onSessionSwitch,
                    insecure: (insecureMap || {})[key.replace('terminal:', '')] || false,
                    onToggleInsecure,
                    reconnectSignal: ((terminalReconnectSignals || {})[key.replace('terminal:', '')] || 0)
                      + ((terminalReconnectSignals || {})['__server_restart__'] || 0),
                  }}
                />
              ) : key.startsWith('terminal:') ? (
                <TerminalWindow
                  sessionId={key.replace('terminal:', '')}
                  name={(terminals || []).find((t) => `terminal:${t.id}` === key)?.name || key}
                  windowKey={key}
                  onClose={() => onCloseWindow(key)}
                  onMinimize={() => onMinimizeWindow?.(key)}
                  onMaximize={onMaximize}
                  isMaximized={maximizedKey === key}
                  onRename={onRenameTerminal}
                  agentType={_getAgentType(key)}
                  onSessionSwitch={onSessionSwitch}
                  activeSessionId={(resumeMap || {})[key.replace('terminal:', '')]}
                  insecure={(insecureMap || {})[key.replace('terminal:', '')] || false}
                  onToggleInsecure={onToggleInsecure}
                  reconnectSignal={((terminalReconnectSignals || {})[key.replace('terminal:', '')] || 0)
                    + ((terminalReconnectSignals || {})['__server_restart__'] || 0)}
                />
              ) : (
                <div className="w-full h-full flex flex-col rounded-lg overflow-hidden shadow-2xl shadow-black/40 border border-[var(--color-border)]">
                  <LogWindow
                    componentKey={key}
                    component={componentMap[key]}
                    maxLines={maxLines}
                    onClose={() => onCloseWindow(key)}
                    onMaximize={onMaximize}
                    isMaximized={maximizedKey === key}
                    onAction={onAction}
                  />
                </div>
              )}
            </div>
          </Rnd>
        );
      })}
    </div>
  );
}

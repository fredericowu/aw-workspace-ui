import { useState, useCallback, useEffect, useRef } from 'react';
import WindowManager from './components/WindowManager';
// SettingsPanel is now rendered inside WindowManager as a floating panel
import PresentationNav from './components/PresentationNav';
import AgentsNav from './components/AgentsNav';
import WorkspaceNav from './components/WorkspaceNav';
import AppsNav from './components/AppsNav';
import VpnNav from './components/VpnNav';
import StatusDot from './components/StatusDot';
import AuthScreen from './components/AuthScreen';
import MobileApp from './components/MobileApp';
import PromptNotifications from './components/PromptNotifications';
import TopNotifications from './components/TopNotifications';
import ErrorBoundary from './components/ErrorBoundary';
import { asArray } from './lib/asArray';
import AppSlot from './apps/AppSlot';
import { installPluginHost } from './apps/pluginHost';
import { fetchContributions } from './apps/appsApi';
import { wireContributions, findWindowSpec, findAppDefaultWindow } from './apps/wireContributions';
import { useComponentStatus, startComponent, getAwConfig } from './hooks/useComponentStatus';
// import NinjaBuddy from './components/NinjaBuddy';
import { apiFetch, wsUrl, getAuthStatus, logout, initAuth } from './auth';
import { getSuppressKbd, setSuppressKbd, onSuppressKbdChange } from './lib/keyboardMode';
import { getDesktopWidth, setDesktopWidth, WIDTH_OPTIONS, isPhoneSized } from './lib/desktopWidth';
import { isWorkspaceSpa, consoleLoginUrl } from './apiBase';
import { isVirtualKeyboardTrackpadOpen, toggleVirtualKeyboardTrackpad } from './lib/virtualKeyboardTrackpad';
const API_BASE = '';

function isMobileDevice() {
  return window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Sticky layout choice — shared with the inline viewport-swap script in
// index.html so the React app's layout (mobile vs desktop) and the
// `<meta name="viewport">` width stay in lockstep across reloads.
// localStorage (not sessionStorage) so closing and reopening the tab
// remembers, matching the user's expectation of "refresh keeps view."
const LAYOUT_INTENT_KEY = 'aw_layout_intent';
function readLayoutIntent() {
  try { return localStorage.getItem(LAYOUT_INTENT_KEY); } catch { return null; }
}
function writeLayoutIntent(v) {
  try {
    if (v) localStorage.setItem(LAYOUT_INTENT_KEY, v);
    else localStorage.removeItem(LAYOUT_INTENT_KEY);
  } catch {}
}

export default function App() {
  // 'checking' | 'authenticated' | 'unauthenticated'
  const [authState, setAuthState] = useState('checking');
  const [isMobile, setIsMobile] = useState(() => {
    // 1. Explicit hash override always wins and persists the intent.
    const hash = window.location.hash;
    if (hash === '#mobile')  { writeLayoutIntent('mobile');  return true;  }
    if (hash === '#desktop') { writeLayoutIntent('desktop'); return false; }
    // 2. Persisted intent from a previous session (refresh, new tab).
    const intent = readLayoutIntent();
    if (intent === 'mobile')  return true;
    if (intent === 'desktop') return false;
    // 3. Fresh user — fall back to UA / screen-size detection.
    return isMobileDevice();
  });

  // Auto-detect on resize — but only if the user has *never* made an
  // explicit layout choice.  Once they've toggled, respect their pick.
  useEffect(() => {
    const onResize = () => {
      if (readLayoutIntent()) return; // user has a sticky preference
      const hash = window.location.hash;
      if (hash === '#mobile' || hash === '#desktop') return; // manual override
      setIsMobile(isMobileDevice());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Set hash on mobile detection (only if no explicit hash)
  useEffect(() => {
    const hash = window.location.hash;
    if (isMobile && !hash.startsWith('#mobile')) {
      window.location.hash = '#mobile';
    }
  }, [isMobile]);

  // Listen for hash changes — persist the explicit choice so it
  // survives reloads.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === '#mobile') {
        writeLayoutIntent('mobile');
        setIsMobile(true);
      } else if (window.location.hash === '#desktop') {
        writeLayoutIntent('desktop');
        setIsMobile(false);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Check auth on mount via server
  useEffect(() => {
    let cancelled = false;
    const refreshAuth = () => {
      getAuthStatus().then(({ authenticated }) => {
        if (cancelled) return;
        // `null` means the check itself couldn't complete (e.g. the BYOD
        // tunnel is mid-restart) — not a real logout. Keep the current
        // state rather than bouncing the user to the login screen; the
        // next focus/visibility recheck will retry.
        if (authenticated === null) return;
        setAuthState(authenticated ? 'authenticated' : 'unauthenticated');
      });
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') refreshAuth();
    };

    initAuth();
    refreshAuth();
    window.addEventListener('focus', refreshAuth);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshAuth);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Listen for auth failures (401) from any fetch call
  useEffect(() => {
    const onAuthFail = () => setAuthState('unauthenticated');
    window.addEventListener('aw-auth-failed', onAuthFail);
    return () => window.removeEventListener('aw-auth-failed', onAuthFail);
  }, []);

  // Honor ?next= once the user is authenticated. This is set by the per-app
  // auth gate in /_aw_auth — when an unauthed visitor hits a protected app
  // (e.g. hoppscotch.app.dev.tekflox.com), the backend bounces them here
  // with ?next=<original app URL>. After login we navigate them back.
  //
  // Whitelist: only *.dev.tekflox.com targets are honored, to prevent
  // open-redirect abuse via crafted links. Anything else is silently dropped.
  useEffect(() => {
    if (authState !== 'authenticated') return;
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    if (!next) return;
    let safe = false;
    try {
      const u = new URL(next, window.location.origin);
      // Must be HTTPS and on the same domain as this app (apex or any subdomain).
      // window.location.hostname is the parent domain itself (e.g. dev.tekflox.com),
      // so we don't need a hardcoded value — it adapts to any deployment hostname.
      const parentDomain = window.location.hostname;
      if (u.protocol === 'https:' &&
          (u.hostname === parentDomain || u.hostname.endsWith('.' + parentDomain))) {
        safe = true;
      }
    } catch {
      safe = false;
    }
    if (safe) {
      // Full-page navigate — usually crossing to a different subdomain
      // anyway, so a JS state change wouldn't get us there.
      window.location.assign(next);
    }
  }, [authState]);

  if (authState === 'checking') {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
        <span className="text-[var(--color-text-muted)] text-sm">Loading…</span>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    // Three-plane split: the cloud workspace SPA (<slug>.workspace.<domain>)
    // has no login of its own — identity is owned by the console. Bounce an
    // unauthenticated visit to the console login, which redirects back here
    // after auth. The legacy password/"root account" AuthScreen is only for
    // the single-tenant dashboard host (aw.tekflox.com), which is NOT a
    // workspace SPA (deriveBases → api:'').
    if (isWorkspaceSpa()) {
      return <WorkspaceLoginRedirect />;
    }
    return <AuthScreen onAuthenticated={() => setAuthState('authenticated')} />;
  }

  if (isMobile) {
    return <MobileApp />;
  }

  return <AuthenticatedApp />;
}

// Unauthenticated landing on the cloud workspace SPA host — no password
// screen (identity is owned by the console). Show a brief message and
// redirect to the console login, which returns here after auth.
function WorkspaceLoginRedirect() {
  useEffect(() => {
    const url = consoleLoginUrl();
    if (url) window.location.replace(url);
  }, []);
  return (
    <div className="h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
      <div className="w-80 text-center">
        <span className="text-2xl font-bold tracking-wide text-[var(--color-accent)]">AW</span>
        <p className="text-sm text-[var(--color-text-muted)] mt-3">Sign in to continue…</p>
      </div>
    </div>
  );
}

// Detect "Add to Home Screen" PWA mode on iOS / Android.  When running
// as a standalone PWA the user wants a clean app shell — no developer
// dials.  In regular Safari/Chrome they DO want the iPhone toolset.
function isStandalonePWA() {
  try {
    if (navigator.standalone === true) return true;
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {}
  return false;
}

function AuthenticatedApp() {
  // Pre-seed Hoppscotch JWT cookies with Domain=dev.tekflox.com so every
  // app-proxy subdomain (e.g. hoppscotch.app-proxy.dev.tekflox.com) is
  // transparently logged in without a separate auth round-trip.  The
  // noredirect=1 flag returns 200+Set-Cookie with no redirect; the fetch
  // processes the Set-Cookie headers and the browser stores the cookies.
  // Fire-and-forget — a network error here is non-fatal.
  useEffect(() => {
    fetch('/_aw_auth?noredirect=1', { credentials: 'same-origin', cache: 'no-store' }).catch(() => {});
  }, []);

  // Global "suppress on-screen keyboard" state — drives the top-bar
  // toggle.  The actual DOM mutation (setting `inputmode="none"` on
  // every xterm helper textarea) is done by lib/keyboardMode.js, which
  // also watches for newly mounted terminals.
  const [suppressKbd, setSuppressKbdState] = useState(() => getSuppressKbd());
  useEffect(() => onSuppressKbdChange(setSuppressKbdState), []);

  // Desktop-on-phone viewport width picker.  Only relevant on phone-
  // sized devices — meaningless on real desktops, so hidden there.
  // AuthenticatedApp only renders in desktop layout (App routes mobile
  // devices to <MobileApp/>), so we just check the screen size.
  const [desktopWidth, setDesktopWidthState] = useState(() => getDesktopWidth());

  const [virtualKbdOpen, setVirtualKbdOpen] = useState(() => isVirtualKeyboardTrackpadOpen());
  useEffect(() => {
    const onState = (event) => setVirtualKbdOpen(!!event.detail?.open);
    window.addEventListener('aw-virtual-keyboard-trackpad-state', onState);
    return () => window.removeEventListener('aw-virtual-keyboard-trackpad-state', onState);
  }, []);

  // Show the iPhone toolset (width picker, keyboard toggle) on phone-sized
  // devices regardless of standalone PWA mode — user wants the tools
  // available both in regular Safari and when launched from the
  // home-screen icon.  Real desktops stay clean.
  const showPhoneTools = isPhoneSized();
  const showWidthPicker = showPhoneTools;
  const showKbdToggle = showPhoneTools;

  const { components, refetch } = useComponentStatus();

  // Workspace apps — loaded from aw.json on mount and re-loaded when
  // settings are saved (aw-config-changed event).
  const [workspaceApps, setWorkspaceApps] = useState([]);
  const enabledApps = (workspaceApps || []).filter(a => a.enabled !== false);
  useEffect(() => {
    const load = () => getAwConfig().then((cfg) => setWorkspaceApps(cfg.workspace_apps || [])).catch(() => {});
    load();
    window.addEventListener('aw-config-changed', load);
    return () => window.removeEventListener('aw-config-changed', load);
  }, []);

  // Per-app focus triggers — a single object keyed by app id so we don't
  // need a new useState per dynamic app.  Incrementing the counter brings
  // an already-open app:* window to the front (mirrors the per-window
  // trigger pattern used by the hardcoded Browser / VSCode launchers).
  const [appFocusTriggers, setAppFocusTriggers] = useState({});

  const openApp = useCallback((appId) => {
    const key = `app:${appId}`;
    setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
    setView('home');
    setAppFocusTriggers((prev) => ({ ...prev, [appId]: (prev[appId] || 0) + 1 }));
  }, []);

  const [focusedWindowKey, setFocusedWindowKey] = useState(null);
  const [debuggerFocusTrigger, setDebuggerFocusTrigger] = useState(0);
  // Counter-style focus triggers for the workspace-menu floating panels.
  // WindowManager listens via the `focusTriggers` prop; bumping the counter
  // bringsthe matching window key to the top of zOrder. Without these, a
  // second click on a Workspace menu item that's already open would
  // re-open with no visible effect — the window stayed buried under
  // whatever was on top.
  const [settingsPanelFocusTrigger, setSettingsPanelFocusTrigger] = useState(0);
  const [tasksPanelFocusTrigger, setTasksPanelFocusTrigger] = useState(0);
  const [plansPanelFocusTrigger, setPlansPanelFocusTrigger] = useState(0);
  const [testsPanelFocusTrigger, setTestsPanelFocusTrigger] = useState(0);
  const [knowledgeBaseFocusTrigger, setKnowledgeBaseFocusTrigger] = useState(0);
  const [whiteboardPanelFocusTrigger, setWhiteboardPanelFocusTrigger] = useState(0);
  const [remoteDesktopFocusTrigger, setRemoteDesktopFocusTrigger] = useState(0);
  const [presentationFocusTrigger, setPresentationFocusTrigger] = useState({ key: '', counter: 0 });

  // Ninja patrol zone — measures the gap between nav and Log Out so the ninja
  // fills whatever free space the top bar has. <50px → no ninja.
  // const ninjaSpaceRef = useRef(null);
  // const [ninjaWidth, setNinjaWidth] = useState(0);
  // useEffect(() => {
  //   const el = ninjaSpaceRef.current;
  //   if (!el || typeof ResizeObserver === 'undefined') return;
  //   const ro = new ResizeObserver((entries) => {
  //     for (const entry of entries) {
  //       // contentRect.width excludes padding — exactly the patrol width
  //       setNinjaWidth(Math.max(0, Math.floor(entry.contentRect.width)));
  //     }
  //   });
  //   ro.observe(el);
  //   return () => ro.disconnect();
  // }, []);

  // Speech recognition for push-to-talk
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const sendVoiceRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          text += event.results[i][0].transcript;
        }
      }
      if (text.trim()) {
        sendVoiceRef.current?.(text.trim());
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, []);
  const [openWindows, setOpenWindows] = useState(() => {
    try {
      const saved = localStorage.getItem('aw-open-windows');
      if (!saved) return new Set();
      // Filter out presentation windows — they should not reopen on refresh
      return new Set(JSON.parse(saved).filter((k) => !k.startsWith('presentation:')));
    } catch { return new Set(); }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('aw-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const [maxLines, setMaxLines] = useState(1000);
  const [layout, setLayout] = useState(null);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [notifHistory, setNotifHistory] = useState([]);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);

  // Keep the profile icon's badge live: seed from pending (new/delivered)
  // notifications on mount, then track the same /ws/notifications feed
  // TopNotifications consumes so the count updates without a poll.
  useEffect(() => {
    apiFetch(`${API_BASE}/api/notify/pending`).then(r => r.json())
      .then(d => setNotifUnreadCount((d.notifications || []).length))
      .catch(() => {});
    let closed = false;
    let ws;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(wsUrl('/ws/notifications'));
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ninja_notification') {
            const supersededCount = (msg.superseded_ids || []).length;
            setNotifUnreadCount((n) => Math.max(0, n - supersededCount) + 1);
          }
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => { if (!closed) setTimeout(connect, 5000); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };
    connect();
    return () => { closed = true; if (ws) { try { ws.close(); } catch {} } };
  }, []);
  const [view, setView] = useState('home');
  // Decoupled-apps (F6 Cap 2): declarative windows (contributes.windows,
  // opened via a nav entry or an Installed Apps row click) are real
  // WindowManager-managed windows (drag/resize/maximize/persisted position,
  // same as every other window type) — see AppDeclarativeWindow.jsx. Keyed
  // by `appwin:{windowId}` in the shared `openWindows` Set; this map holds
  // each one's {id, title, spec} for WindowManager to render.
  const [appWindowSpecs, setAppWindowSpecs] = useState({});
  const [terminals, setTerminals] = useState([]);
  const [presentations, setPresentations] = useState([]);
  const [diffs, setDiffs] = useState({});
  const [stubbornUi, setStubbornUi] = useState(false);
  const [aiAgents, setAiAgents] = useState([
    { type: 'claude', label: 'Claude', command: 'claude', color: '#d97706', icon: 'bolt' },
    { type: 'copilot', label: 'Copilot', command: 'copilot', color: '#2ea043', icon: 'copilot' },
    { type: 'codex', label: 'Codex', command: 'codex', color: '#0ea5e9', icon: 'codex' },
  ]);

  // Load aw config to check feature flags and agent list
  useEffect(() => {
    getAwConfig().then(cfg => {
      if (cfg.stubborn_ui !== undefined) setStubbornUi(!!cfg.stubborn_ui);
      if (cfg.ai_agents?.length) setAiAgents(cfg.ai_agents);
      if (cfg.log_tail_lines) setMaxLines(Number(cfg.log_tail_lines));
    }).catch(() => {});
  }, []);

  // Re-read config when saved from Settings
  useEffect(() => {
    const handler = () => {
      getAwConfig().then(cfg => {
        if (cfg.log_tail_lines) setMaxLines(Number(cfg.log_tail_lines));
        if (cfg.ai_agents?.length) setAiAgents(cfg.ai_agents);
        if (cfg.stubborn_ui !== undefined) setStubbornUi(!!cfg.stubborn_ui);
      }).catch(() => {});
    };
    window.addEventListener('aw-config-changed', handler);
    return () => window.removeEventListener('aw-config-changed', handler);
  }, []);

  // Persist UI state to localStorage
  useEffect(() => {
    localStorage.setItem('aw-open-windows', JSON.stringify([...openWindows]));
  }, [openWindows]);
  useEffect(() => {
    localStorage.setItem('aw-sidebar-collapsed', sidebarCollapsed ? 'true' : 'false');
  }, [sidebarCollapsed]);
  // Sync view -> hash
  useEffect(() => {
    if (view === 'home' && window.location.hash !== '#home') {
      window.location.hash = '#home';
    }
    // 'settings' hash is managed by SettingsPanel
  }, [view]);

  // (Settings is now a floating window — no hash-based view routing needed)

  // Presentation WebSocket for real-time updates from Claude MCP
  // Reconnects automatically on drop — VPN hiccups, laptop sleep, server restarts
  // would otherwise silently leave the browser deaf to presentation updates.
  useEffect(() => {
    let ws;
    let reconnectTimer;
    let heartbeatTimer;
    let closed = false;

    const handleMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'presentation_init') {
        // Just load the presentation list — don't auto-open on page refresh
        setPresentations(msg.presentations);
      } else if (msg.type === 'presentation_update') {
        // Notify any tab listening for presentation changes (e.g. Settings > Tasks
        // GeneratedAssets panel, which refetches its tag-filtered slice).
        try { window.dispatchEvent(new CustomEvent('aw-presentation-update', { detail: msg })); } catch (_) {}
        if (msg.action === 'create') {
          setPresentations((prev) => [...prev.filter((c) => c.id !== msg.presentation.id), msg.presentation]);
          // Auto-open the new presentation unless:
          //   - visible=false (stubborn / thumbnail-only presentations), or
          //   - silent=true (transport hint from the producer — e.g. presentations
          //     generated inside a background task; they should show in the
          //     Presentation menu but not yank the user out of their current view).
          if (msg.presentation.visible !== false && !msg.silent) {
            setOpenWindows((prev) => { const next = new Set(prev); next.add(`presentation:${msg.presentation.id}`); return next; });
            setMaximizedKey(`presentation:${msg.presentation.id}`);
            setPresentationFocusTrigger({ key: `presentation:${msg.presentation.id}`, counter: Date.now() });
            setView('home');
          }
        } else if (msg.action === 'update') {
          setPresentations((prev) => prev.map((c) => c.id === msg.presentation.id ? msg.presentation : c));
          // Re-open and maximize on update is the "claude tweaked it, surface
          // it" behavior. Skipped for silent updates (task-driven changes).
          if (!msg.silent) {
            setOpenWindows((prev) => { const next = new Set(prev); next.add(`presentation:${msg.presentation.id}`); return next; });
            setMaximizedKey(`presentation:${msg.presentation.id}`);
            setPresentationFocusTrigger({ key: `presentation:${msg.presentation.id}`, counter: Date.now() });
            setView('home');
          }
        } else if (msg.action === 'delete') {
          setPresentations((prev) => prev.filter((c) => c.id !== msg.id));
          setOpenWindows((prev) => { const next = new Set(prev); next.delete(`presentation:${msg.id}`); return next; });
        }
      } else if (msg.type === 'diff_open') {
        const diff = msg.diff;
        setDiffs((prev) => ({ ...prev, [diff.id]: diff }));
        setOpenWindows((prev) => { const next = new Set(prev); next.add(`diff:${diff.id}`); return next; });
        setMaximizedKey(`diff:${diff.id}`);
        setView('home');
      } else if (msg.type === 'test_finished') {
        // Automation terminal process exited — update shared state
        apiFetch('/api/tests/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ running: false }),
        }).catch(() => {});
      }
    };

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(wsUrl('/ws/presentations'));
        ws.onmessage = handleMessage;
        ws.onopen = () => {
          // Heartbeat every 25s to detect silently-dropped TCP connections
          // (browser/OS won't always fire onclose on network failures)
          clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(() => {
            try {
              if (ws && ws.readyState === WebSocket.OPEN) ws.send('ping');
              else { clearInterval(heartbeatTimer); try { ws && ws.close(); } catch {} }
            } catch { clearInterval(heartbeatTimer); }
          }, 25000);
        };
        ws.onclose = () => {
          clearInterval(heartbeatTimer);
          if (!closed) reconnectTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => { try { ws.close(); } catch {} };
      } catch {
        if (!closed) reconnectTimer = setTimeout(connect, 3000);
      }
    };

    connect();

    // Reconnect immediately when the tab becomes visible again after sleep
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!ws || ws.readyState > WebSocket.OPEN)) {
        clearTimeout(reconnectTimer);
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', onVisible);
      if (ws) { ws.onclose = null; try { ws.close(); } catch {} }
    };
  }, []);

  // Whiteboard WebSocket — when the agent pushes new content to a whiteboard
  // (via MCP show_html / load_presentation), auto-open the Whiteboard window
  // and raise it to the front, so a "load X in the whiteboard" command surfaces
  // it without the user hunting for the menu. The window's own iframe handles
  // the content reload; this listener only owns the open+focus behavior.
  useEffect(() => {
    let ws, reconnectTimer, closed = false;
    const bringToFront = () => {
      setOpenWindows((prev) => { const next = new Set(prev); next.add('panel:whiteboard'); return next; });
      setView('home');
      setFocusedWindowKey('panel:whiteboard');
      setWhiteboardPanelFocusTrigger((n) => n + 1);
    };
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl('/ws/whiteboard'));
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            // Only `set` (new content) pops the window — `exec_js` overlays and
            // `init` handshakes must not yank the user's view.
            if (msg.type === 'whiteboard_update' && msg.action === 'set') bringToFront();
            // Agent-driven close: dismiss the whiteboard window on every viewer.
            else if (msg.type === 'whiteboard_close') {
              setOpenWindows((prev) => { const next = new Set(prev); next.delete('panel:whiteboard'); return next; });
              setMaximizedKey((k) => (k === 'panel:whiteboard' ? null : k));
            }
          } catch {}
        };
        ws.onclose = () => { if (!closed) reconnectTimer = setTimeout(connect, 5000); };
        ws.onerror = () => { try { ws.close(); } catch {} };
      } catch {
        if (!closed) reconnectTimer = setTimeout(connect, 5000);
      }
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      if (ws) { ws.onclose = null; try { ws.close(); } catch {} }
    };
  }, []);

  // DAP server WebSocket — track debug stopped state for the Debugger button.
  // Reconnect uses exponential backoff (1s, 2s, 4s, 8s, then capped at 10s)
  // so a missing dap-server doesn't fill the console with retry errors.
  // Backoff resets to 1s once a connection lands successfully.
  //
  // The DAP server only listens on localhost:15050 — when AW is
  // accessed over the LAN (e.g. http://192.168.1.x:9123) the
  // browser tries to connect to its OWN 127.0.0.1, which is not
  // the AW host, and floods the console with errors.  Skip the
  // connection unless we're actually running on localhost.
  const [debugStopped, setDebugStopped] = useState(false);
  const [debugStoppedService, setDebugStoppedService] = useState('');
  useEffect(() => {
    const onLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    if (!onLocalhost) return;
    let ws;
    let reconnectTimer;
    let backoff = 1000; // ms — doubles on each failure, capped at 10s
    const connectDap = () => {
      try {
        ws = new WebSocket('ws://127.0.0.1:15050/ws/events');
        ws.onopen = () => {
          // Successful connection — reset the backoff so a future drop starts
          // retrying quickly again.
          backoff = 1000;
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'init') {
              const stopped = (data.services || []).find(s => s.stopped);
              setDebugStopped(!!stopped);
              setDebugStoppedService(stopped?.name || '');
            } else if (data.type === 'stopped') {
              setDebugStopped(true);
              setDebugStoppedService(data.service || '');
              // Auto-open debugger window unless user dismissed within the last hour
              const dismissed = parseInt(localStorage.getItem('aw-debugger-dismissed') || '0', 10);
              if (Date.now() - dismissed > 3600000) {
                setOpenWindows(prev => { const next = new Set(prev); next.add('debugger:dap'); return next; });
                setView('home');
              }
            } else if (data.type === 'continued') {
              setDebugStopped(false);
              setDebugStoppedService('');
            } else if (data.type === 'disconnected') {
              // If the disconnected service was the stopped one, clear stopped state
              if (data.service && data.service === debugStoppedService) {
                setDebugStopped(false);
                setDebugStoppedService('');
              }
            }
          } catch {}
        };
        ws.onclose = () => {
          // DAP server gone — clear debug state (no services are debugged)
          setDebugStopped(false);
          setDebugStoppedService('');
          reconnectTimer = setTimeout(connectDap, backoff);
          backoff = Math.min(backoff * 2, 10000);
        };
        ws.onerror = () => ws.close();
      } catch {
        reconnectTimer = setTimeout(connectDap, backoff);
        backoff = Math.min(backoff * 2, 10000);
      }
    };
    connectDap();
    return () => { clearTimeout(reconnectTimer); if (ws) { ws.onclose = null; ws.close(); } };
  }, []);

  const deletePresentation = useCallback(async (presentationId) => {
    await apiFetch(`${API_BASE}/api/presentations/${presentationId}`, { method: 'DELETE' });
  }, []);

  const renamePresentation = useCallback(async (presentationId, newTitle) => {
    await apiFetch(`${API_BASE}/api/presentations/${presentationId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
  }, []);

  const togglePresentation = useCallback((presentationId) => {
    const key = `presentation:${presentationId}`;
    setOpenWindows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setView('home');
  }, []);

  // ---- Decoupled-apps plugin host (F6 Cap 2) --------------------------------
  // F5 shipped the frontend plugin runtime as an unwired library; this boots it:
  // install the host, fetch the workspace's contributions, register declarative
  // nav into the core.nav / core.nav.workspace slots, and load component-mode
  // bundles. Re-runs on app install/uninstall + window refocus. Zero contributing
  // apps ⇒ zero visual change (safe).
  const contributionsRef = useRef(null);

  // Opens (or refocuses) a decoupled app's declarative window as a real
  // WindowManager window — see the appWindowSpecs state declaration above.
  const openAppWindow = useCallback((found) => {
    if (!found?.id) return;
    const key = `appwin:${found.id}`;
    setAppWindowSpecs((prev) => ({ ...prev, [key]: found }));
    setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
  }, []);

  useEffect(() => {
    installPluginHost();
    let disposed = false;
    let dispose = null;

    const openWindowById = (windowId) => {
      const found = findWindowSpec(contributionsRef.current, windowId);
      if (found && (found.spec || found.body?.type === 'managed_app')) openAppWindow(found);
    };

    const load = async () => {
      let contributions;
      try {
        contributions = await fetchContributions();
      } catch {
        return; // no workspace API / not reachable — leave the shell unchanged
      }
      if (disposed) return;
      contributionsRef.current = contributions;
      if (dispose) { try { dispose(); } catch {} dispose = null; }
      dispose = await wireContributions(contributions, window.__AW_PLUGIN_HOST__, {
        onOpenWindow: openWindowById,
      });
    };

    load();
    const onChanged = () => load();
    window.addEventListener('aw-apps-changed', onChanged);
    window.addEventListener('focus', onChanged);
    return () => {
      disposed = true;
      window.removeEventListener('aw-apps-changed', onChanged);
      window.removeEventListener('focus', onChanged);
      if (dispose) { try { dispose(); } catch {} }
    };
  }, []);

  // Open a framework-installed app's default window from its Apps-view card
  // (InstalledApps has no nav entry to click through — see AppLauncher).
  const openInstalledApp = useCallback((appId) => {
    const found = findAppDefaultWindow(contributionsRef.current, appId);
    if (found && (found.spec || found.body?.type === 'managed_app')) openAppWindow(found);
  }, [openAppWindow]);

  const toggleWindow = useCallback((key) => {
    setOpenWindows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setView('home');
  }, []);

  const minimizeWindow = useCallback((key) => {
    setOpenWindows((prev) => {
      const next = new Set(prev);
      next.delete(key);
      localStorage.setItem('aw-open-windows', JSON.stringify([...next]));
      return next;
    });
    // PTY stays alive — just hide the window
  }, []);

  const closeWindow = useCallback((key) => {
    setOpenWindows((prev) => {
      const next = new Set(prev);
      next.delete(key);
      // Persist immediately to avoid stale localStorage on crash/blank
      localStorage.setItem('aw-open-windows', JSON.stringify([...next]));
      return next;
    });
    // Remember debugger dismiss for 1 hour (suppresses auto-open on breakpoint)
    if (key === 'debugger:dap') {
      localStorage.setItem('aw-debugger-dismissed', String(Date.now()));
    }
    // If closing a terminal window, also delete the session
    if (key.startsWith('terminal:')) {
      const sessionId = key.replace('terminal:', '');
      apiFetch(`${API_BASE}/api/terminals/${sessionId}`, { method: 'DELETE' });
      setTerminals((prev) => prev.filter((t) => t.id !== sessionId));
      setAgentSessions((prev) => prev.filter((t) => t.id !== sessionId));
      setStubbornSessions((prev) => prev.filter((t) => t.id !== sessionId));
    }
  }, []);

  const [maximizedKey, setMaximizedKey] = useState(() => {
    try { return localStorage.getItem('aw-maximized-key') || null; } catch { return null; }
  });

  useEffect(() => {
    if (maximizedKey) localStorage.setItem('aw-maximized-key', maximizedKey);
    else localStorage.removeItem('aw-maximized-key');
  }, [maximizedKey]);

  const maximizeWindow = useCallback((key) => {
    if (maximizedKey === key) {
      setMaximizedKey(null);
    } else {
      setMaximizedKey(key);
    }
  }, [maximizedKey]);

  const [layoutTrigger, setLayoutTrigger] = useState(0);
  const applyLayout = (type) => {
    setLayout(type);
    setLayoutTrigger((n) => n + 1);
  };

  // Terminal management
  // Expose terminal opener globally so GitHubSection can open terminal windows
  useEffect(() => {
    window.__awOpenTerminal = (sessionId) => {
      setOpenWindows((prev) => { const next = new Set(prev); next.add(`terminal:${sessionId}`); return next; });
      setView('home');
    };
    // Settings > Tasks > GeneratedAssets calls this to surface a tagged presentation
    // in the home view without round-tripping through the WS broadcast.
    window.__awOpenPresentation = (presentationId) => {
      const key = `presentation:${presentationId}`;
      setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
      setMaximizedKey(key);
      setPresentationFocusTrigger({ key, counter: Date.now() });
      setView('home');
    };
    return () => {
      delete window.__awOpenTerminal;
      delete window.__awOpenPresentation;
    };
  }, []);

  const createTerminal = useCallback(async () => {
    // Find next available number to avoid duplicate names
    const existingNums = terminals.map(t => {
      const m = t.name?.match(/^Terminal (\d+)$/);
      return m ? parseInt(m[1]) : 0;
    });
    const count = Math.max(0, ...existingNums) + 1;
    const res = await apiFetch(`${API_BASE}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Terminal ${count}` }),
    });
    const data = await res.json();
    // Don't manually add to terminals — the WebSocket terminal_update broadcast will do it.
    // Just open the window immediately.
    setOpenWindows((prev) => {
      const next = new Set(prev);
      next.add(`terminal:${data.id}`);
      return next;
    });
    setView('home');
  }, [terminals]);

  const deleteTerminal = useCallback(async (sessionId) => {
    await apiFetch(`${API_BASE}/api/terminals/${sessionId}`, { method: 'DELETE' });
    // WebSocket broadcast will remove from terminals
    setOpenWindows((prev) => {
      const next = new Set(prev);
      next.delete(`terminal:${sessionId}`);
      return next;
    });
  }, []);

  const renameTerminal = useCallback(async (sessionId, newName) => {
    await apiFetch(`${API_BASE}/api/terminals/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    // Optimistic update: rename the target terminal AND any sibling sessions
    // that share the same agent_session_id (e.g. two windows on the same
    // Claude conversation). The WS broadcast will confirm, but updating
    // locally avoids a visible flicker on the sibling window.
    const updateFn = (prev) => {
      const target = prev.find((t) => t.id === sessionId);
      const sharedId = target?.agent_session_id;
      return prev.map((t) =>
        t.id === sessionId || (sharedId && t.agent_session_id === sharedId)
          ? { ...t, name: newName }
          : t
      );
    };
    setTerminals(updateFn);
    setAgentSessions(updateFn);
  }, []);

  const toggleTerminal = useCallback((sessionId) => {
    const key = `terminal:${sessionId}`;
    setOpenWindows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setView('home');
  }, []);

  // Agent sessions — all AI CLIs (claude, copilot, cursor, etc.) unified; stubborn separate
  const [agentSessions, setAgentSessions] = useState([]);
  const [stubbornSessions, setStubbornSessions] = useState([]);
  // Keyed by agent type — populated by WS push (agent_sessions_update) and seeded
  // by AgentsNav's one-time REST fetch on first flyout open.  Replaces the old
  // agentPickerRefreshToken→REST-refetch polling pattern.
  const [agentSessionsMap, setAgentSessionsMap] = useState({});

  const applyTerminalUpdate = useCallback((data) => {
    const alive = asArray(data).filter((t) => t.alive);
    // type='terminal' = plain terminals; type='stubborn' = stubborn; everything else = AI agent
    const agentOnes = alive.filter((t) => t.type !== 'terminal' && t.type !== 'stubborn');
    const stubbornOnes = alive.filter((t) => t.type === 'stubborn');
    const termOnes = alive.filter((t) => t.type === 'terminal');
    setAgentSessions(agentOnes);
    setStubbornSessions(stubbornOnes);
    setTerminals(termOnes);
    const insecure = {};
    const resume = {};
    agentOnes.forEach((t) => {
      insecure[t.id] = !!t.insecure;
      if (t.agent_session_id) resume[t.id] = t.agent_session_id;
    });
    setInsecureMap(insecure);
    setClaudeResumeMap((prev) => ({ ...prev, ...resume }));
    return alive;
  }, []);

  // Initial load — seed terminal state and prune stale openWindows.
  // We do NOT auto-add all alive terminals here: openWindows is now
  // visibility-per-tab (localStorage).  A new browser tab starts with no
  // windows open; an existing tab keeps whatever the user had visible.
  // The WS 'init' snapshot (dispatched as an 'aw-terminals-update' event)
  // arrives immediately after connect and also calls applyTerminalUpdate, so
  // the REST fetch here is a belt-and-suspenders fallback for the rare case
  // the WS snapshot races or arrives late.
  useEffect(() => {
    apiFetch(`${API_BASE}/api/terminals`)
      .then((res) => res.json())
      .then((data) => {
        const alive = applyTerminalUpdate(data);
        const aliveIds = new Set(alive.map((t) => `terminal:${t.id}`));
        // Only prune stale terminal keys from localStorage — never add new ones.
        setOpenWindows((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const key of [...next]) {
            if (key.startsWith('terminal:') && !aliveIds.has(key)) {
              next.delete(key);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      })
      .catch(() => {});
  }, [applyTerminalUpdate]);

  // Track reconnect signals per terminal (bumped when backend broadcasts a restart)
  const [terminalReconnectSignals, setTerminalReconnectSignals] = useState({});

  // Listen for real-time terminal updates via WebSocket (broadcast from backend)
  useEffect(() => {
    const handler = (e) => {
      const { action, session_id, terminals } = e.detail;
      if (terminals) {
        const alive = applyTerminalUpdate(terminals);
        // Prune any openWindows entries whose terminal no longer exists. Without
        // this the deleted terminal's TerminalWindow stays mounted and its
        // WebSocket retries 8 times against a 403 before giving up — visible
        // as a console-error storm and a zombie window.
        const aliveIds = new Set(alive.map((t) => `terminal:${t.id}`));
        setOpenWindows((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const key of [...next]) {
            if (key.startsWith('terminal:') && !aliveIds.has(key)) {
              next.delete(key);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
      if (action === 'restart' && session_id) {
        setTerminalReconnectSignals((prev) => ({ ...prev, [session_id]: (prev[session_id] || 0) + 1 }));
      }
    };
    window.addEventListener('aw-terminals-update', handler);
    return () => window.removeEventListener('aw-terminals-update', handler);
  }, [applyTerminalUpdate]);

  // Keep agentSessionsMap in sync with server-pushed session lists.
  useEffect(() => {
    const handler = (e) => {
      const { agent_type, sessions } = e.detail || {};
      if (agent_type && Array.isArray(sessions)) {
        setAgentSessionsMap((prev) => ({ ...prev, [agent_type]: sessions }));
      }
    };
    window.addEventListener('aw-agent-sessions-update', handler);
    return () => window.removeEventListener('aw-agent-sessions-update', handler);
  }, []);

  // When the status WebSocket reconnects after a server restart, bump every
  // terminal's reconnect signal so their WebSockets retry — regardless of
  // whether they already exhausted their individual retry budgets.
  useEffect(() => {
    const handler = () => {
      setTerminalReconnectSignals((prev) => {
        const next = { ...prev };
        // Bump every known terminal (agents + plain + stubborn)
        // We use a single shared counter keyed by '__all__' that TerminalWindow
        // reads alongside its per-session signal, so we don't need the full list here.
        next['__server_restart__'] = (next['__server_restart__'] || 0) + 1;
        return next;
      });
    };
    window.addEventListener('aw-server-reconnected', handler);
    return () => window.removeEventListener('aw-server-reconnected', handler);
  }, []);

  // Server-pushed "open this file in code-server" — handled identically
  // to Settings → Skills' button click. The aw-vscode MCP triggers the
  // POST /api/code-server/open with broadcast=true, awserv pushes a
  // vscode_open_request over /ws/status, useComponentStatus turns that
  // into the CustomEvent we're listening for here.
  //
  // Popup-blocker note: window.open() called from a WebSocket-driven
  // CustomEvent (no direct user gesture) will be blocked by Chrome /
  // Safari on FIRST use until the user explicitly clicks Allow on the
  // address-bar popup-blocked indicator. After that, AND if we always
  // use the same window name ('aw-vscode-file'), subsequent calls
  // re-use the existing window without triggering the blocker again.
  // The MCP tool result text mentions the direct URL as a fallback so
  // a blocked first-time popup is recoverable in one click.
  useEffect(() => {
    const handler = (e) => {
      const { url, popup_target, popup_features, container_path } = e.detail || {};
      if (!url) return;
      const win = window.open(
        url,
        popup_target || 'aw-vscode-file',
        popup_features || 'popup=1,width=1400,height=900',
      );
      if (!win) {
        console.warn(
          `[aw-vscode] Popup blocked for ${container_path || url}. ` +
          `Allow popups for this origin to enable auto-open.`
        );
      }
    };
    window.addEventListener('aw-vscode-open', handler);
    return () => window.removeEventListener('aw-vscode-open', handler);
  }, []);

  // Create any AI agent session by type — looks up command from aiAgents config.
  // If `resumeSessionId` is provided, the new terminal restores that on-disk
  // session via the CLI's resume flag (claude/copilot/cursor: `--resume <id>`,
  // codex: `codex resume <id>`). Otherwise a brand-new session is started.
  const createAgent = useCallback(async (agentType, resumeSessionId = null, resumeLabel = null) => {
    const agentDef = aiAgents.find(a => a.type === agentType);
    const label = agentDef?.label || agentType;
    let name, command;
    if (resumeSessionId) {
      name = resumeLabel
        ? (resumeLabel.length > 60 ? resumeLabel.slice(0, 57) + '…' : resumeLabel)
        : label;
      // Use the shared builder so resume flags stay consistent with the
      // in-window switcher and the insecure-toggle restart path.
      command = _buildAgentCommand(agentType, resumeSessionId, false, name);
    } else if (agentType === 'claude') {
      const sessionId = crypto.randomUUID();
      name = `${label} - ${sessionId.slice(-4)}`;
      command = `${agentDef?.command || 'claude'} --session-id ${sessionId} --dangerously-skip-permissions`;
    } else if (agentType === 'gemini') {
      // Pre-seed --session-id so the backend knows the UUID immediately
      // (no detection-thread delay) and the name suffix matches.
      const sessionId = crypto.randomUUID();
      name = `${label} - ${sessionId.slice(-4)}`;
      command = _buildAgentCommand('gemini', null, false, name, sessionId);
    } else {
      const sessionId = crypto.randomUUID();
      name = `${label} - ${sessionId.slice(-4)}`;
      command = agentDef?.command || agentType;
    }
    const res = await apiFetch(`${API_BASE}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, command, type: agentType }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      // 409: session is already open in another terminal — show notification.
      if (res.status === 409 && data.conflict) {
        window.dispatchEvent(new CustomEvent('aw-notification', {
          detail: { level: 'error', title: 'Session already open', message: data.error },
        }));
        return;
      }
      // Most common failure: the agent's CLI isn't installed (backend
      // pre-flight returns 400). Surface it instead of letting the click
      // look like a no-op.
      const msg = data.error || `Failed to start ${label}`;
      const hint = data.hint ? `\n\n${data.hint}` : '';
      // eslint-disable-next-line no-alert
      window.alert(`${msg}${hint}`);
      return;
    }
    setOpenWindows((prev) => { const next = new Set(prev); next.add(`terminal:${data.id}`); return next; });
    if (resumeSessionId) {
      setClaudeResumeMap((prev) => ({ ...prev, [data.id]: resumeSessionId }));
    }
    setView('home');
  }, [agentSessions, aiAgents]);

  const createClaudeWithPrompt = useCallback(async (initialPrompt, sessionName) => {
    const count = agentSessions.filter(t => t.type === 'claude').length + 1;
    const sessionId = crypto.randomUUID();
    const name = sessionName || `Claude Review ${count}`;
    const escapedPrompt = initialPrompt.replace(/"/g, '\\"');
    const res = await apiFetch(`${API_BASE}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        command: `claude --session-id ${sessionId} --dangerously-skip-permissions "${escapedPrompt}"`,
        type: 'claude',
      }),
    });
    const data = await res.json();
    setOpenWindows((prev) => { const next = new Set(prev); next.add(`terminal:${data.id}`); return next; });
    setView('home');
  }, [agentSessions]);

  const deleteAgent = useCallback(async (sessionId) => {
    await apiFetch(`${API_BASE}/api/terminals/${sessionId}`, { method: 'DELETE' });
    setOpenWindows((prev) => { const next = new Set(prev); next.delete(`terminal:${sessionId}`); return next; });
  }, []);

  const createStubborn = useCallback(async () => {
    const count = stubbornSessions.length + 1;
    const sessionId = crypto.randomUUID();
    const name = `Stubborn ${count}`;
    const res = await apiFetch(`${API_BASE}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, command: `claude --session-id ${sessionId} --dangerously-skip-permissions "/aw-persistent"`, type: 'stubborn' }),
    });
    const data = await res.json();
    setOpenWindows((prev) => {
      const next = new Set(prev);
      next.add(`terminal:${data.id}`);
      return next;
    });
    setView('home');
  }, [stubbornSessions]);

  const deleteStubborn = useCallback(async (sessionId) => {
    await apiFetch(`${API_BASE}/api/terminals/${sessionId}`, { method: 'DELETE' });
    setOpenWindows((prev) => {
      const next = new Set(prev);
      next.delete(`terminal:${sessionId}`);
      return next;
    });
  }, []);

  // insecureMap is populated on mount by the /api/terminals fetch (via applyTerminalUpdate)
  // and kept current by terminal_update broadcasts — no localStorage needed since
  // is_insecure is persisted in the agent_sessions DB table.
  const [insecureMap, setInsecureMap] = useState({});
  const [claudeResumeMap, setClaudeResumeMap] = useState({}); // ptySessionId -> claude conversation ID

  // One-shot cleanup of the now-retired model picker state. Safe to remove
  // after a release or two — keeps user localStorage tidy. Models are now
  // selected via the in-CLI `/model` slash command instead of an AW dropdown.
  useEffect(() => {
    try { localStorage.removeItem('aw-model-map'); } catch {}
  }, []);

  const _buildAgentCommand = (agentType, resumeSessionId, isInsecure, sessionName, preGeneratedId = null) => {
    if (agentType === 'claude') {
      let cmd = 'claude';
      if (resumeSessionId) {
        cmd += ` --resume ${resumeSessionId}`;
      } else {
        const newId = preGeneratedId || crypto.randomUUID();
        cmd += ` --session-id ${newId}`;
      }
      if (isInsecure) cmd += ' --dangerously-skip-permissions';
      return cmd;
    }
    if (agentType === 'copilot') {
      let cmd = 'copilot';
      if (resumeSessionId) cmd += ` --resume ${resumeSessionId}`;
      if (isInsecure) cmd += ' --allow-all';
      return cmd;
    }
    if (agentType === 'cursor') {
      let cmd = 'cursor-agent';
      if (resumeSessionId) cmd += ` --resume ${resumeSessionId}`;
      if (isInsecure) cmd += ' --approve-mcps --yolo';
      return cmd;
    }
    if (agentType === 'codex') {
      let cmd = 'codex';
      if (resumeSessionId) cmd += ` resume ${resumeSessionId}`;
      if (isInsecure) cmd += ' --dangerously-bypass-approvals-and-sandbox';
      return cmd;
    }
    if (agentType === 'gemini') {
      // Gemini accepts --resume <number|uuid|latest>. We always pass a UUID
      // (the sessionId from the picker) so the resume target is unambiguous
      // — index-based --resume is order-dependent and changes as sessions
      // are added. On fresh launches we pre-seed --session-id with a new
      // UUID so the resume-detect thread doesn't need to fish the id out of
      // the session-<ts>-<uuid-prefix>.jsonl filename later.
      let cmd = 'gemini';
      if (resumeSessionId) {
        cmd += ` --resume ${resumeSessionId}`;
      } else {
        const newId = preGeneratedId || crypto.randomUUID();
        cmd += ` --session-id ${newId}`;
      }
      if (isInsecure) cmd += ' --yolo';
      return cmd;
    }
    // Generic agent — use configured command
    const agentDef = aiAgents.find(a => a.type === agentType);
    return agentDef?.command || agentType;
  };

  // Determine agent type for a PTY session
  const _getAgentType = (ptySessionId) => {
    return agentSessions.find((t) => t.id === ptySessionId)?.type || 'claude';
  };

  const switchClaudeSession = useCallback(async (ptySessionId, agentSessionId, summary) => {
    const isInsecure = insecureMap[ptySessionId] || false;
    const agentType = _getAgentType(ptySessionId);
    const isNewSession = !agentSessionId;
    let newName, command;
    if (isNewSession) {
      // Pre-generate the UUID so the name can be derived from it.
      const newId = crypto.randomUUID();
      const agentLabel = (aiAgents.find(a => a.type === agentType)?.label) || agentType;
      newName = summary || `${agentLabel} - ${newId.slice(-4)}`;
      command = _buildAgentCommand(agentType, null, isInsecure, newName, newId);
    } else {
      newName = summary || 'Session';
      command = _buildAgentCommand(agentType, agentSessionId, isInsecure, newName);
    }
    // Optimistic update — revert below on conflict
    const prevResumeMap = claudeResumeMap;
    setClaudeResumeMap((prev) => ({ ...prev, [ptySessionId]: agentSessionId }));
    const res = await apiFetch(`${API_BASE}/api/terminals/${ptySessionId}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, name: newName, new_session: isNewSession }),
    });
    if (res && !res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.conflict) {
        window.dispatchEvent(new CustomEvent('aw-notification', {
          detail: { level: 'error', title: 'Session already open', message: data.error },
        }));
        // Revert the optimistic claudeResumeMap update
        setClaudeResumeMap(prevResumeMap);
        return;
      }
    }
    setAgentSessions((prev) => prev.map((t) => t.id === ptySessionId ? { ...t, name: newName } : t));
  }, [insecureMap, agentSessions, claudeResumeMap, aiAgents]);

  const toggleInsecure = useCallback(async (ptySessionId, newInsecure) => {
    setInsecureMap((prev) => ({ ...prev, [ptySessionId]: newInsecure }));
    const agentType = _getAgentType(ptySessionId);
    const session = agentSessions.find((t) => t.id === ptySessionId);
    // Authoritative resume ID: prefer the user's last explicit session switch
    // (claudeResumeMap), fall back to the server-reported agent_session_id
    // from agentSessions.  Without this fallback, claudeResumeMap[ptySessionId]
    // can be undefined when detection hasn't run yet, causing _buildAgentCommand
    // to generate a new random --session-id — which creates a fresh Claude session
    // instead of preserving the current one (root cause of "Claude 3" accumulation).
    const resumeId = claudeResumeMap[ptySessionId] ?? session?.agent_session_id ?? null;

    let body;
    if (resumeId) {
      // Known session: build an explicit resume command with the new insecure flag.
      const command = _buildAgentCommand(agentType, resumeId, newInsecure);
      body = { command, name: session?.name };
    } else {
      // Detection still pending: send the is_insecure flag without a command so
      // the backend reconstructs the resume from the stored agent_session_id.
      // If the backend also has no agent_session_id yet (session <1 s old), it
      // falls back to old.command which preserves whatever the terminal was running.
      body = { is_insecure: newInsecure, name: session?.name };
    }

    const res = await apiFetch(`${API_BASE}/api/terminals/${ptySessionId}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res && !res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.conflict) {
        window.dispatchEvent(new CustomEvent('aw-notification', {
          detail: { level: 'error', title: 'Session conflict', message: data.error },
        }));
        // Revert the optimistic insecure toggle since restart failed
        setInsecureMap((prev) => ({ ...prev, [ptySessionId]: !newInsecure }));
      }
    }
  }, [agentSessions, claudeResumeMap]);

  // Derived per-type sets — WindowManager/TerminalWindow use these for specific UI features
  const claudeSessionIds = new Set(agentSessions.filter(t => t.type === 'claude').map((t) => t.id));
  const copilotSessionIds = new Set(agentSessions.filter(t => t.type === 'copilot').map((t) => t.id));

  // Voice: check if focused window is a Claude terminal
  const focusedClaudeSessionId = focusedWindowKey?.startsWith('terminal:')
    ? (claudeSessionIds.has(focusedWindowKey.replace('terminal:', '')) ? focusedWindowKey.replace('terminal:', '') : null)
    : null;
  const micEnabled = !!focusedClaudeSessionId;

  // ── Remote camera stream ─────────────────────────────────────────────────
  // Streams the browser webcam via WebSocket JPEG frames to the server.
  // The server exposes /api/camera/stream (MJPEG) and optionally writes
  // to /dev/video10 via v4l2loopback (set up by tools/webcam/setup_host.sh on the host).
  const [cameraActive, setCameraActive] = useState(false);
  const cameraRef = useRef(null); // { stream, ws, video, presentation, interval }

  const toggleCamera = useCallback(async () => {
    if (cameraActive) {
      const cam = cameraRef.current;
      if (cam) {
        clearInterval(cam.interval);
        try { cam.ws?.close(); } catch {}
        cam.stream?.getTracks().forEach(t => t.stop());
        cameraRef.current = null;
      }
      setCameraActive(false);
      apiFetch('/api/camera/stop', { method: 'POST' }).catch(() => {});
    } else {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
          audio: false,
        });
      } catch (err) {
        window.alert(`Camera access denied or unavailable.\n${err.message}`);
        return;
      }
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      try { await video.play(); } catch {}

      let canvas, ctx;
      try {
        canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D canvas context unavailable');
      } catch (err) {
        stream.getTracks().forEach(t => t.stop());
        window.alert(`Camera setup failed.\n${err.message}`);
        return;
      }

      const ws = new WebSocket(wsUrl('/ws/camera'));
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        let sending = false;
        const interval = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN || sending) return;
          sending = true;
          try {
            ctx.drawImage(video, 0, 0, 640, 480);
            canvas.toBlob(blob => {
              sending = false;
              if (!blob || ws.readyState !== WebSocket.OPEN) return;
              ws.send(blob);
            }, 'image/jpeg', 0.75);
          } catch { sending = false; }
        }, 1000 / 15);
        cameraRef.current = { stream, ws, video, canvas, interval };
        setCameraActive(true);
        apiFetch('/api/camera/start-v4l2', { method: 'POST' }).catch(() => {});
      };
      ws.onclose = () => {
        if (cameraRef.current) {
          clearInterval(cameraRef.current.interval);
          cameraRef.current.stream?.getTracks().forEach(t => t.stop());
          cameraRef.current = null;
        }
        setCameraActive(false);
      };
      ws.onerror = () => ws.close();
    }
  }, [cameraActive]);

  const sendVoiceToTerminal = useCallback((text) => {
    if (!focusedClaudeSessionId) return;
    apiFetch(`${API_BASE}/api/terminals/${focusedClaudeSessionId}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text + '\r' }),
    });
  }, [focusedClaudeSessionId]);
  sendVoiceRef.current = sendVoiceToTerminal;

  const startListening = useCallback(() => {
    try { recognitionRef.current?.start(); } catch {}
  }, []);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
  }, []);

  // Cmd+1 push-to-talk: hold Cmd+1 to record, release either key to stop
  const pttActiveRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '1' && !e.repeat && !pttActiveRef.current) {
        e.preventDefault();
        pttActiveRef.current = true;
        startListening();
      }
    };
    const onKeyUp = (e) => {
      if (pttActiveRef.current && (e.key === '1' || e.key === 'Meta' || e.key === 'Control')) {
        pttActiveRef.current = false;
        stopListening();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [startListening, stopListening]);

  const hasWindows = openWindows.size > 0;

  // Workspace > Tasks: open the Tasks floating window in the home view.
  // Mirrors the Debugger pattern — no separate top-level view, just a
  // draggable panel managed by WindowManager.
  const openTasksPanel = useCallback(() => {
    const key = 'panel:tasks';
    setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
    setView('home');
    setFocusedWindowKey(key);
    // Bump the focus trigger so a click on Workspace > Tasks raises
    // the panel even when it's already open behind another window.
    setTasksPanelFocusTrigger((n) => n + 1);
  }, []);
  // Expose as a global so TopNotifications (task-completion cards) can
  // open the panel without prop drilling. Mirrors __awOpenTerminal /
  // __awOpenPresentation already set up elsewhere in this file.
  useEffect(() => {
    window.__awOpenTasksPanel = openTasksPanel;
    return () => { delete window.__awOpenTasksPanel; };
  }, [openTasksPanel]);

  // Workspace > Plans: open the Plans floating window. Mirrors the
  // Tasks/Debugger pattern — no separate top-level view, just a
  // draggable panel managed by WindowManager. PlansPanel itself owns
  // the agent picker, flow picker, and embedded terminal.
  const openPlansPanel = useCallback(() => {
    const key = 'panel:plans';
    setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
    setView('home');
    setFocusedWindowKey(key);
    // Bump the focus trigger so a click on Workspace > Plans raises
    // the panel even when it's already open behind another window.
    setPlansPanelFocusTrigger((n) => n + 1);
  }, []);

  // Workspace > Tests: open the Architecture Namespace traceability matrix
  // as a floating window (mirrors Plans/Knowledge Base). TestsPanel itself
  // owns the fetch against GET /api/architecture/matrix.
  const openTestsPanel = useCallback(() => {
    const key = 'panel:tests';
    setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
    setView('home');
    setFocusedWindowKey(key);
    setTestsPanelFocusTrigger((n) => n + 1);
  }, []);

  // Workspace > Settings: open as a floating window (mirrors Knowledge Base/Tasks).
  const openSettingsPanel = useCallback(() => {
    const key = 'panel:settings';
    setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
    setView('home');
    setFocusedWindowKey(key);
    setSettingsPanelFocusTrigger((n) => n + 1);
  }, []);

  // Workspace > Knowledge Base: open as a floating window (mirrors Tasks/Plans).
  const openKnowledgeBasePanel = useCallback(() => {
    const key = 'panel:knowledge-base';
    setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
    setView('home');
    setFocusedWindowKey(key);
    setKnowledgeBaseFocusTrigger((n) => n + 1);
  }, []);

  // Workspace > Whiteboard: open the persistent whiteboard as a floating
  // window (mirrors Tasks/Plans). The panel embeds the live viewer, which
  // owns the /ws/whiteboard subscription and reloads on every update.
  const openWhiteboardPanel = useCallback(() => {
    const key = 'panel:whiteboard';
    setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
    setView('home');
    setFocusedWindowKey(key);
    setWhiteboardPanelFocusTrigger((n) => n + 1);
  }, []);

  // Workspace > Remote Desktop: open the VNC client window (mirrors
  // Whiteboard) — RemoteDesktopWindow owns connection selection/management.
  const openRemoteDesktopPanel = useCallback(() => {
    const key = 'panel:remote-desktop';
    setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
    setView('home');
    setFocusedWindowKey(key);
    setRemoteDesktopFocusTrigger((n) => n + 1);
  }, []);

  // Workspace > Debugger: open the debugger window, auto-start dap-server
  // if it isn't running, then push focus.
  const openDebugger = useCallback(async () => {
    const key = 'debugger:dap';
    setOpenWindows((prev) => { const next = new Set(prev); next.add(key); return next; });
    setView('home');
    setFocusedWindowKey(key);
    const dap = components.find((c) => c.key === 'dap-server');
    if (dap && dap.status !== 'running' && dap.status !== 'boot') {
      await startComponent('dap-server');
      refetch();
    }
    setDebuggerFocusTrigger((n) => n + 1);
  }, [components, refetch]);

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-primary)]">
      {/* Claude prompt notifications — floating top-right */}
      <ErrorBoundary label="Notifications" silent>
        <PromptNotifications terminals={terminals} />
      </ErrorBoundary>
      {/* Generic notification stack (task completions, GitHub PR events, etc.) */}
      <ErrorBoundary label="Notifications" silent>
        <TopNotifications />
      </ErrorBoundary>

      {/* Top bar */}
      {/* relative z-[9990]: keeps the top bar and its dropdown menus (Workspace,
          Presentation, Agents, Apps) above open windows — a maximized window is
          zIndex 9000, so the menus need to sit higher, while staying below the
          9998/9999 notification + modal overlays. */}
      <div className="relative z-[9990] flex items-center px-3 py-1.5 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-4 shrink-0">
          {/* Logo — "❯ aw" wordmark (Direção B: Signal Amber identity). */}
          <div className="flex items-center gap-1 shrink-0">
            <svg width="72" height="21" viewBox="0 0 240 70" className="shrink-0" style={{ marginTop: 3 }}>
              <text x="0" y="50" fontFamily="ui-monospace, Menlo, monospace" fontSize="46" fontWeight="700" fill="var(--color-accent)">&#10095;</text>
              <text x="44" y="50" fontFamily="Inter" fontSize="46" fontWeight="800" fill="var(--color-text-primary)" letterSpacing="-1">aw</text>
            </svg>
          </div>

          {/* Navigation tabs */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView('home')}
              className={`px-3 py-1 text-xs rounded transition-colors cursor-pointer ${view === 'home'
                ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5'}`}
            >
              Home
            </button>
            <ErrorBoundary label="Agents">
            <AgentsNav
              aiAgents={aiAgents}
              agentSessions={agentSessions}
              terminals={terminals}
              agentSessionsMap={agentSessionsMap}
              onAgentSessionsCached={(type, sessions) =>
                setAgentSessionsMap((prev) => ({ ...prev, [type]: sessions }))
              }
              onCreateAgent={createAgent}
              onCreateTerminal={createTerminal}
              onToggleAgent={toggleTerminal}
              onCloseAgent={deleteAgent}
              onToggleTerminal={toggleTerminal}
              onCloseTerminal={deleteTerminal}
            />
            </ErrorBoundary>
            <ErrorBoundary label="Presentations">
            <PresentationNav
              presentations={presentations}
              onSelectPresentation={(id) => {
                setView('home');
                togglePresentation(id);
              }}
              onDeletePresentation={deletePresentation}
            />
            </ErrorBoundary>
            <ErrorBoundary label="Workspace">
            <WorkspaceNav
              setView={setView}
              components={components}
              openWindows={openWindows}
              onToggleWindow={toggleWindow}
              onAction={refetch}
              onOpenSettings={openSettingsPanel}
              onOpenDebugger={openDebugger}
              onOpenTasks={openTasksPanel}
              onOpenPlans={openPlansPanel}
              onOpenTests={openTestsPanel}
              onOpenKnowledgeBase={openKnowledgeBasePanel}
              onOpenWhiteboard={openWhiteboardPanel}
              onOpenRemoteDesktop={openRemoteDesktopPanel}
              debugStopped={debugStopped}
              debugStoppedService={debugStoppedService}
              workspaceApps={enabledApps}
              onOpenApp={openApp}
            />
            </ErrorBoundary>
            {/* Apps menu — popover next to Workspace. Lists every
                workspace_apps entry whose `menu` is "apps". */}
            <ErrorBoundary label="Apps">
            <AppsNav
              workspaceApps={enabledApps}
              components={components}
              onOpenApp={openApp}
              onOpenInstalledApp={openInstalledApp}
            />
            </ErrorBoundary>
            {/* Decoupled-apps (F6 Cap 2): nav entries registered by installed
                apps into the core.nav slot render here. Empty until an app
                contributes → no visual change. */}
            <ErrorBoundary label="AppNav" silent>
              <AppSlot slot="core.nav" />
            </ErrorBoundary>
            {/* Legacy: dynamic top-bar buttons for workspace_apps with menu: "top".
                Kept for back-compat with configs that still use the old slot — new
                apps should set menu: "apps" and live inside the Apps popover. */}
            {enabledApps
              .filter((a) => a.menu === 'top')
              .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
              .map((app) => {
                const compStatus = app.component
                  ? (components.find((c) => c.key === app.component)?.status || 'off')
                  : null;
                return (
                  <button
                    key={app.id}
                    onClick={() => openApp(app.id)}
                    className="px-3 py-1 text-xs rounded transition-colors cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5 inline-flex items-center gap-1.5"
                    title={`${app.label}${compStatus ? ` · ${compStatus}` : ''}`}
                  >
                    {compStatus && <StatusDot status={compStatus} size="sm" />}
                    {app.label}
                  </button>
                );
              })
            }
          </div>
        </div>

        {/* Ninja patrol zone — fills all space between Desktop and Log Out */}
        {/* <div ref={ninjaSpaceRef} className="flex-1 min-w-0 mx-3 self-center" style={{ height: 20 }}>
          {ninjaWidth >= 50 && (
            <NinjaBuddy width={ninjaWidth} height={20} offset={0} />
          )}
        </div> */}
        <div className="flex-1 min-w-0 mx-3 self-center" style={{ height: 20 }} />

        <div className="flex items-center gap-4 shrink-0">
          {/* Virtual keyboard + trackpad overlay.  Shown on phone-sized
              devices in desktop layout — replaces the native iOS keyboard
              so the cursor can reach every part of the desktop UI. */}
          {showPhoneTools && (
            <button
              onClick={() => setVirtualKbdOpen(toggleVirtualKeyboardTrackpad())}
              className={`p-1.5 rounded transition-colors ${
                virtualKbdOpen
                  ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                  : 'hover:bg-white/10 text-[var(--color-text-muted)]'
              }`}
              title={virtualKbdOpen ? 'Hide virtual keyboard and trackpad' : 'Show virtual keyboard and trackpad'}
              aria-label={virtualKbdOpen ? 'Hide virtual keyboard and trackpad' : 'Show virtual keyboard and trackpad'}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01" />
                <path d="M6 13h.01M10 13h.01M14 13h.01" />
                <path d="M8 17h8" />
              </svg>
            </button>
          )}
          {/* Desktop-on-phone viewport width picker.  Only shown on
              phone-sized devices when the user has forced #desktop
              layout — bumps the layout viewport so the desktop UI
              shrinks to a usable size on the phone and looks full-size
              when mirrored to a TV. */}
          {showWidthPicker && (
            <select
              value={desktopWidth}
              onChange={(e) => {
                const w = e.target.value;
                setDesktopWidth(w);
                setDesktopWidthState(w);
              }}
              className="bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded text-[10px] px-1.5 py-1 hover:bg-white/5 focus:outline-none focus:border-[var(--color-accent)]"
              title="Layout viewport width (desktop layout on phone)"
            >
              {WIDTH_OPTIONS.map((w) => (
                <option key={w} value={w}>{w === 'device' ? 'device' : w + 'px'}</option>
              ))}
            </select>
          )}
          {/* Soft-keyboard suppression toggle.  When on, every xterm
              helper textarea gets `inputmode="none"` — iOS hides the
              on-screen keyboard while still delivering hardware
              keystrokes from an external/Bluetooth keyboard.  State
              persists in localStorage (aw_suppress_kbd).  Hidden in
              PWA standalone mode (PWA users don't want dev dials). */}
          {showKbdToggle && (
          <button
            onClick={() => setSuppressKbd(!suppressKbd)}
            className={`p-1.5 rounded transition-colors ${
              suppressKbd
                ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                : 'hover:bg-white/10 text-[var(--color-text-muted)]'
            }`}
            title={suppressKbd ? 'On-screen keyboard hidden — tap to allow' : 'Hide on-screen keyboard (for external keyboards)'}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M8 14h8" />
              {suppressKbd && <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />}
            </svg>
          </button>
          )}
          {/* Mic button — push-to-talk for Claude */}
          {view === 'home' && (
            <button
              onMouseDown={micEnabled ? startListening : undefined}
              onMouseUp={micEnabled ? stopListening : undefined}
              onTouchStart={micEnabled ? startListening : undefined}
              onTouchEnd={micEnabled ? stopListening : undefined}
              disabled={!micEnabled}
              className={`p-1.5 rounded transition-colors ${isListening
                ? 'bg-[var(--color-danger)]/20 text-[var(--color-danger)]'
                : micEnabled
                  ? 'hover:bg-white/10 text-[var(--color-text-muted)]'
                  : 'text-[var(--color-text-muted)]/30 cursor-not-allowed'}`}
              title={micEnabled ? 'Hold to dictate to Claude' : 'Select a Claude terminal to enable voice'}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            </button>
          )}
          {/* Camera button — stream webcam to server (/dev/video10 + MJPEG) */}
          <button
            onClick={toggleCamera}
            className={`p-1.5 rounded transition-colors ${
              cameraActive
                ? 'bg-[var(--color-status-running)]/20 text-[var(--color-status-running)]'
                : 'hover:bg-white/10 text-[var(--color-text-muted)]'
            }`}
            title={cameraActive ? 'Stop camera stream  ·  preview: /api/camera/stream' : 'Stream webcam to server  ·  preview: /api/camera/stream'}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
              {cameraActive && <circle cx="12" cy="13" r="2" fill="currentColor" stroke="none"/>}
            </svg>
          </button>

          {/* Layout buttons — only on Home */}
          {view === 'home' && hasWindows && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => applyLayout('horizontal')}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                title="Side by side"
              >
                <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="9" height="18" rx="1" />
                  <rect x="13" y="3" width="9" height="18" rx="1" />
                </svg>
              </button>
              <button
                onClick={() => applyLayout('vertical')}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                title="Stacked"
              >
                <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="2" width="18" height="9" rx="1" />
                  <rect x="3" y="13" width="18" height="9" rx="1" />
                </svg>
              </button>
              <button
                onClick={() => applyLayout('grid')}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                title="Grid"
              >
                <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="9" height="9" rx="1" />
                  <rect x="13" y="2" width="9" height="9" rx="1" />
                  <rect x="2" y="13" width="9" height="9" rx="1" />
                  <rect x="13" y="13" width="9" height="9" rx="1" />
                </svg>
              </button>
            </div>
          )}

          {/* VPN — shield icon, hover for status / connect / disconnect */}
          <ErrorBoundary label="VPN">
            <VpnNav />
          </ErrorBoundary>

          {/* Profile — top-right icon opening the account drawer (Console,
              Settings, Notifications). Replaces the standalone bell; the
              unread badge now lives here. Kept last so the slide-in panel
              anchored to the right edge sits naturally under it. */}
          <button
            onClick={() => {
              setProfileDrawerOpen((p) => {
                if (!p) {
                  apiFetch(`${API_BASE}/api/notify/recent?limit=100`).then(r => r.json()).then(d => {
                    setNotifHistory(d.notifications || []);
                  }).catch(() => {});
                  setNotifUnreadCount(0);
                }
                return !p;
              });
            }}
            className={`relative p-1.5 rounded transition-colors hover:bg-white/10 cursor-pointer before:content-[''] before:absolute before:inset-[-8px] ${profileDrawerOpen ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
            title="Profile"
            aria-label={notifUnreadCount > 0 ? `Profile — ${notifUnreadCount} unread notification${notifUnreadCount === 1 ? '' : 's'}` : 'Profile'}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
            </svg>
            {notifUnreadCount > 0 && (
              <span
                className="absolute top-1 right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-[var(--color-danger)] text-white text-[9px] font-bold leading-[14px] text-center"
                aria-hidden="true"
              >
                {notifUnreadCount > 9 ? '9+' : notifUnreadCount}
              </span>
            )}
          </button>

        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <WindowManager
            openWindows={openWindows}
            components={components}
            aiAgents={aiAgents}
            terminals={[...terminals, ...agentSessions, ...stubbornSessions]}
            maxLines={maxLines}
            onCloseWindow={closeWindow}
            onReopenWindow={toggleWindow}
            onMinimizeWindow={minimizeWindow}
            onMaximize={maximizeWindow}
            maximizedKey={maximizedKey}
            onAction={refetch}
            onRenameTerminal={renameTerminal}
            onSessionSwitch={switchClaudeSession}
            resumeMap={claudeResumeMap}
            insecureMap={insecureMap}
            onToggleInsecure={toggleInsecure}
            onWindowFocus={setFocusedWindowKey}
            focusTrigger={presentationFocusTrigger}
            workspaceApps={workspaceApps}
            focusTriggers={[
              { key: 'debugger:dap', counter: debuggerFocusTrigger },
              { key: 'panel:settings', counter: settingsPanelFocusTrigger },
              { key: 'panel:tasks', counter: tasksPanelFocusTrigger },
              { key: 'panel:plans', counter: plansPanelFocusTrigger },
              { key: 'panel:tests', counter: testsPanelFocusTrigger },
              { key: 'panel:knowledge-base', counter: knowledgeBaseFocusTrigger },
              { key: 'panel:whiteboard', counter: whiteboardPanelFocusTrigger },
              { key: 'panel:remote-desktop', counter: remoteDesktopFocusTrigger },
              ...Object.entries(appFocusTriggers).map(([id, counter]) => ({
                key: `app:${id}`,
                counter,
              })),
            ]}
            presentations={presentations}
            onRenamePresentation={renamePresentation}
            onDeletePresentation={deletePresentation}
            diffs={diffs}
            layout={layout}
            layoutTrigger={layoutTrigger}
            terminalReconnectSignals={terminalReconnectSignals}
            appWindowSpecs={appWindowSpecs}
          />
        </div>
      </div>

      {/* Profile drawer — slides in from right. Console + Settings actions
          on top, Notifications (moved from the old standalone bell) below. */}
      <div
        className="fixed top-0 right-0 bottom-0 w-96 bg-[var(--color-bg-sidebar)] border-l border-[var(--color-border)] z-[9998] flex flex-col shadow-2xl transition-transform duration-300"
        style={{ transform: profileDrawerOpen ? 'translateX(0)' : 'translateX(100%)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
            </svg>
            <span className="text-sm font-bold text-[var(--color-text-primary)]">Profile</span>
          </div>
          <button
            onClick={() => setProfileDrawerOpen(false)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-white/10"
            title="Close"
            aria-label="Close profile drawer"
          >
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex flex-col gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <a
            href="https://console.aw.tekflox.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 min-h-[44px] px-3 rounded text-sm text-[var(--color-text-primary)] hover:bg-white/10 transition-colors"
            aria-label="Open Console (account admin) in a new tab"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
            Console
          </a>
          <button
            onClick={() => { openSettingsPanel(); setProfileDrawerOpen(false); }}
            className="flex items-center gap-2 min-h-[44px] px-3 rounded text-sm text-[var(--color-text-primary)] hover:bg-white/10 transition-colors text-left"
            aria-label="Open Settings"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
            Settings
          </button>
          <button
            onClick={async () => {
              setProfileDrawerOpen(false);
              await logout();
              window.location.reload();
            }}
            className="flex items-center gap-2 min-h-[44px] px-3 rounded text-sm text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-white/10 transition-colors text-left"
            aria-label="Log out"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>
            </svg>
            Log Out
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)]">
          <svg className="w-4 h-4 text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Notifications</span>
          <span className="text-[10px] text-[var(--color-text-muted)]">{notifHistory.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {notifHistory.length === 0 && (
            <div className="p-6 text-center text-[var(--color-text-muted)] text-sm">No notifications yet</div>
          )}
          {notifHistory.map((n) => {
            const levelColors = {
              info: 'border-l-indigo-500',
              success: 'border-l-green-500',
              warning: 'border-l-amber-500',
              error: 'border-l-red-500',
            };
            const ts = n.created_at || n.timestamp;
            const timeStr = ts ? new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
            const isSuperseded = n.status === 'superseded';
            return (
              <div key={n.id} className={`border-l-2 ${levelColors[n.level] || levelColors.info} ${isSuperseded ? 'opacity-40' : ''} px-4 py-3 border-b border-[var(--color-border)] hover:bg-white/[0.03] transition-colors`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {n.title && <div className="text-[11px] font-bold text-[var(--color-text-primary)] mb-0.5">{n.title}</div>}
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noopener noreferrer"
                        className="text-[12px] text-[#93c5fd] hover:underline block whitespace-pre-line leading-tight">
                        {n.message}
                      </a>
                    ) : (
                      <div className="text-[12px] text-[var(--color-text-secondary)] whitespace-pre-line leading-tight">{n.message}</div>
                    )}
                  </div>
                  {n.source && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase shrink-0 ${
                      n.source === 'github' ? 'bg-purple-500/15 text-purple-400' :
                      'bg-gray-500/15 text-gray-400'
                    }`}>{n.source}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] text-[var(--color-text-muted)]">{timeStr}</span>
                  {isSuperseded && <span className="text-[9px] text-[var(--color-text-muted)] italic">superseded</span>}
                  {n.status === 'read' && <span className="text-[9px] text-[var(--color-text-muted)]">read</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Backdrop */}
      {profileDrawerOpen && <div className="fixed inset-0 z-[9997]" onClick={() => setProfileDrawerOpen(false)} />}

    </div>
  );
}

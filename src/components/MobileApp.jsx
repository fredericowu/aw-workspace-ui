import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useComponentStatus, getAwConfig, startComponent } from '../hooks/useComponentStatus';
import { asArray } from '../lib/asArray';
import { installAppIframeKbdSync, postSuppressState } from '../lib/appIframeKbd';
import { getSuppressKbd } from '../lib/keyboardMode';
import { GITHUB_PRS_PATH } from '../lib/githubApi';
import { apiFetch, wsUrl, notifyWsAuthFailed } from '../auth';
import { createSharedSocket } from '../hooks/useSharedSocket';
import LogWindow from './LogWindow';
import TerminalWindow from './TerminalWindow';
import AppSlot from '../apps/AppSlot';
import { windowBodySlot, windowTitlebarSlot } from '../apps/slotRegistry';
import { usePluginContributions } from '../apps/usePluginContributions';
import { listInstalledApps, fetchContributions } from '../apps/appsApi';
import { appChrome, defaultLaunchWindow } from '../apps/appWindowChrome';
import { appWindowKey } from '../apps/appWindowKeys';
import AppWindowBody from './AppWindowBody';
import DockerControls from './DockerControls';
import SettingsPanel from './SettingsPanel';
import SettingsPanelNew from './SettingsPanelNew';
import StatusDot from './StatusDot';
import TerminalKeyboard from './TerminalKeyboard';
import {
  buildAgentCommand as buildDecoupledAgentCommand,
  buildAntigravityCommand,
  supportsInsecureMode,
  withAntigravityAgent,
} from '../lib/agentClis';

const API_BASE = '';
// NOTE: any category not listed here is silently dropped from the mobile
// Components list (grouped[cat] is only ever rendered for keys in this
// array — pre-existing behavior, not something this change introduces).
// 'Tools'/'Docker'/'Apps' were already invisible on mobile before this;
// 'Service' is added so the (re-categorized) proxy component doesn't
// regress further, but the broader mobile-parity gap is out of scope here.
const CATEGORY_ORDER = ['Platform', 'APIs', 'Service'];

// Preset resolutions for the iframe-app resolution picker.
// "Auto" (null) fills the available viewport; the others render the
// iframe at the given pixel dimensions and scale it to fit so the
// remote app (VNC, VSCode, etc.) thinks it is running at that size.
const RESOLUTIONS = [
  { label: 'Auto',      w: null, h: null },
  { label: '1280×720',  w: 1280, h: 720  },
  { label: '1920×1080', w: 1920, h: 1080 },
  { label: '2560×1440', w: 2560, h: 1440 },
];

// Icons
const IconPlus = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const IconClaude = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/></svg>;
const IconTerminal = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;
const IconPresentation = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>;
const IconDots = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>;
const IconChevron = ({ open }) => (
  <svg
    width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 120ms' }}
  >
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);
const IconSearch = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IconGear = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/></svg>;
const IconRepos = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg>;
const IconTasksClock = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const IconPlay = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;


export default function MobileApp() {
  // Boot the decoupled-apps plugin runtime for this shell. Without this NO
  // app bundle is ever fetched on mobile, so every `core.window.body:<id>`
  // AppSlot below (presentations.viewer, diff-tool.viewer) resolves to zero
  // contributions and paints an empty window — App() returns either this
  // component or AuthenticatedApp, never both, and the bootstrap used to live
  // only in the latter.
  //
  // No `onOpenWindow`: this shell drives its single active window off each
  // app's own WebSocket (see the presentation/diff effects below) and does not
  // render the `core.nav` slot, so no declarative nav entry can call it here.
  // No `onFirstLoad`: window rehydration is desktop-only (localStorage
  // openWindows / WindowManager), which mobile has no equivalent of.
  //
  // Its return ref is deliberately discarded — the Apps section below needs
  // the live contributions payload too, but as reactive state (so a render
  // picks up a fresh fetch), not a ref read synchronously during render.
  // See the `contributions` state below, fetched independently. Do NOT call
  // usePluginContributions() a second time anywhere else in this component:
  // its `activeWirings` guard turns a second call into a warned no-op.
  usePluginContributions();

  const { components, refetch } = useComponentStatus();
  // menuOpen removed — hamburger menu removed, dashboard shows everything
  const [activeWindow, setActiveWindow] = useState(null);
  // Native app embed mode (aw-meta-display iOS WorkspaceAppsView): hides
  // the iframe-app toolbar below (title/resolution picker/refresh/open-in-
  // new-tab/Back) since the native chrome provides its own Back +
  // Fullscreen buttons instead — see window.__awMobileBridge below, which
  // is how those native buttons reach into this SPA's state.
  const hideTopChrome = useMemo(
    () => new URLSearchParams(window.location.search).get('hide_top') === 'true',
    []
  );
  // Modal overlay — renders on top of everything (dashboard stays mounted
  // underneath so its scroll position is preserved when the modal closes).
  // Each entry is { title: string, content: ReactNode }.
  const [mobileModal, setMobileModal] = useState(null);
  const openModal = useCallback((title, content) => setMobileModal({ title, content }), []);
  const closeModal = useCallback(() => setMobileModal(null), []);
  const previousWindowRef = useRef(null);
  const [terminalRemountKey, setTerminalRemountKey] = useState(0);
  // Reported by <TerminalKeyboard /> via onHeightChange — used as
  // padding-bottom on the terminal content area so the terminal
  // shrinks to make room for the expanded keyboard instead of
  // being overlapped by it.  Zero when the keyboard is collapsed
  // (FAB only) or no terminal is active.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const sessionPickerRef = useRef(null);

  // iframe-app resolution picker state.
  // `iframeResolution` is { w, h } | null (null = auto / fill viewport).
  // `iframeScale` is computed from the container size vs the target
  // resolution and applied via CSS transform so the iframe content
  // renders at the chosen virtual resolution without reloading.
  const [iframeResolution, setIframeResolution] = useState(null);
  const [resPickerOpen, setResPickerOpen] = useState(false);
  const iframeContainerRef = useRef(null);
  const iframeRef = useRef(null);
  const [iframeScale, setIframeScale] = useState(1);

  // Track previous window so presentation close returns to terminal
  const openWindowWithHistory = useCallback((type, key, extra) => {
    if (activeWindow) previousWindowRef.current = activeWindow;
    setActiveWindow({ type, key, ...extra });
    setSessionPickerOpen(false);
  }, [activeWindow]);

  const refreshIframe = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  }, []);

  // Keep a Tier-2 app iframe in step with the "suppress on-screen keyboard"
  // toggle. Those iframes are cross-origin (`<app-id>.app.<apex>` vs this
  // shell at `<apex>`), so we cannot suppress anything inside them ourselves —
  // we can only tell a cooperating app what the toggle says and let it apply
  // its own suppressor. See lib/appIframeKbd.js.
  //
  // Three legs, all three needed: the iframe's `onLoad` below, the app's
  // inbound hello (handled here), and every toggle change.
  useEffect(() => installAppIframeKbdSync(() => iframeRef.current), []);

  // The load leg. Kept as a named callback rather than inline so the two
  // send paths (load and hello) read as the one contract they are.
  const onAppIframeLoad = useCallback(() => {
    postSuppressState(iframeRef.current, getSuppressKbd());
  }, []);

  const closeActiveWindow = useCallback(() => {
    setSessionPickerOpen(false);
    const wasIframeApp = activeWindow?.type === 'iframe-app';
    if (activeWindow?.type === 'presentation' && previousWindowRef.current) {
      setActiveWindow(previousWindowRef.current);
      previousWindowRef.current = null;
    } else {
      setActiveWindow(null);
      previousWindowRef.current = null;
    }
    // Restore browser title and URL when leaving an iframe-app so the
    // dashboard hash (#mobile) is canonical again.
    if (wasIframeApp) {
      document.title = 'AW';
      window.history.replaceState(null, '', '/#mobile');
    }
  }, [activeWindow]); // { type: 'log'|'terminal'|'presentation', key, id?, name? }

  // Native embed bridge (aw-meta-display iOS) — only wired up when
  // hide_top hid the in-app toolbar, so the native Back/Fullscreen
  // buttons have something to call into. getActiveUrl lets native
  // present a truly chrome-free fullscreen cover of the raw app URL.
  useEffect(() => {
    if (!hideTopChrome) return undefined;
    window.__awMobileBridge = {
      back: closeActiveWindow,
      getActiveUrl: () => (activeWindow?.type === 'iframe-app' ? activeWindow.url : null),
    };
    return () => { delete window.__awMobileBridge; };
  }, [hideTopChrome, activeWindow, closeActiveWindow]);

  // Terminals + agent sessions.
  // `agentSessions` covers ALL CLI/agent terminals (Claude, Copilot,
  // Codex, future ones) — previously this was hardcoded to "claude
  // only", which left users on mobile unable to start Copilot or Codex
  // sessions even though the backend supported them.
  const [terminals, setTerminals] = useState([]);
  const [agentSessions, setAgentSessions] = useState([]);

  // Available agent CLIs — read from aw config so it stays in lockstep
  // with the desktop launcher and the Tasks tab.  Defaults match the
  // desktop App.jsx defaults so the UI works even if the config call
  // hasn't returned yet.
  const [aiAgents, setAiAgents] = useState(withAntigravityAgent([
    { type: 'claude',  label: 'Claude',  command: 'claude',  color: '#d97706' },
    { type: 'copilot', label: 'Copilot', command: 'copilot', color: '#2ea043' },
    { type: 'codex',   label: 'Codex',   command: 'codex',   color: '#0ea5e9' },
  ]));
  // useMemo, not a plain map: a fresh array identity on every render made
  // applyTerminalUpdate's useCallback dep churn every render too, which
  // re-fired its effect, fetched, always set a fresh object, re-rendered,
  // and repeated — an unbounded ~9-15 req/s self-sustaining loop with no
  // setInterval anywhere. App.jsx's equivalent uses a `[]` dep and does not
  // storm, which is why this was mobile-only.
  const agentTypes = useMemo(() => aiAgents.map(a => a.type), [aiAgents]);

  // Picker state for the "+" button: which agent the user wants to start
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);

  // Workspace apps loaded from aw.json — legacy listing source. Demoted
  // (2026-09-01): no longer drives the Apps section (installedApps below
  // does), but stays alive as (i) the appChrome() legacyApp input for apps
  // that still only carry a component key in aw.json, and (ii) the backing
  // list for the top-bar quick launchers' legacy string kinds.
  const [workspaceApps, setWorkspaceApps] = useState([]);

  useEffect(() => {
    const load = (cfg) => {
      if (cfg.ai_agents?.length) setAiAgents(withAntigravityAgent(cfg.ai_agents));
      const apps = (cfg.workspace_apps || []).filter(a => a.id && !a.hidden);
      setWorkspaceApps(apps);
    };
    getAwConfig().then(load).catch(() => {});
    const handler = () => getAwConfig().then(load).catch(() => {});
    window.addEventListener('aw-config-changed', handler);
    return () => window.removeEventListener('aw-config-changed', handler);
  }, []);

  // Installed apps (GET /api/apps) — drives the Apps section. Filtered to
  // has_windows (visualApps semantics, not uiApps — see appWindowChrome.js
  // design notes: mobile has one list, so excluding Tool/Service like the
  // desktop launcher's `uiApps` does would make kb/proxy unreachable here).
  // null (not []) until the first fetch resolves, so the Apps section can
  // render a loading state instead of a false "no apps installed".
  const [installedApps, setInstalledApps] = useState(null);
  useEffect(() => {
    const load = () => listInstalledApps().then(setInstalledApps).catch(() => setInstalledApps([]));
    load();
    window.addEventListener('aw-apps-changed', load);
    return () => window.removeEventListener('aw-apps-changed', load);
  }, []);

  // Window contributions (GET /api/apps/-/contributions) — resolves each
  // installed app's launchable windows (appChrome/defaultLaunchWindow).
  // usePluginContributions() above fetches the same payload into a ref for
  // its own event-handler-only use; this is a separate, independent fetch
  // into React state on purpose, so a render can read a fresh value instead
  // of dereferencing a ref during render.
  const [contributions, setContributions] = useState(null);
  useEffect(() => {
    const load = () => fetchContributions().then(setContributions).catch(() => {});
    load();
    window.addEventListener('aw-apps-changed', load);
    return () => window.removeEventListener('aw-apps-changed', load);
  }, []);

  // Live component-status map appChrome() needs to resolve a component key
  // and its running/off/boot status.
  const componentMap = useMemo(() => {
    const map = {};
    (components || []).forEach((c) => { map[c.key] = c; });
    return map;
  }, [components]);

  // ─── iOS Safari safe-area race fix ─────────────────────────────
  //
  // Symptom: on reload (especially in PWA standalone mode), the AW
  // top bar slides up behind the Dynamic Island / status bar even
  // though it sits below it on first load.
  //
  // Cause: iOS Safari sometimes paints the page BEFORE
  // `viewport-fit=cover` has propagated, so `env(safe-area-inset-top)`
  // evaluates to 0 at first paint.  After viewport-fit registers,
  // env() returns the correct value, but the layout has already
  // committed and the user sees the wrong padding.
  //
  // Fix (two prongs):
  //   1. Toggle the <meta name="viewport"> content on mount —
  //      forces iOS to re-parse viewport-fit and re-apply insets.
  //   2. Measure env(safe-area-inset-*) via a hidden probe element
  //      and mirror to CSS custom properties (--aw-safe-*).  These
  //      vars become the source of truth for our padding rules,
  //      with re-measurement on resize / orientationchange / a few
  //      timed retries to catch the moment iOS finally settles.
  useEffect(() => {
    // Step 1 — viewport meta toggle.
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      const orig = meta.getAttribute('content') || '';
      meta.setAttribute('content', orig + ' ');
      requestAnimationFrame(() => meta.setAttribute('content', orig));
    }

    // Step 2 — JS-measured safe-area CSS variables.
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;' +
      'pointer-events:none;' +
      'padding-top:env(safe-area-inset-top);' +
      'padding-right:env(safe-area-inset-right);' +
      'padding-bottom:env(safe-area-inset-bottom);' +
      'padding-left:env(safe-area-inset-left);';
    document.body.appendChild(probe);

    const measure = () => {
      const cs = getComputedStyle(probe);
      const root = document.documentElement.style;
      root.setProperty('--aw-safe-top', cs.paddingTop || '0px');
      root.setProperty('--aw-safe-right', cs.paddingRight || '0px');
      root.setProperty('--aw-safe-bottom', cs.paddingBottom || '0px');
      root.setProperty('--aw-safe-left', cs.paddingLeft || '0px');
    };

    measure();
    // iOS often returns 0 on first read; re-measure after the next
    // frame and after a few delays to catch viewport-fit settling.
    requestAnimationFrame(measure);
    const t1 = setTimeout(measure, 100);
    const t2 = setTimeout(measure, 500);

    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      probe.remove();
    };
  }, []);

  // Request fullscreen on mobile
  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      // Delay to ensure it's triggered by user gesture context (first tap)
      const onTap = () => {
        el.requestFullscreen().catch(() => {});
        document.removeEventListener('touchstart', onTap);
        document.removeEventListener('click', onTap);
      };
      document.addEventListener('touchstart', onTap, { once: true });
      document.addEventListener('click', onTap, { once: true });
    }
  }, []);

  const applyTerminalUpdate = useCallback((data) => {
    const alive = asArray(data).filter(t => t.alive);
    // Any terminal whose type matches a configured agent CLI counts as
    // an agent session — Claude, Copilot, Codex, or whatever else the
    // user has configured in aw.config.  Everything else is a "regular
    // terminal" (plain shell).
    const agentOnes = alive.filter(t => agentTypes.includes(t.type));
    setAgentSessions(agentOnes);
    setTerminals(alive.filter(t => !agentTypes.includes(t.type)));
    const insecure = {};
    const resume = {};
    agentOnes.forEach(t => {
      insecure[t.id] = !!t.insecure;
      if (t.agent_session_id) resume[t.id] = t.agent_session_id;
    });
    setInsecureMap(insecure);
    setClaudeResumeMap(prev => ({ ...prev, ...resume }));
  }, [agentTypes]);

  // Initial load
  useEffect(() => {
    apiFetch(`${API_BASE}/api/terminals`)
      .then(r => r.json())
      .then(data => applyTerminalUpdate(data))
      .catch(() => {});
  }, [applyTerminalUpdate]);

  // Stable ref so the terminal-update handler can read the latest activeWindow
  // without a stale closure — avoids re-registering the listener on every click.
  const activeWindowRef = useRef(null);
  useEffect(() => { activeWindowRef.current = activeWindow; }, [activeWindow]);

  // Listen for real-time terminal updates via WebSocket
  useEffect(() => {
    const handler = (e) => {
      const { action, session_id, terminal, terminals } = e.detail;
      if (terminals) applyTerminalUpdate(terminals);
      // Sync the active window's display name when a rename arrives from another
      // browser window — keeps the header title current without a page reload.
      if (terminal && session_id && activeWindowRef.current?.id === session_id) {
        if (terminal.name && terminal.name !== activeWindowRef.current.name) {
          setActiveWindow((prev) => prev ? { ...prev, name: terminal.name } : prev);
        }
      }
      // If a terminal was restarted (e.g. insecure toggle from another browser),
      // force remount to reconnect the WebSocket — use the ref so this always
      // sees the current activeWindow without re-registering the listener.
      if (action === 'restart' && activeWindowRef.current?.id === session_id) {
        setTerminalRemountKey(k => k + 1);
      }
    };
    window.addEventListener('aw-terminals-update', handler);
    return () => window.removeEventListener('aw-terminals-update', handler);
  }, [applyTerminalUpdate]);

  // Presentations via WebSocket — aw-app-presentations owns this —
  // /api/apps/presentations/ws. Reconnect/backoff/close-code handling lives
  // in the shared aw-ws/1 client (§7/§9.1).
  const [presentations, setPresentations] = useState([]);
  useEffect(() => {
    const socket = createSharedSocket({
      url: () => wsUrl('/api/apps/presentations/ws'),
      initType: 'presentation_init',
      onFrame: (msg) => {
        if (msg.type === 'presentation_init') {
          setPresentations(msg.presentations);
        } else if (msg.type === 'presentation_update') {
          if (msg.action === 'create') {
            setPresentations(prev => [...prev.filter(c => c.id !== msg.presentation.id), msg.presentation]);
            setActiveWindow(prev => {
              if (prev) previousWindowRef.current = prev;
              return { type: 'presentation', key: `presentation:${msg.presentation.id}`, id: msg.presentation.id, name: msg.presentation.title };
            });
          } else if (msg.action === 'update') {
            setPresentations(prev => prev.map(c => c.id === msg.presentation.id ? msg.presentation : c));
            setActiveWindow(prev => {
              if (prev) previousWindowRef.current = prev;
              return { type: 'presentation', key: `presentation:${msg.presentation.id}`, id: msg.presentation.id, name: msg.presentation.title };
            });
          } else if (msg.action === 'delete') {
            setPresentations(prev => prev.filter(c => c.id !== msg.id));
          }
        }
      },
      onStatus: ({ state }) => {
        if (state === 'fatal') notifyWsAuthFailed();
      },
    });
    return socket.retain();
  }, []);

  // Diffs via WebSocket — aw-app-diff-tool owns this — /api/apps/diff-tool/ws.
  useEffect(() => {
    const ws = new WebSocket(wsUrl('/api/apps/diff-tool/ws'));
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type !== 'diff_open' || !msg.diff) return;
      const diff = msg.diff;
      setActiveWindow(prev => {
        if (prev) previousWindowRef.current = prev;
        return { type: 'diff', key: `diff:${diff.id}`, id: diff.id, name: diff.title };
      });
    };
    return () => ws.close();
  }, []);

  // Component groups
  const grouped = {};
  components.filter(c => c.category !== 'System').forEach(c => {
    if (!grouped[c.category]) grouped[c.category] = [];
    grouped[c.category].push(c);
  });

  // Actions
  //
  // Hits the key-based component lifecycle endpoints
  // `POST /api/components/{key}/{start|stop|restart}` — the same ones the
  // desktop `startComponent`/`stopComponent`/`restartComponent` helpers use.
  // The previous implementation posted to `/api/components/${action}` with
  // a JSON body, which is **not** a real route — every mobile Start / Stop
  // / Restart tap silently 404'd, hence "no effect from mobile view".
  const handleAction = useCallback(async (key, action) => {
    const comp = components.find(c => c.key === key);
    if (!comp) return;
    await apiFetch(`${API_BASE}/api/components/${key}/${action}`, {
      method: 'POST',
    });
    setTimeout(refetch, 1000);
  }, [components, refetch]);

  const openWindow = useCallback((type, key, extra) => {
    setActiveWindow({ type, key, ...extra });
  }, []);

  // Start an agent CLI session of the given type.  Mirrors the desktop
  // `createAgent` in App.jsx so the same agent definitions (label,
  // command, color) drive both surfaces.  If the backend pre-flight
  // rejects (e.g. the CLI isn't installed) we surface the message
  // instead of swallowing the click.
  const createAgent = useCallback(async (agentType) => {
    const agentDef = aiAgents.find(a => a.type === agentType);
    if (!agentDef) return;
    const newId = crypto.randomUUID();
    const name = `${agentType} - ${newId.slice(-4)}`;
    // Embed --session-id for Claude so the backend can link the PTY to
    // the agent session and the insecure toggle can resume the right session.
    let command = agentDef.command || agentType;
    if (agentType === 'claude') command = `claude --session-id ${newId}`;
    else if (agentType === 'gemini') command = `gemini --session-id ${newId}`;
    else if (agentType === 'antigravity') command = buildAntigravityCommand();
    const res = await apiFetch(`${API_BASE}/api/terminals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, command, type: agentType }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      const msg = data.error || `Failed to start ${agentDef.label}`;
      const hint = data.hint ? `\n\n${data.hint}` : '';
      window.alert(`${msg}${hint}`);
      return;
    }
    // WebSocket broadcast will add to agentSessions; we open the window
    // immediately and rely on the broadcast to fill in details.
    openWindow('terminal', `terminal:${data.id}`, {
      id: data.id, name: data.name, isClaude: agentType === 'claude', agentType,
    });
    setAgentPickerOpen(false);
  }, [aiAgents, openWindow]);

  const createTerminal = useCallback(async () => {
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
    // WebSocket broadcast will add to terminals
    openWindow('terminal', `terminal:${data.id}`, { id: data.id, name: data.name });
  }, [terminals, openWindow]);

  const deleteSession = useCallback(async (sessionId, isClaude) => {
    await apiFetch(`${API_BASE}/api/terminals/${sessionId}`, { method: 'DELETE' });
    // WebSocket broadcast will remove from sessions
    if (activeWindow?.id === sessionId) closeActiveWindow();
  }, [activeWindow, closeActiveWindow]);

  const deletePresentation = useCallback(async (presentationId) => {
    // aw-app-presentations owns this — /api/apps/presentations/presentations/*.
    await apiFetch(`/api/apps/presentations/presentations/${presentationId}`, { method: 'DELETE' });
    if (activeWindow?.id === presentationId) closeActiveWindow();
  }, [activeWindow, closeActiveWindow]);

  // The terminal keyboard (mic + custom keys + attach) is now its own
  // component (`TerminalKeyboard.jsx`) and is mounted whenever any
  // terminal-type window is active — Claude or otherwise.  This is the
  // session id that the keyboard writes into.
  const activeTerminalId = activeWindow?.type === 'terminal' ? activeWindow.id : null;

  // ─── Remote camera stream ───────────────────────────────────────────────
  //
  // State lives here (not inside TerminalKeyboard) so the WebSocket +
  // MediaStream survives switching between terminal sessions — the keyboard
  // is keyed by activeTerminalId and would remount otherwise.
  //
  // Flow:
  //   getUserMedia({ video }) → presentation.toBlob(JPEG) → WebSocket /ws/camera
  //   → FastAPI CameraManager → (MJPEG stream at /api/camera/stream)
  //                           → (ffmpeg → /dev/video10 if available)
  const [cameraActive, setCameraActive] = useState(false);
  const cameraRef = useRef(null); // { stream, ws, video, presentation, interval }

  const toggleCamera = useCallback(async () => {
    if (cameraActive) {
      // ── Stop ──────────────────────────────────────────────────────────
      const cam = cameraRef.current;
      if (cam) {
        clearInterval(cam.interval);
        try { cam.ws?.close(); } catch {}
        cam.stream?.getTracks().forEach(t => t.stop());
        cameraRef.current = null;
      }
      setCameraActive(false);
      // Tell the server to stop the ffmpeg pipeline (best-effort)
      apiFetch('/api/camera/stop', { method: 'POST' }).catch(() => {});
    } else {
      // ── Start ─────────────────────────────────────────────────────────
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

      // Hidden video element to receive the live MediaStream
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      try { await video.play(); } catch {}

      // Presentation for JPEG frame capture
      const presentation = document.createElement('presentation');
      presentation.width = 640;
      presentation.height = 480;
      const ctx = presentation.getContext('2d');

      const ws = new WebSocket(wsUrl('/ws/camera'));
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        // 15fps capture loop — toBlob is async so we use setInterval
        // and skip frames if the previous blob hasn't sent yet.
        let sending = false;
        const interval = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN || sending) return;
          sending = true;
          try {
            ctx.drawImage(video, 0, 0, 640, 480);
            presentation.toBlob(blob => {
              sending = false;
              if (!blob || ws.readyState !== WebSocket.OPEN) return;
              ws.send(blob);
            }, 'image/jpeg', 0.75);
          } catch {
            sending = false;
          }
        }, 1000 / 15);

        cameraRef.current = { stream, ws, video, presentation, interval };
        setCameraActive(true);

        // Try to activate the v4l2 pipeline (best-effort — server logs will
        // show whether /dev/video10 is available)
        apiFetch('/api/camera/start-v4l2', { method: 'POST' }).catch(() => {});
      };

      ws.onclose = () => {
        // Peer closed — clean up gracefully
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

  // insecureMap is populated on mount by the /api/terminals fetch (via applyTerminalUpdate)
  // and kept current by terminal_update broadcasts — no localStorage needed since
  // is_insecure is persisted in the agent_sessions DB table.
  const [insecureMap, setInsecureMap] = useState({});
  const [claudeResumeMap, setClaudeResumeMap] = useState({});

  // Close session picker when clicking outside the picker container.
  useEffect(() => {
    if (!sessionPickerOpen) return;
    const handleMouseDown = (e) => {
      if (sessionPickerRef.current && !sessionPickerRef.current.contains(e.target)) {
        setSessionPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [sessionPickerOpen]);

  // Build the restart command for an agent terminal, delegating to
  // aw-app-code-agent-clis via src/lib/agentClis.js.
  const buildAgentCommand = useCallback((agentType, resumeId, isInsecure, sessionName = null, preGeneratedId = null) => {
    const def = aiAgents.find(a => a.type === agentType);
    return buildDecoupledAgentCommand(agentType, resumeId, isInsecure, sessionName, preGeneratedId, def?.command);
  }, [aiAgents]);

  const toggleInsecure = useCallback(async (ptySessionId, newInsecure) => {
    setInsecureMap(prev => ({ ...prev, [ptySessionId]: newInsecure }));
    const session = agentSessions.find(t => t.id === ptySessionId);
    const agentType = session?.type || 'claude';
    const resumeId = claudeResumeMap[ptySessionId];
    const cmd = buildAgentCommand(agentType, resumeId, newInsecure);
    await apiFetch(`${API_BASE}/api/terminals/${ptySessionId}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, name: session?.name }),
    });
    // Force TerminalWindow remount to reconnect WebSocket to new PTY
    setTimeout(() => setTerminalRemountKey(k => k + 1), 500);
  }, [agentSessions, claudeResumeMap, buildAgentCommand]);

  // Switch the active agent terminal to a specific resume session (or
  // start a brand-new one when `agentSessionId` is null).  Generalised
  // across agent types — uses buildAgentCommand so the right CLI flag
  // gets used (claude --resume / codex resume / copilot --resume / etc).
  const switchAgentSession = useCallback(async (ptySessionId, agentSessionId, summary) => {
    const session = agentSessions.find(t => t.id === ptySessionId);
    const agentType = session?.type || 'claude';
    const isInsecure = insecureMap[ptySessionId] || false;
    const isNewSession = !agentSessionId;
    let newName, cmd, resolvedId;
    if (isNewSession) {
      resolvedId = crypto.randomUUID();
      newName = `${agentType} - ${resolvedId.slice(-4)}`;
      cmd = buildAgentCommand(agentType, null, isInsecure, newName, resolvedId);
    } else {
      resolvedId = agentSessionId;
      newName = summary || agentType;
      cmd = buildAgentCommand(agentType, agentSessionId, isInsecure);
    }
    setClaudeResumeMap(prev => ({ ...prev, [ptySessionId]: resolvedId }));
    await apiFetch(`${API_BASE}/api/terminals/${ptySessionId}/restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, name: newName, new_session: isNewSession }),
    });
    setAgentSessions(prev => prev.map(t => t.id === ptySessionId ? { ...t, name: newName } : t));
    setActiveWindow(prev => prev ? { ...prev, name: newName } : prev);
    setTimeout(() => setTerminalRemountKey(k => k + 1), 500);
    setSessionPickerOpen(false);
  }, [agentSessions, insecureMap, buildAgentCommand]);

  // Rename the currently-active terminal session (PUT /api/terminals/:id).
  // Broadcasts to all other windows via the backend terminal_update WS push.
  const renameTerminal = useCallback(async (sessionId, newName) => {
    if (!sessionId || !newName) return;
    await apiFetch(`${API_BASE}/api/terminals/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    // Optimistic local update — the WS broadcast will also update this but
    // having it locally avoids a visible flicker in the header.
    setAgentSessions(prev => prev.map(t => t.id === sessionId ? { ...t, name: newName } : t));
    setTerminals(prev => prev.map(t => t.id === sessionId ? { ...t, name: newName } : t));
    setActiveWindow(prev => prev ? { ...prev, name: newName } : prev);
  }, []);

  // Counts
  const runningCount = components.filter(c => c.status === 'running' && c.category !== 'System').length;
  const bootingCount = components.filter(c => c.status === 'boot' && c.category !== 'System').length;
  const activeComp = activeWindow?.type === 'log' ? components.find(c => c.key === activeWindow.key) : null;

  // Top bar title for active window
  const getActiveTitle = () => {
    if (!activeWindow) return null;
    if (activeWindow.type === 'browser') return 'Browser';
    if (activeWindow.type === 'vscode') return 'VSCode';
    if (activeWindow.type === 'desktop') return 'Desktop';
    if (activeWindow.type === 'presentation') return activeWindow.name || 'Presentation';
    if (activeWindow.type === 'terminal') return activeWindow.name || activeWindow.id;
    if (activeWindow.type === 'app-window') return activeWindow.chrome?.title || activeWindow.windowSpec?.title || activeWindow.key;
    return activeWindow.key;
  };

  // Helper for the launcher-icon row used both in the top bar and inside
  // the dashboard Apps section. Centralising the open-window mechanics in
  // one place keeps the two surfaces in lockstep — change the iframe-open
  // call here and both surfaces pick it up.
  // Open Browser / VSCode / Desktop on mobile in a fullscreen iframe
  // overlay.
  //
  // Why no window.open / new-tab path:
  //   - In Safari mobile, opening these proxied URLs as a top-level
  //     navigation can land on a half-ready service (we kick off the
  //     docker container in the background, so the first request can
  //     race the container's startup).  Safari surfaces the broken
  //     response as "Safari cannot display raw data" — dead-end.
  //   - In PWA mode (Add to Home Screen), window.open dumps the user
  //     into a Safari sheet with no clear path back to the PWA.
  //   - Iframes are more forgiving (they retry / show empty loading
  //     state until the container is up) AND we control the chrome
  //     around them, so we can always show a back button.
  //
  // The iframe-app overlay (rendered up at the top of this component)
  // provides full-bleed display with an orientation-aware header /
  // floating back button — same UX whether AW was launched from
  // Safari or installed as a PWA.
  // Reset the resolution picker whenever the user opens a different app
  // (or leaves the iframe-app view entirely) so each app starts on Auto.
  useEffect(() => {
    setIframeResolution(null);
    setResPickerOpen(false);
    setIframeScale(1);
  }, [activeWindow?.kind]);

  // Recalculate the CSS scale factor whenever the selected resolution
  // changes or the container is resized (rotation, keyboard open/close).
  useEffect(() => {
    if (!iframeResolution || !iframeContainerRef.current) {
      setIframeScale(1);
      return;
    }
    const el = iframeContainerRef.current;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const scaleX = rect.width  / iframeResolution.w;
      const scaleY = rect.height / iframeResolution.h;
      setIframeScale(Math.min(scaleX, scaleY));
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [iframeResolution]);

  // Build the app-proxy subdomain URL for a workspace app.
  // Strips the localhost:port prefix from app.url and substitutes
  // the {id}.app.{apex} subdomain so the same path + query string
  // are preserved (e.g. ?autoconnect=1&resize=scale for Browser,
  // ?folder=... for VSCode).
  const buildProxyUrl = useCallback((app) => {
    const apex = window.location.hostname.replace(/^www\./, '');
    let pathQuery = '/';
    try {
      const u = new URL(app.url);
      pathQuery = u.pathname + u.search;
    } catch {}
    return `${window.location.protocol}//${app.id}.app.${apex}${pathQuery}`;
  }, []);

  // Background docker start so the app the user just tapped finds a running
  // service once it loads (or its window mounts) — shared by every branch
  // below so a stopped component always gets kicked off the same way.
  const startIfOff = useCallback((componentKey) => {
    if (!componentKey) return;
    const comp = components.find(c => c.key === componentKey);
    if (comp && comp.status === 'off') {
      startComponent(componentKey).catch(() => {});
      setTimeout(refetch, 1000);
    }
  }, [components, refetch]);

  const openApp = useCallback((kindOrApp) => {
    // Installed-app row (from the has_windows-filtered Apps section below) —
    // resolve its default launchable window through the same ladder the
    // desktop shell uses. Checked first: a legacy workspace_apps object has
    // `.id`, never `.slug`, so this never misfires on the other branches.
    if (kindOrApp && typeof kindOrApp === 'object' && kindOrApp.slug) {
      const installedApp = kindOrApp;
      const windowSpec = defaultLaunchWindow(installedApp, contributions);
      if (!windowSpec) return;

      const legacyApp = workspaceApps.find(a => a.id === installedApp.slug);
      const chrome = appChrome({
        appId: installedApp.slug,
        windowSpec,
        installedApp,
        legacyApp,
        componentMap,
      });

      if (windowSpec.body?.type === 'managed_app') {
        // Same fullscreen iframe overlay every other app opens through.
        setActiveWindow({
          type: 'iframe-app',
          kind: installedApp.slug,
          url: chrome.url,
          title: chrome.title,
          component: chrome.component,
        });
        const w = window.screen.width;
        const h = window.screen.height;
        document.title = `AW · ${chrome.title} · ${w}×${h} · mobile`;
        window.history.replaceState(null, '', `/#app=${encodeURIComponent(installedApp.slug)}&view=mobile`);
      } else {
        // Everything else (component / declarative) — generic app-window
        // overlay rendering AppWindowBody, the same body BasicWindow renders
        // on desktop. This is what lets mobile open apps beyond the handful
        // of managed_app ones.
        setActiveWindow({
          type: 'app-window',
          key: appWindowKey(windowSpec.id),
          windowSpec,
          spec: windowSpec.body?.spec_data || null,
          chrome,
        });
      }

      startIfOff(chrome.component);
      return;
    }

    // Accept either a legacy workspace-app object (from aw.json, the
    // top-bar quick launchers' backing list) or a legacy string kind
    // ('browser' | 'vscode' | 'desktop').  String kinds are resolved via
    // the loaded workspaceApps list; if the list isn't available yet, we
    // fall back to the hardcoded URL map so the top-bar quick launchers
    // always work.
    let app = typeof kindOrApp === 'object' ? kindOrApp
            : workspaceApps.find(a => a.id === kindOrApp);

    if (app) {
      const proxyUrl = buildProxyUrl(app);
      const w = window.screen.width;
      const h = window.screen.height;

      // Always render the fullscreen iframe overlay — works in both PWA
      // and regular Safari without the popup / "cannot display raw
      // data" failure modes window.open hits.
      setActiveWindow({
        type: 'iframe-app',
        kind: app.id,
        url: proxyUrl,
        title: app.label,
        component: app.component || null,
      });

      // Update document.title and URL so "Add to Home Screen" captures
      // the right app + resolution + view type.  When the user opens
      // the saved shortcut later, the hash encodes which app to show.
      document.title = `AW · ${app.label} · ${w}×${h} · mobile`;
      window.history.replaceState(null, '', `/#app=${encodeURIComponent(app.id)}&view=mobile`);

      startIfOff(app.component);
    } else {
      // Fallback hardcoded map for legacy string kinds ('browser' /
      // 'vscode' / 'desktop') used by the top-bar quick launchers
      // before workspaceApps have loaded, or for the 'desktop' kind
      // which maps to app id 'linux' in aw.json.
      const apex = window.location.hostname.replace(/^www\./, '');
      const legacyMap = {
        browser: { url: `${window.location.protocol}//browser.app.${apex}/?autoconnect=1&resize=scale`, title: 'Browser', compKey: 'docker:aw-browser' },
        vscode:  { url: `${window.location.protocol}//vscode.app.${apex}/?folder=/home/coder/project`, title: 'VSCode',  compKey: 'docker:aw-code-server' },
        desktop: { url: `${window.location.protocol}//linux.app.${apex}/`,                             title: 'Desktop', compKey: 'docker:aw-kali' },
      };
      const target = legacyMap[kindOrApp];
      if (!target) return;

      setActiveWindow({ type: 'iframe-app', kind: kindOrApp, url: target.url, title: target.title, component: target.compKey || null });

      startIfOff(target.compKey);
    }
  }, [workspaceApps, buildProxyUrl, componentMap, contributions, startIfOff]);

  // Remote Desktop used to live here as its own fullscreen overlay (it
  // wasn't a URL-backed workspace app, so it couldn't go through openApp's
  // iframe-app path). Removed 2026-08-15 along with the desktop nav entry —
  // aw-app-remote-screen owns the VNC client now and reaches mobile through
  // the normal apps grid.

  // Fullscreen iframe-app overlay (PWA-mode launchers).  Renders the
  // app iframe edge-to-edge with a thin chrome that adapts to device
  // orientation:
  //
  //   • Portrait — full-width header bar at the top with the app title
  //     and a "Back" pill button on the right (where the user's right
  //     thumb naturally lands when holding a phone vertically).
  //   • Landscape — no header at all, just a tiny `[←]` floating pill
  //     in the top-left corner (~36px) so it doesn't eat into the
  //     limited vertical space VSCode / Browser need in landscape.
  //
  // Both orientations are always rendered; CSS `portrait:` /
  // `landscape:` Tailwind variants toggle visibility based on
  // `(orientation: ...)` media query, so rotation reflows live.
  if (activeWindow?.type === 'iframe-app') {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-black"
        style={{
          // `fixed inset-0` ignores body's safe-area padding (fixed elements
          // are positioned vs the viewport, not the body padding-box).  We
          // must re-apply the top inset here so the portrait header bar and
          // the Back button clear the Dynamic Island / notch.  The black
          // bg-black covers the inset area so there's no visible gap.
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        {/* Portrait: header bar with title + back-on-the-right.
            Safe-area padding so the notch / camera doesn't hide the
            content; min-h-12 + py-2 keeps the back button at a
            comfortable thumb-sized tap target. Hidden entirely in
            hide_top embed mode — the native chrome replaces it. */}
        {!hideTopChrome && <div
          className="hidden portrait:flex items-center justify-between bg-[var(--color-bg-header)] border-b border-[var(--color-border)] shrink-0 min-h-12"
          style={{
            // body in index.css owns the safe-area padding — no need
            // to double-count it here.  Simple fixed values only.
            paddingLeft: '12px',
            paddingRight: '12px',
            paddingTop: '8px',
            paddingBottom: '8px',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
              {activeWindow.title}
            </div>
            {/* Resolution selector — tap to pick a virtual viewport size.
                Replaces the old static "1440×900 · mobile" read-only text.
                The iframe renders at the chosen pixel dimensions and is
                CSS-scaled to fit so no page reload is needed. */}
            <div className="relative shrink-0">
              <button
                onClick={() => setResPickerOpen(p => !p)}
                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-white/10 active:bg-white/15 transition-colors"
              >
                {iframeResolution ? `${iframeResolution.w}×${iframeResolution.h}` : 'Auto'}
                <svg
                  className={`w-2.5 h-2.5 shrink-0 transition-transform ${resPickerOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                ><path d="M6 9l6 6 6-6"/></svg>
              </button>
              {resPickerOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl shadow-black/60 overflow-hidden min-w-[130px]">
                  {RESOLUTIONS.map(res => {
                    const isActive = res.w
                      ? iframeResolution?.w === res.w && iframeResolution?.h === res.h
                      : !iframeResolution;
                    return (
                      <button
                        key={res.label}
                        onClick={() => {
                          setIframeResolution(res.w ? { w: res.w, h: res.h } : null);
                          setResPickerOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2.5 text-[12px] flex items-center gap-2 hover:bg-white/5 border-b border-[var(--color-border)] last:border-0 ${
                          isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'
                        }`}
                      >
                        <span className="w-3 shrink-0 text-[var(--color-accent)]">{isActive ? '✓' : ''}</span>
                        {res.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Container controls — only for apps whose window carries a
                standalone component (canControlContainer, computed the same
                way desktop's AppProxyWindow gates its own trio). Absent from
                `activeWindow` (legacy iframe-app opens never set it) means
                this simply doesn't render — no regression for those. */}
            {activeWindow.component && componentMap[activeWindow.component]?.standalone_app !== false && (
              <DockerControls
                variant="touch"
                componentKey={activeWindow.component}
                status={componentMap[activeWindow.component]?.status || 'off'}
                onReloadWindow={refreshIframe}
              />
            )}
            <button
              onClick={refreshIframe}
              aria-label="Refresh"
              title="Refresh"
              className="px-3 py-2 rounded-md bg-white/8 hover:bg-white/15 active:bg-white/20 text-sm flex items-center justify-center text-[var(--color-text-primary)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            <button
              onClick={() => window.open(activeWindow.url, '_blank')}
              aria-label="Open in new tab"
              title="Open in new tab"
              className="px-3 py-2 rounded-md bg-white/8 hover:bg-white/15 active:bg-white/20 text-sm flex items-center justify-center text-[var(--color-text-primary)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
            <button
              onClick={closeActiveWindow}
              className="px-3.5 py-2 rounded-md bg-white/8 hover:bg-white/15 active:bg-white/20 text-sm flex items-center gap-1.5 text-[var(--color-text-primary)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back
            </button>
          </div>
        </div>}

        {/* The iframe — flex-1 fills remaining height in portrait, the
            entire viewport in landscape (no header above it).
            The inner wrapper is sized to the chosen virtual resolution
            and CSS-scaled to fit without reloading the iframe. */}
        <div
          ref={iframeContainerRef}
          className="flex-1 w-full relative overflow-hidden bg-black"
        >
          <div
            style={iframeResolution ? {
              position: 'absolute',
              top: 0,
              left: 0,
              width: `${iframeResolution.w}px`,
              height: `${iframeResolution.h}px`,
              transformOrigin: 'top left',
              transform: `scale(${iframeScale})`,
            } : {
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
            }}
          >
            <iframe
              ref={iframeRef}
              src={activeWindow.url}
              onLoad={onAppIframeLoad}
              style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'black' }}
              title={activeWindow.title}
              allow="clipboard-read; clipboard-write; microphone; autoplay"
            />
          </div>
        </div>

        {/* Landscape: floating minimal back pill, top-left.  Uses
            safe-area-inset-left so the iPhone notch (which sits on
            the leading edge in landscape) doesn't cover the button.
            Semi-transparent black + backdrop-blur so it stays
            readable over any iframe content (light or dark). Hidden
            in hide_top embed mode along with the portrait header. */}
        {!hideTopChrome && <>
        <button
          onClick={closeActiveWindow}
          aria-label="Back"
          title="Back"
          className="hidden landscape:flex fixed z-50 w-11 h-11 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white/90 active:bg-black/80 items-center justify-center shadow-lg"
          style={{
            top: 'max(8px, env(safe-area-inset-top))',
            left: 'max(8px, env(safe-area-inset-left))',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <button
          onClick={() => window.open(activeWindow.url, '_blank')}
          aria-label="Open in new tab"
          title="Open in new tab"
          className="hidden landscape:flex fixed z-50 w-11 h-11 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white/90 active:bg-black/80 items-center justify-center shadow-lg"
          style={{
            top: 'max(8px, env(safe-area-inset-top))',
            left: 'max(56px, calc(env(safe-area-inset-left) + 48px))',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
        <button
          onClick={refreshIframe}
          aria-label="Refresh"
          title="Refresh"
          className="hidden landscape:flex fixed z-50 w-11 h-11 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white/90 active:bg-black/80 items-center justify-center shadow-lg"
          style={{
            top: 'max(8px, env(safe-area-inset-top))',
            left: 'max(104px, calc(env(safe-area-inset-left) + 96px))',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
        </>}
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] overflow-hidden">
      {/* Top bar */}
      {/* Mobile top bar.
          - safe-area-inset-* padding so notch / rounded corners on
            iPhones in landscape don't hide the back / close / title.
            Without these the bar visually starts under the notch in
            landscape and back / right-side buttons become unreachable.
          - min-h-12 (~48px) plus larger inner button padding so each
            tap target meets Apple's 44pt minimum and is comfortable
            to hit with a thumb in portrait.
          - The min-h applies to the whole bar; individual buttons
            use min-w-12 / min-h-10 inside so spacing remains
            balanced even when the bar grows. */}
      <div
        className="flex items-center justify-between bg-[var(--color-bg-header)] border-b border-[var(--color-border)] shrink-0 z-20 min-h-12"
        style={{
          // The body in index.css already owns env(safe-area-inset-*)
          // padding (box-sizing:border-box, 100dvh), so MobileApp's
          // content area starts below the Dynamic Island / notch.
          // Adding safe-area padding here again would double-count it
          // and push the title/buttons too far down.  Use simple fixed
          // values for visual breathing room only.
          paddingLeft: '12px',
          paddingRight: '12px',
          paddingTop: '8px',
          paddingBottom: '8px',
        }}
      >
        {activeWindow ? (
          <>
            <div ref={sessionPickerRef} className="flex items-center gap-2 min-w-0 relative">
              {activeComp && <StatusDot status={activeComp.status} />}
              {/* Session picker — works generically for any agent CLI
                  with a sessions endpoint on the backend (Claude,
                  Codex, Copilot, Cursor).  Picks the agent type from
                  three fallback sources so old/persisted activeWindow
                  states still work:
                    1. activeWindow.agentType (set by new openWindow)
                    2. agentSessions[id].type (live terminal record)
                    3. activeWindow.isClaude (legacy boolean)
                  All four endpoints return the same {id,title,summary}
                  shape, so the dropdown markup is identical. */}
              {(() => {
                const liveSession = agentSessions.find(t => t.id === activeWindow.id);
                const agentType = activeWindow.agentType
                  || liveSession?.type
                  || (activeWindow.isClaude ? 'claude' : null);
                if (!agentType) {
                  return <span className="text-sm font-medium truncate">{getActiveTitle()}</span>;
                }
                return (
                  <button
                    className="text-sm font-medium truncate flex items-center gap-1.5 hover:bg-white/10 active:bg-white/15 rounded-md px-2.5 py-2"
                    onClick={() => {
                      if (sessionPickerOpen) {
                        setSessionPickerOpen(false);
                      } else {
                        setAvailableSessions([]);
                        setSessionsLoading(true);
                        setSessionPickerOpen(true);
                        apiFetch(`${API_BASE}/api/apps/code-agent-clis/agent-sessions?type=${agentType}`)
                          .then(r => r.json())
                          .then(data => setAvailableSessions(Array.isArray(data) ? data : []))
                          .catch(() => setAvailableSessions([]))
                          .finally(() => setSessionsLoading(false));
                      }
                    }}
                  >
                    {getActiveTitle()}
                    <svg className={`w-3 h-3 shrink-0 transition-transform ${sessionPickerOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                  </button>
                );
              })()}
              {activeComp?.port && (
                <span className="text-[10px] text-[var(--color-text-muted)]">:{activeComp.port}</span>
              )}

              {/* Session picker dropdown */}
              {sessionPickerOpen && (
                <div className="absolute top-full left-0 mt-1 z-50 w-72 max-h-80 overflow-y-auto bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl shadow-black/60">
                  <button
                    className="w-full text-left px-3 py-2.5 text-xs text-[var(--color-accent)] hover:bg-white/5 border-b border-[var(--color-border)]"
                    onClick={() => switchAgentSession(activeWindow.id, null, null)}
                  >+ New session</button>
                  {availableSessions.map(s => (
                    <button
                      key={s.session_id}
                      className="w-full text-left px-3 py-2.5 hover:bg-white/5 border-b border-[var(--color-border)] last:border-0"
                      onClick={() => switchAgentSession(activeWindow.id, s.session_id, s.name)}
                    >
                      <div className="text-xs font-medium text-[var(--color-accent)] truncate">{s.name}</div>
                      <div className="text-[10px] text-[var(--color-text-muted)] opacity-60">{s.session_id?.slice(0,8)}… {s.updated_at ? new Date(s.updated_at * 1000).toLocaleDateString() : ''}</div>
                    </button>
                  ))}
                  {availableSessions.length === 0 && (
                    <div className="px-3 py-3 text-xs text-[var(--color-text-muted)]">
                      {sessionsLoading ? 'Loading sessions…' : 'No saved sessions yet'}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* Insecure / secure toggle for agent terminals, driven by
                  aw-app-code-agent-clis metadata (supportsInsecureMode). */}
              {supportsInsecureMode(activeWindow.agentType || (activeWindow.isClaude ? 'claude' : null)) && (
                <button
                  onClick={() => toggleInsecure(activeWindow.id, !insecureMap[activeWindow.id])}
                  className={`px-3 py-2 text-[12px] rounded-md transition-colors ${
                    insecureMap[activeWindow.id]
                      ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]'
                      : 'bg-white/5 text-[var(--color-text-muted)] active:bg-white/10'
                  }`}
                >{insecureMap[activeWindow.id] ? 'insecure' : 'secure'}</button>
              )}
              {activeComp && activeComp.status === 'off' ? (
                <button onClick={() => handleAction(activeWindow.key, 'start')}
                  className="px-3.5 py-2 text-[12px] rounded-md bg-[var(--color-status-running)]/15 text-[var(--color-status-running)] active:bg-[var(--color-status-running)]/25">Start</button>
              ) : activeComp ? (
                <>
                  <button onClick={() => handleAction(activeWindow.key, 'restart')}
                    className="px-3 py-2 text-[12px] rounded-md bg-[var(--color-status-boot)]/15 text-[var(--color-status-boot)] active:bg-[var(--color-status-boot)]/25">Restart</button>
                  <button onClick={() => handleAction(activeWindow.key, 'stop')}
                    className="px-3 py-2 text-[12px] rounded-md bg-[var(--color-danger)]/15 text-[var(--color-danger)] active:bg-[var(--color-danger)]/25">Stop</button>
                </>
              ) : activeWindow.type === 'app-window' && activeWindow.chrome?.canControlContainer ? (
                // Container controls for a non-managed_app window (component /
                // declarative) whose app row resolves to a real, independently
                // start/stop/restart-able container — desktop's BasicWindow has
                // no equivalent today (Decision D, mobile-apps-menu design).
                <DockerControls
                  variant="touch"
                  componentKey={activeWindow.chrome.component}
                  status={componentMap[activeWindow.chrome.component]?.status || 'off'}
                />
              ) : null}
              {/* App-registered titlebar actions — the same
                  core.window.titlebar:<id> slot BasicWindow.jsx renders on
                  desktop (see BasicWindow.jsx:53-58). Some apps (Remote
                  Screen) put their entire toolbar here instead of a second
                  bar in the body, per registerWindowActions's contract —
                  without this the app never mounts on mobile at all. */}
              {activeWindow.type === 'app-window' && activeWindow.windowSpec?.id && (
                <AppSlot
                  slot={windowTitlebarSlot(activeWindow.windowSpec.id)}
                  props={{
                    windowKey: activeWindow.key,
                    onClose: closeActiveWindow,
                    onMaximize: () => {},
                    isMaximized: false,
                    instanceId: activeWindow.windowSpec?.instanceId,
                  }}
                />
              )}
              {/* Back pill — always rightmost, matches the apps-header
                  back button style.  Replaces the previous duplicate
                  (left-icon back + right-icon close did the same thing
                  but in two places).  Now there's one canonical Back
                  button in a consistent spot across terminal, log,
                  presentation, and app windows. */}
              <button
                onClick={closeActiveWindow}
                className="px-3.5 py-2 rounded-md bg-white/8 hover:bg-white/15 active:bg-white/20 text-sm flex items-center gap-1.5 text-[var(--color-text-primary)]"
                aria-label="Back"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                Back
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Logo — same "❯ aw" wordmark as the desktop top bar in
                App.jsx (Direção B: Signal Amber identity). Keeping the
                two surfaces visually identical so the brand reads the
                same whether the user is on a phone or a laptop. */}
            <div className="flex items-center shrink-0">
              <svg width="62" height="18" viewBox="0 0 240 70" className="shrink-0">
                <text x="0" y="50" fontFamily="ui-monospace, Menlo, monospace" fontSize="46" fontWeight="700" fill="var(--color-accent)">&#10095;</text>
                <text x="44" y="50" fontFamily="Inter" fontSize="46" fontWeight="800" fill="var(--color-text-primary)" letterSpacing="-1">aw</text>
              </svg>
            </div>
            <div className="flex items-center gap-2">
              {/* Top-bar app launcher row — Browser / VSCode / Desktop.
                  Status dot inside each button reflects the underlying
                  docker container (green=running, pulsing yellow=boot,
                  muted=off) so the user knows whether tapping fires up
                  the iframe instantly or kicks off a docker spin-up.
                  These mirror the desktop top-bar launchers added in
                  App.jsx — keeping behavior parallel between the two
                  layouts. The dashboard below ALSO has a tappable Apps
                  row (see MobileDashboard) so the user can either go
                  fast from the top bar or browse from the dashboard. */}
              <MobileAppLauncher
                title="Browser"
                status={components.find((c) => c.key === 'docker:aw-browser')?.status || 'off'}
                onClick={() => openApp('browser')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                </svg>
              </MobileAppLauncher>
              <MobileAppLauncher
                title="VSCode"
                status={components.find((c) => c.key === 'docker:aw-code-server')?.status || 'off'}
                onClick={() => openApp('vscode')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M16.5 3.5L2 12l14.5 8.5V3.5z"/><path d="M16.5 3.5L22 6.5v11l-5.5 3V3.5z"/>
                </svg>
              </MobileAppLauncher>
              <MobileAppLauncher
                title="Desktop"
                status={components.find((c) => c.key === 'docker:aw-kali')?.status || 'off'}
                onClick={() => openApp('desktop')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                </svg>
              </MobileAppLauncher>
              <div className="text-[10px] text-[var(--color-text-muted)] ml-1">
                <span className="text-[var(--color-status-running)]">{runningCount}</span>
                {bootingCount > 0 && <> / <span className="text-[var(--color-status-boot)]">{bootingCount}</span></>}
              </div>
              {/* Switch to desktop view.  App.jsx watches the URL hash
                  and re-renders the full <App /> tree when it sees
                  #desktop, so a hash change + reload is the cleanest way
                  to flip layouts.  Reload (instead of just hashchange)
                  also clears any in-flight WebSocket / iframe state
                  that was sized for the mobile viewport. */}
              <button
                onClick={() => {
                  window.location.hash = '#desktop';
                  window.location.reload();
                }}
                title="Switch to desktop view"
                className="ml-1 px-2 py-1 rounded bg-white/5 text-[var(--color-text-muted)] active:bg-white/10 inline-flex items-center gap-1 text-[10px]"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <path d="M8 21h8M12 17v4"/>
                </svg>
                Desktop
              </button>
            </div>
          </>
        )}
      </div>

      {/* Content area — shrinks when the on-screen keyboard expands.
          The TerminalKeyboard panel is `position: fixed; bottom: 0`,
          so without this padding the keyboard would cover the lower
          portion of the terminal.  Reserving keyboardHeight pixels
          at the bottom of the flex container forces the inner
          terminal to refit (xterm's ResizeObserver picks it up
          automatically) and the user sees keyboard + terminal side
          by side. */}
      <div
        className="flex-1 overflow-hidden"
        style={{ paddingBottom: keyboardHeight ? `${keyboardHeight}px` : undefined }}
      >
        {activeWindow ? (
          activeWindow.type === 'terminal' ? (
            <MobileTerminalView
              key={`${activeWindow.id}-${terminalRemountKey}`}
              activeWindow={activeWindow}
              onClose={closeActiveWindow}
              onRename={renameTerminal}
            />
          ) : activeWindow.type === 'diff' ? (
            // Owned by aw-app-diff-tool (core.window.body:diff-tool.viewer,
            // 2026-08-05 decoupling) — same slot/component the desktop
            // BasicWindow renders, mounted directly here like 'presentation'
            // below.
            <div className="h-full mobile-presentation-view">
              <AppSlot
                slot={windowBodySlot('diff-tool.viewer')}
                props={{
                  windowKey: activeWindow.key,
                  instanceId: activeWindow.id,
                  onClose: closeActiveWindow,
                  onMaximize: () => {},
                  isMaximized: false,
                }}
              />
            </div>
          ) : activeWindow.type === 'presentation' ? (
            // Owned by aw-app-presentations now (core.window.body:presentations.viewer,
            // 2026-08-05 decoupling) — same slot the desktop BasicWindow renders,
            // just mounted directly here since mobile has its own single-active-
            // window chrome instead of WindowManager's draggable windows.
            <div className="h-full mobile-presentation-view">
              <AppSlot
                slot={windowBodySlot('presentations.viewer')}
                props={{
                  windowKey: activeWindow.key,
                  instanceId: activeWindow.id,
                  onClose: closeActiveWindow,
                  onMaximize: () => {},
                  isMaximized: false,
                  onTitleChange: () => {},
                }}
              />
            </div>
          ) : activeWindow.type === 'app-window' ? (
            // Generic app window — the same body BasicWindow renders on
            // desktop (AppSlot for component-mode, AppWindow for declarative
            // widgets), reached here for any launchable window whose body
            // isn't managed_app (which stays on the iframe-app overlay above).
            <div className="h-full mobile-presentation-view">
              <AppWindowBody
                windowSpec={activeWindow.windowSpec}
                spec={activeWindow.spec}
                slotProps={{
                  windowKey: activeWindow.key,
                  instanceId: activeWindow.windowSpec?.instanceId,
                  onClose: closeActiveWindow,
                  onMaximize: () => {},
                  isMaximized: false,
                  onTitleChange: () => {},
                }}
              />
            </div>
          ) : (
            <div className="h-full mobile-log-view">
              <LogWindow
                componentKey={activeWindow.key}
                component={activeComp}
                maxLines={500}
                onClose={closeActiveWindow}
                onAction={(action) => handleAction(activeWindow.key, action)}
              />
            </div>
          )
        ) : (
          <MobileDashboard
            presentations={presentations}
            agentSessions={agentSessions}
            aiAgents={aiAgents}
            agentPickerOpen={agentPickerOpen}
            setAgentPickerOpen={setAgentPickerOpen}
            terminals={terminals}
            componentMap={componentMap}
            grouped={grouped}
            workspaceApps={workspaceApps}
            installedApps={installedApps}
            contributions={contributions}
            onOpenWindow={openWindow}
            onOpenModal={openModal}
            onAction={handleAction}
            onCreateAgent={createAgent}
            onCreateTerminal={createTerminal}
            onDeleteSession={deleteSession}
            onDeletePresentation={deletePresentation}
            onOpenApp={openApp}
          />
        )}
      </div>

      {/* Floating terminal keyboard — works for ALL terminal types
          (Claude, regular shells, anything future).  Shows a FAB at the
          bottom-right when collapsed; tap to expand into the full
          custom keyboard with mic + attach + arrows + Ctrl/Esc/Tab.
          The keyswitch from `activeClaudeId` to `activeTerminalId` is
          deliberate — the previous implementation gated the entire
          mic/keyboard/attach UI on Claude terminals only, which made
          regular shells effectively read-only on mobile. */}
      {activeTerminalId && (
        <TerminalKeyboard
          key={activeTerminalId}
          sessionId={activeTerminalId}
          onHeightChange={setKeyboardHeight}
          cameraActive={cameraActive}
          onCameraToggle={toggleCamera}
        />
      )}

      {/* Modal overlay — full-screen sheet that floats above everything.
          The dashboard (or active terminal/presentation) stays mounted underneath
          so its scroll position is fully preserved when the modal closes.
          Use this for Settings and any other full-screen panel that should
          feel like a dismissible sheet rather than a navigation step. */}
      {mobileModal && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-[var(--color-bg-primary)]"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          {/* Sheet header */}
          <div className="flex items-center justify-between shrink-0 min-h-12 px-4 bg-[var(--color-bg-header)] border-b border-[var(--color-border)]">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              {mobileModal.title}
            </span>
            <button
              onClick={closeModal}
              className="px-3 py-2 rounded-md bg-white/8 hover:bg-white/15 active:bg-white/20 text-sm flex items-center gap-1.5 text-[var(--color-text-primary)]"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              Close
            </button>
          </div>
          {/* Sheet content */}
          <div className="flex-1 overflow-y-auto">
            {mobileModal.content}
          </div>
        </div>
      )}
    </div>
  );
}


function MobileTerminalView({ activeWindow, onClose, onRename }) {
  const containerRef = useRef(null);
  // Mirror the desktop reconnect-all-terminals behaviour: when the status WS
  // reconnects after a server restart, bump the signal so this terminal's WS
  // also retries (even if it exhausted its auto-retry budget while server was down).
  const [serverRestartSignal, setServerRestartSignal] = useState(0);
  useEffect(() => {
    const handler = () => setServerRestartSignal(s => s + 1);
    window.addEventListener('aw-server-reconnected', handler);
    return () => window.removeEventListener('aw-server-reconnected', handler);
  }, []);

  // Send a control command to the active TerminalWindow via the
  // window-level CustomEvent bridge it registers in its mount effect.
  // This is how the floating scroll buttons drive xterm without us
  // having to share a ref through React props.
  //
  // Note: we deliberately do NOT ship a custom Copy UI.  The phone's
  // native text-selection menu (long-press / tap-drag → "Copy") works
  // on top of xterm's accessibility tree, which mirrors visible
  // terminal output.  iOS, iPadOS, and Android Chrome all surface
  // their own copy menu, so a custom pill would be redundant.
  const sendCmd = useCallback((action) => {
    window.dispatchEvent(new CustomEvent('aw-term-cmd', {
      detail: { sessionId: activeWindow.id, action },
    }));
  }, [activeWindow.id]);

  // Suppress the native OS keyboard inside terminal windows.
  //
  // Why: xterm.js mounts a hidden `.xterm-helper-textarea` to capture
  // keystrokes for desktop users.  On mobile this textarea pops up the
  // device keyboard the moment the user taps the terminal — but our
  // typing flow goes through the custom <TerminalKeyboard /> instead,
  // so the OS keyboard is unwanted noise (and steals screen space).
  //
  // The previous implementation set readonly/inputmode-none on the
  // textarea once at mount, but xterm and iOS sometimes restore focus
  // after the fact (e.g. on resize or scrollback redraw).  We now use
  // a MutationObserver to keep the attributes locked, and a focusin
  // listener that immediately blurs any element that the browser
  // tries to focus inside the terminal container.  Together these
  // guarantee the OS keyboard never appears regardless of how the
  // user interacts with the terminal area.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const lockTextarea = () => {
      const ta = el.querySelector('.xterm-helper-textarea');
      if (!ta) return;
      // NOTE: `readonly` is intentionally NOT set. iPhone Safari refuses
      // to deliver hardware-keyboard events to readonly form fields —
      // verified via the /api/debug/keylog telemetry showing zero
      // keydown events across every surface when readonly was active.
      // inputmode="none" alone is what suppresses the on-screen
      // keyboard; that's the attribute that does the work. Keeping the
      // textarea writable lets external Magic / Bluetooth keyboards
      // route through xterm's own keydown listener → term.onData →
      // WS → backend, with no parallel bridge required.
      ta.removeAttribute('readonly');
      ta.setAttribute('tabindex', '-1');
      ta.setAttribute('autocomplete', 'off');
      ta.setAttribute('autocorrect', 'off');
      ta.setAttribute('autocapitalize', 'off');
      ta.setAttribute('spellcheck', 'false');
      ta.setAttribute('inputmode', 'none');
      // Do NOT blur — keeping focus on the textarea is what allows
      // hardware keystrokes to reach xterm. The on-screen keyboard is
      // suppressed by inputmode="none", so there's no UX cost.
    };

    // Initial pass (xterm may render async after mount) + a couple of
    // delayed passes to catch late renders.
    lockTextarea();
    const t = setTimeout(lockTextarea, 200);
    const t2 = setTimeout(lockTextarea, 1000);

    // Re-apply attributes if xterm re-renders / replaces the textarea.
    const observer = new MutationObserver(lockTextarea);
    observer.observe(el, { childList: true, subtree: true });

    // Targeted: only blur elements that would actually trigger the OS
    // keyboard — input, textarea, or contenteditable.  An earlier
    // version of this handler blurred *anything* that got focus
    // inside the terminal area, which inadvertently broke iOS native
    // text selection: iOS focuses internal elements as part of its
    // selection lifecycle, and ripping that focus away aborts the
    // selection mid-gesture.  Now we only intercept the elements
    // that genuinely open the keyboard, leaving selection alone.
    const onFocusIn = (e) => {
      const target = e.target;
      if (!target || target === document.body) return;
      if (target.dataset?.allowFocus === 'true') return;
      // The xterm helper textarea is now the intended focus target on
      // mobile (with inputmode="none" suppressing the on-screen keyboard
      // but allowing hardware-keyboard input). Blurring it here would
      // bounce focus back to BODY, where iPhone Safari refuses to
      // deliver hardware-keyboard events. So we explicitly skip the
      // xterm textarea and only blur OTHER form fields inside the
      // terminal area.
      if (target.classList && target.classList.contains('xterm-helper-textarea')) {
        return;
      }
      const tag = target.tagName;
      const isFormControl = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const isEditable = target.isContentEditable === true;
      if (isFormControl || isEditable) {
        target.blur();
      }
    };
    el.addEventListener('focusin', onFocusIn);

    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      observer.disconnect();
      el.removeEventListener('focusin', onFocusIn);
    };
  }, [activeWindow.id]);

  return (
    <div className="h-full mobile-terminal-view relative" ref={containerRef}>
      <TerminalWindow
        sessionId={activeWindow.id}
        name={activeWindow.name}
        isClaude={activeWindow.isClaude}
        agentType={activeWindow.agentType}
        onClose={onClose}
        onRename={onRename}
        windowKey={activeWindow.key}
        reconnectSignal={serverRestartSignal}
      />

      {/* Floating scroll controls — pinned to the right edge, above
          where the TerminalKeyboard FAB sits in the bottom-right.
          We use buttons (not gestures) because xterm captures touch
          events for selection + link-clicks; a button is also more
          discoverable than a hidden swipe pattern.  Tapping repeats
          via standard mobile button repeat — five lines per tap is
          a comfortable default. */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1.5 select-none">
        <ScrollBtn onClick={() => sendCmd('scroll-page-up')} title="Scroll up">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 15l-6-6-6 6"/>
          </svg>
        </ScrollBtn>
        <ScrollBtn onClick={() => sendCmd('scroll-page-down')} title="Scroll down">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </ScrollBtn>
        <ScrollBtn onClick={() => sendCmd('scroll-bottom')} title="Jump to bottom">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12l7 7 7-7"/>
          </svg>
        </ScrollBtn>
      </div>

    </div>
  );
}

// Compact circular scroll button used for the right-edge scroll
// controls in MobileTerminalView.  Semi-transparent so terminal
// output behind it is still partially readable.
function ScrollBtn({ onClick, children, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-9 h-9 rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white/90 active:bg-black/80 flex items-center justify-center"
    >
      {children}
    </button>
  );
}



// Icon renderer for workspace apps — maps the `icon` field from aw.json
// to a small SVG.  Falls back to a generic window icon for unknown names.
function AppIcon({ name, size = 18 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5' };
  switch (name) {
    case 'globe':    return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>;
    case 'code':     return <svg {...p}><path d="M16.5 3.5L2 12l14.5 8.5V3.5z"/><path d="M16.5 3.5L22 6.5v11l-5.5 3V3.5z"/></svg>;
    case 'terminal': return <svg {...p}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;
    case 'monitor':  return <svg {...p}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>;
    case 'bolt':     return <svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case 'cloud':    return <svg {...p}><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>;
    case 'folder':   return <svg {...p}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>;
    default:         return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>;
  }
}

function MobileDashboard({ presentations, agentSessions, aiAgents, agentPickerOpen, setAgentPickerOpen, terminals, componentMap, grouped, workspaceApps, installedApps, contributions, onOpenWindow, onOpenModal, onAction, onCreateAgent, onCreateTerminal, onDeleteSession, onDeletePresentation, onOpenApp }) {
  // Lookup helpers for the Agents list — get the agent definition
  // (label, color) by type so each row can render with its CLI's brand.
  const agentByType = (type) => aiAgents.find(a => a.type === type);

  // Collapsible sections — default to collapsed so the dashboard is
  // compact on first load.  Users tap the header chevron to expand.
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [componentSections, setComponentSections] = useState({}); // { [category]: bool }
  const toggleSection = (cat) => setComponentSections(prev => ({ ...prev, [cat]: !prev[cat] }));

  // Presentation search — matches title + html body (case-insensitive).
  // Auto-expands the section while the user is typing.
  const [presentationQuery, setPresentationQuery] = useState('');
  const presentationQueryNorm = presentationQuery.trim().toLowerCase();
  // Sort newest-first so the last created presentation appears at the top.
  const sortedPresentations = [...presentations].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const filteredPresentations = presentationQueryNorm
    ? sortedPresentations.filter(c =>
        (c.title || '').toLowerCase().includes(presentationQueryNorm) ||
        (c.html || '').toLowerCase().includes(presentationQueryNorm)
      )
    : sortedPresentations;
  const presentationExpanded = presentationOpen || presentationQueryNorm.length > 0;

  // Workspace section — Repos, Tasks, Settings
  // Start expanded on first load so the options are immediately visible.
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [reposOpen, setReposOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [repos, setRepos] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [busyRepo, setBusyRepo] = useState(null);
  const [busyTask, setBusyTask] = useState(null);
  const [reposError, setReposError] = useState(null);
  const [repoFlash, setRepoFlash] = useState({});

  const refreshTasks = useCallback(async () => {
    apiFetch('/api/tasks').then(r => r.json()).then(d => setTasks(d.tasks || [])).catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch(GITHUB_PRS_PATH).then(r => r.json()).then(d => setRepos(d.repos || [])).catch(() => {});
    refreshTasks();
    const handler = () => refreshTasks();
    window.addEventListener('aw-task-update', handler);
    return () => window.removeEventListener('aw-task-update', handler);
  }, [refreshTasks]);

  const flashRepo = (path, kind) => {
    setRepoFlash(p => ({ ...p, [path]: kind }));
    setTimeout(() => setRepoFlash(p => { const n = { ...p }; delete n[path]; return n; }), 2000);
  };

  // /api/git/pull was a phantom endpoint — never existed in the backend.
  // Real pull now lives on aw-app-git's own mount (apps/git/git_app/plugin.py).
  const pullRepo = async (r) => {
    setBusyRepo(r.path);
    setReposError(null);
    try {
      const res = await apiFetch('/api/apps/git/pull', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: r.path }),
      });
      const data = await res.json();
      if (data.success) {
        flashRepo(r.path, 'success');
        apiFetch(GITHUB_PRS_PATH).then(res2 => res2.json()).then(d => setRepos(d.repos || [])).catch(() => {});
      } else {
        flashRepo(r.path, 'error');
        setReposError(`${r.name}: ${data.error || 'pull failed'}`);
      }
    } catch (e) {
      flashRepo(r.path, 'error');
      setReposError(`${r.name}: ${e.message}`);
    } finally {
      setBusyRepo(null);
    }
  };

  const diffRepo = async (r) => {
    setBusyRepo(r.path);
    setReposError(null);
    try {
      const res = await apiFetch('/api/git/diff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: r.path,
          ref: r.diff_ref || 'HEAD~1',
          title: `${r.name}${r.ahead > 0 ? `: ${r.ahead} ahead` : ''}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.success) {
        flashRepo(r.path, 'success');
        // DiffWindow will auto-open via the diff_open WS event
      } else {
        flashRepo(r.path, 'error');
        setReposError(`${r.name}: ${data?.error || 'diff failed'}`);
      }
    } catch (e) {
      flashRepo(r.path, 'error');
      setReposError(`${r.name}: ${e.message}`);
    } finally {
      setBusyRepo(null);
    }
  };

  const openRepoTerminal = async (r) => {
    try {
      const res = await apiFetch('/api/terminals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: r.name }),
      });
      const data = await res.json();
      if (data.id) {
        const escaped = (r.path || '').replace(/'/g, "'\\''");
        setTimeout(() => {
          apiFetch(`/api/terminals/${data.id}/write`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `cd '${escaped}'\r` }),
          }).catch(() => {});
        }, 350);
        onOpenWindow('terminal', `terminal:${data.id}`, { id: data.id, name: data.name });
      }
    } catch (e) {
      setReposError(`${r.name}: ${e.message}`);
    }
  };

  const runTask = async (t) => {
    setBusyTask(t.id);
    try {
      await apiFetch(`/api/tasks/${t.id}/run`, { method: 'POST' });
      await refreshTasks();
    } catch (_) {}
    finally { setBusyTask(null); }
  };

  const openTaskSession = async (t) => {
    if (!t.agent_session_id && !t.session_id) return;
    try {
      const res = await apiFetch(`/api/tasks/${t.id}/open`, { method: 'POST' });
      const data = await res.json();
      if (data.session_id) {
        onOpenWindow('terminal', `terminal:${data.session_id}`, { id: data.session_id, name: t.name });
      }
    } catch (_) {}
  };

  return (
    <div className="h-full overflow-y-auto p-3 space-y-4">

      {/* Presentations — collapsible.  Header is tap-to-toggle; the search
          box auto-expands the list while typing so results are visible
          without an extra tap. */}
      {presentations.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setPresentationOpen(o => !o)}
            className="w-full text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 px-1 flex items-center gap-1.5 active:opacity-70"
          >
            <IconChevron open={presentationExpanded} />
            <IconPresentation /> Presentation
            <span className="ml-1 normal-case tracking-normal text-[10px] opacity-70">
              {presentationQueryNorm ? `${filteredPresentations.length}/${presentations.length}` : presentations.length}
            </span>
          </button>
          {presentationExpanded && (
            <>
              <div className="mb-2 relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none">
                  <IconSearch />
                </span>
                <input
                  type="search"
                  value={presentationQuery}
                  onChange={e => setPresentationQuery(e.target.value)}
                  placeholder="Search presentation title and content…"
                  className="w-full pl-8 pr-8 py-2 text-[13px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg outline-none focus:border-[var(--color-accent)] placeholder:text-[var(--color-text-muted)]"
                />
                {presentationQuery && (
                  <button
                    type="button"
                    onClick={() => setPresentationQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] active:bg-white/10"
                    aria-label="Clear search"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {filteredPresentations.length === 0 ? (
                  <div className="text-[12px] text-[var(--color-text-muted)] px-3 py-2">
                    No presentations match “{presentationQuery}”.
                  </div>
                ) : filteredPresentations.map(c => (
                  <div key={c.id}
                    className="flex items-center justify-between px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] active:bg-white/5"
                    onClick={() => onOpenWindow('presentation', `presentation:${c.id}`, { id: c.id, name: c.title })}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <IconPresentation />
                      <span className="text-[13px] font-medium truncate">{c.title || 'Untitled'}</span>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); onDeletePresentation?.(c.id); }}
                      className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-400/10 active:bg-red-400/20 flex-shrink-0"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Agent sessions — Claude, Copilot, Codex, etc.
          Tapping "+" opens a picker so the user can choose which CLI to
          start.  This replaces the previous Claude-only section, where
          mobile users couldn't see or start Copilot / Codex sessions
          even though the backend supported them. */}
      <div className="relative">
        <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 px-1 flex items-center justify-between">
          <div className="flex items-center gap-1.5"><IconClaude /> Agents</div>
          <button
            onClick={() => setAgentPickerOpen(prev => !prev)}
            className={`p-1 rounded hover:bg-white/10 ${agentPickerOpen ? 'bg-white/10' : ''}`}
            title="Start an agent session"
          ><IconPlus /></button>
        </div>

        {/* Agent picker — small popover listing the configured CLIs */}
        {/* Picker: agent CLIs + plain Terminal option.  Plain shells
            were previously in their own section below; we merged
            them in here so users have a single "+ → start a thing"
            flow regardless of session type. */}
        {agentPickerOpen && (
          <div className="absolute right-0 top-7 z-30 w-44 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl shadow-black/60 overflow-hidden">
            {aiAgents.map(agent => (
              <button
                key={agent.type}
                onClick={() => onCreateAgent(agent.type)}
                className="w-full text-left px-3 py-2.5 text-[13px] flex items-center gap-2 hover:bg-white/5 border-b border-[var(--color-border)]"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: agent.color || 'var(--color-accent)' }}
                />
                <span className="font-medium">{agent.label}</span>
                <span className="text-[10px] text-[var(--color-text-muted)] ml-auto truncate">{agent.command}</span>
              </button>
            ))}
            <button
              onClick={() => { onCreateTerminal(); setAgentPickerOpen(false); }}
              className="w-full text-left px-3 py-2.5 text-[13px] flex items-center gap-2 hover:bg-white/5"
            >
              <span className="shrink-0 text-[var(--color-text-muted)]"><IconTerminal /></span>
              <span className="font-medium">Terminal</span>
              <span className="text-[10px] text-[var(--color-text-muted)] ml-auto truncate">bash</span>
            </button>
          </div>
        )}

        {/* Combined list of agent sessions + plain shell terminals.
            Sort: agents grouped first (in aiAgents config order),
            then plain shells, then alphabetic by name within each
            group.  This keeps Claude/Copilot/Codex visually clustered
            with terminals trailing — same look as desktop. */}
        {agentSessions.length === 0 && terminals.length === 0 ? (
          <div className="text-[12px] text-[var(--color-text-muted)] px-3 py-2">
            No sessions yet. Tap + to start an agent or terminal.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            {[...agentSessions, ...terminals].sort((a, b) => {
              const typeOrder = aiAgents.map(x => x.type);
              const ai = typeOrder.indexOf(a.type);
              const bi = typeOrder.indexOf(b.type);
              const aRank = ai === -1 ? typeOrder.length : ai;
              const bRank = bi === -1 ? typeOrder.length : bi;
              if (aRank !== bRank) return aRank - bRank;
              return (a.name || '').localeCompare(b.name || '');
            }).map(s => {
              const def = agentByType(s.type);
              const isAgent = !!def;
              return (
                <div key={s.id}
                  className="flex items-center justify-between px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] active:bg-white/5"
                  onClick={() => onOpenWindow('terminal', `terminal:${s.id}`, { id: s.id, name: s.name, isClaude: s.type === 'claude', agentType: s.type })}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isAgent ? (
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ background: def.color || 'var(--color-accent)' }}
                      />
                    ) : (
                      <span className="shrink-0 text-[var(--color-text-muted)]"><IconTerminal /></span>
                    )}
                    <span className="text-[13px] font-medium truncate">{s.name}</span>
                    {isAgent && <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider shrink-0">{def.label}</span>}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id, isAgent); }}
                    className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-white/5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* A "Workspace" section used to sit here for floating-window features
          that aren't URL-backed apps, mirroring the desktop top menu's
          "Workspace" dropdown. Remote Desktop was its only entry and moved to
          aw-app-remote-screen, so the whole section went with it (2026-08-15)
          — an empty header reads as a broken list. Re-add it if core ever
          grows another non-URL-backed feature. */}

      {/* Apps — dynamic from installed apps (GET /api/apps), filtered to
          has_windows (visualApps semantics — see appWindowChrome.js: NOT
          AppLauncher's stricter uiApps, whose extra Tool/Service exclusion
          would make kb/proxy unreachable in this single-list mobile UI).
          category groups the rows into sections; it does not filter.
          Rows are launch-only (icon + title + status dot) — Start/Restart/
          Stop live on the open-app chrome instead, not here, since a
          control button inside a scrolling tap-to-open row is a mis-tap
          magnet on touch (mobile-apps-menu design, Decision E). */}
      {installedApps === null ? (
        <div className="text-[12px] text-[var(--color-text-muted)] px-1">Loading apps…</div>
      ) : (
        Object.values(
          installedApps
            .filter((a) => !!a.has_windows)
            .reduce((acc, app) => {
              const raw = (app.category || 'Apps').trim() || 'Apps';
              // Same stem isCategory() (appWindowChrome.js) uses to compare
              // categories — manifests disagree on singular vs plural
              // ("Service" vs "Services"), and without this every such pair
              // rendered as two separate section headers. Prefer the longer
              // (plural) spelling seen for the group as the display label,
              // matching AppLauncher's own canonical "Services"/"Tools" tabs.
              const key = raw.toLowerCase().replace(/s$/, '');
              if (!acc[key]) acc[key] = { label: raw, apps: [] };
              else if (raw.length > acc[key].label.length) acc[key].label = raw;
              acc[key].apps.push(app);
              return acc;
            }, {})
        ).map(({ label, apps }) => (
          <div key={label}>
            <div className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 px-1">{label}</div>
            <div className="grid grid-cols-1 gap-1.5 mb-3">
              {apps.map(app => {
                const legacyApp = workspaceApps.find(a => a.id === app.slug);
                const windowSpec = defaultLaunchWindow(app, contributions);
                const chrome = windowSpec
                  ? appChrome({ appId: app.slug, windowSpec, installedApp: app, legacyApp, componentMap })
                  : null;
                const status = chrome?.component
                  ? (componentMap[chrome.component]?.status ?? 'off')
                  : null;
                return (
                  <MobileAppCard
                    key={app.slug}
                    label={chrome?.title || app.name}
                    description={app.description || ''}
                    status={status}
                    onOpen={() => onOpenApp(app)}
                    iconClass="text-[var(--color-accent)]"
                    icon={<AppIcon name={app.icon} />}
                  />
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Components — each category is independently collapsible and
          starts collapsed so the dashboard is compact on load.  Header
          shows count + a running/total summary so users can see status
          at a glance without expanding. */}
      {CATEGORY_ORDER.map(cat => {
        const items = grouped[cat];
        if (!items || items.length === 0) return null;
        const open = !!componentSections[cat];
        const running = items.filter(c => c.status === 'running').length;
        return (
          <div key={cat}>
            <button
              type="button"
              onClick={() => toggleSection(cat)}
              className="w-full text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 px-1 flex items-center gap-1.5 active:opacity-70"
            >
              <IconChevron open={open} />
              <span>{cat}</span>
              <span className="ml-1 normal-case tracking-normal text-[10px] opacity-70">
                {running}/{items.length}
              </span>
            </button>
            {open && (
              <div className="grid grid-cols-1 gap-1.5">
                {items.sort((a, b) => a.key.localeCompare(b.key)).map(comp => (
                  <MobileComponentCard key={comp.key} comp={comp}
                    onOpenLog={() => onOpenWindow('log', comp.key)} onAction={onAction} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Workspace — Repos, Tasks, Settings */}
      <div>
        <button
          type="button"
          onClick={() => setWorkspaceOpen(o => !o)}
          className="w-full text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 px-1 flex items-center gap-1.5 active:opacity-70"
        >
          <IconChevron open={workspaceOpen} />
          Workspace
        </button>
        {workspaceOpen && (
          <div className="space-y-1.5">

            {/* Settings — BOTH panels, mirroring the desktop shell (Workspace >
                Settings and Profile > Settings NEW). Deliberately not a swap:
                the legacy panel is the only place AW Config, TCP Proxy, Cookies,
                Feed Subscriber, Backup, Skills and MCP Servers actually work —
                they are still `ready: false` placeholders in SettingsPanelNew,
                so replacing one with the other would take seven working screens
                off the phone. When the legacy panel is retired on desktop, this
                entry goes with it. */}
            <div
              onClick={() => onOpenModal('Settings', <SettingsPanel />)}
              className="flex items-center gap-2.5 px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] active:bg-white/5 cursor-pointer"
            >
              <span className="text-[var(--color-text-muted)]"><IconGear /></span>
              <span className="text-[13px] font-medium">Settings</span>
            </div>

            {/* Settings NEW */}
            <div
              onClick={() => onOpenModal('Settings NEW', <SettingsPanelNew />)}
              className="flex items-center gap-2.5 px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] active:bg-white/5 cursor-pointer"
            >
              <span className="text-[var(--color-text-muted)]"><IconGear /></span>
              <span className="text-[13px] font-medium">Settings NEW</span>
            </div>

            {/* Repos */}
            <div>
              <button
                type="button"
                onClick={() => setReposOpen(o => !o)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] active:bg-white/5"
              >
                <span className="text-[var(--color-text-muted)]"><IconRepos /></span>
                <span className="text-[13px] font-medium flex-1 text-left">Repos</span>
                {repos.length > 0 && (
                  <span className="text-[10px] text-[var(--color-text-muted)] mr-1">{repos.length}</span>
                )}
                <IconChevron open={reposOpen} />
              </button>
              {reposOpen && (
                <div className="mt-1 space-y-1">
                  {reposError && (
                    <div className="px-3 py-1.5 text-[11px] rounded bg-red-500/10 text-red-400 border border-red-500/20">
                      {reposError}
                    </div>
                  )}
                  {repos.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">No repos configured.</div>
                  ) : repos.map(r => {
                    const busy = busyRepo === r.path;
                    const fl = repoFlash[r.path];
                    return (
                      <div
                        key={r.name}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border ${
                          fl === 'success' ? 'bg-green-500/10 border-green-500/20'
                          : fl === 'error' ? 'bg-red-500/10 border-red-500/20'
                          : 'bg-[var(--color-bg-secondary)] border-[var(--color-border)]'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-medium truncate">{r.name}</span>
                            {r.dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Has local changes" />}
                            {r.diff_ref && r.ahead > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--color-accent)]/15 text-[var(--color-accent)] shrink-0">
                                +{r.ahead}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-[var(--color-text-muted)] truncate">{r.branch || '?'}</div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                          {/* Pull */}
                          <button
                            onClick={() => pullRepo(r)}
                            disabled={busy}
                            className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-green-400 active:bg-white/15 disabled:opacity-50"
                            title="Pull latest"
                          >
                            <svg className={`w-3.5 h-3.5 ${busy ? 'animate-spin [animation-direction:reverse]' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 5v14M5 12l7 7 7-7" />
                            </svg>
                          </button>
                          {/* Diff */}
                          <button
                            onClick={() => diffRepo(r)}
                            disabled={busy}
                            className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] active:bg-white/15 disabled:opacity-50"
                            title="Show diff"
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 19V5M5 12l7-7 7 7" />
                            </svg>
                          </button>
                          {/* Terminal */}
                          <button
                            onClick={() => openRepoTerminal(r)}
                            className="p-1.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-amber-400 active:bg-white/15"
                            title={`Terminal in ${r.name}`}
                          >
                            <IconTerminal />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tasks */}
            <div>
              <button
                type="button"
                onClick={() => setTasksOpen(o => !o)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] active:bg-white/5"
              >
                <span className="text-[var(--color-text-muted)]"><IconTasksClock /></span>
                <span className="text-[13px] font-medium flex-1 text-left">Tasks</span>
                {tasks.length > 0 && (
                  <span className="text-[10px] text-[var(--color-text-muted)] mr-1">{tasks.length}</span>
                )}
                <IconChevron open={tasksOpen} />
              </button>
              {tasksOpen && (
                <div className="mt-1 space-y-1">
                  {tasks.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">No tasks yet.</div>
                  ) : tasks.map(t => {
                    const busy = busyTask === t.id;
                    const dotColor =
                      t.last_run_status === 'ok' ? 'bg-green-400' :
                      t.last_run_status === 'error' ? 'bg-red-400' :
                      t.last_run_status === 'running' ? 'bg-blue-400' :
                      'bg-white/20';
                    return (
                      <div
                        key={t.id}
                        onClick={() => openTaskSession(t)}
                        className="flex items-center gap-2.5 px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] active:bg-white/5 cursor-pointer"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-medium truncate">{t.name}</span>
                            {!t.enabled && (
                              <span className="px-1 py-0.5 rounded text-[9px] bg-white/5 text-[var(--color-text-muted)] shrink-0">off</span>
                            )}
                          </div>
                          <div className="text-[10px] text-[var(--color-text-muted)] truncate font-mono">
                            {t.cli_type} · {t.cron || 'manual'}
                          </div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); runTask(t); }}
                          disabled={busy}
                          className="p-1.5 rounded hover:bg-white/10 text-green-400 active:bg-white/15 disabled:opacity-50 shrink-0"
                          title="Run now"
                        >
                          {busy
                            ? <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M4 12a8 8 0 0 1 8-8"/></svg>
                            : <IconPlay />
                          }
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Docker and Tools — component sub-groups inside Workspace.
                Reuses the same componentSections + toggleSection state so
                collapse memory is shared with any top-level categories. */}
            {['Docker', 'Tools'].map(cat => {
              const items = grouped[cat];
              if (!items || items.length === 0) return null;
              const open = !!componentSections[cat];
              const running = items.filter(c => c.status === 'running').length;
              return (
                <div key={cat}>
                  <button
                    type="button"
                    onClick={() => toggleSection(cat)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] active:bg-white/5"
                  >
                    <IconChevron open={open} />
                    <span className="text-[13px] font-medium flex-1 text-left">{cat}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      {running}/{items.length}
                    </span>
                  </button>
                  {open && (
                    <div className="mt-1 grid grid-cols-1 gap-1.5">
                      {items.sort((a, b) => a.key.localeCompare(b.key)).map(comp => (
                        <MobileComponentCard key={comp.key} comp={comp}
                          onOpenLog={() => onOpenWindow('log', comp.key)} onAction={onAction} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        )}
      </div>

    </div>
  );
}


// Small icon-only launcher used in the mobile top bar.  Wraps a status
// dot + an SVG glyph; tapping fires `onClick`.  Distinct from
// MobileAppCard which is the larger dashboard card variant.
function MobileAppLauncher({ title, status, onClick, children }) {
  return (
    <button
      onClick={onClick}
      title={`${title} · ${status}`}
      className="relative px-2 py-1 rounded bg-white/5 text-[var(--color-text-muted)] active:bg-white/10 inline-flex items-center"
    >
      {children}
      {/* Status pip in the lower-right corner of the icon.  Sized small so
          the SVG inside the button stays the visual anchor. */}
      <span
        className={`absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
          status === 'running' ? 'bg-[var(--color-status-running)]'
          : status === 'boot' ? 'bg-[var(--color-status-boot)] animate-pulse'
          : 'bg-[var(--color-status-off)]'
        }`}
      />
    </button>
  );
}

// Larger dashboard card used in the Apps section. Shows the icon, label,
// description and a status dot; tapping the body opens the app. Launch-only
// (2026-09-01, mobile-apps-menu design Decision E) — Start/Restart/Stop moved
// onto the open-app chrome (see the DockerControls wired into the activeWindow
// header above), since a Restart button inside a scrolling tap-to-open row is
// a mis-tap waiting to happen on touch, and "refresh the frame" only means
// anything once the frame exists. A stopped app still starts on tap via the
// existing background auto-start (see startIfOff). `status` may be null for
// apps with no associated component — in that case the dot is omitted.
function MobileAppCard({ label, description, status, onOpen, icon, iconClass = '' }) {
  const hasComponent = status !== null && status !== undefined;
  return (
    <div
      className="flex items-center justify-between px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] active:bg-white/5"
      onClick={onOpen}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`shrink-0 ${iconClass}`}>{icon}</div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium truncate flex items-center gap-1.5">
            {label}
            {hasComponent && <StatusDot status={status} />}
          </div>
          {description && <div className="text-[10px] text-[var(--color-text-muted)] truncate">{description}</div>}
        </div>
      </div>
    </div>
  );
}

function MobileComponentCard({ comp, onOpenLog, onAction }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] active:bg-white/5"
      onClick={onOpenLog}>
      <div className="flex items-center gap-2.5 min-w-0">
        <StatusDot status={comp.status} />
        <div className="min-w-0">
          <div className="text-[13px] font-medium truncate">{comp.key}</div>
          {comp.port && <div className="text-[10px] text-[var(--color-text-muted)]">:{comp.port}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {comp.status === 'off' ? (
          <button onClick={(e) => { e.stopPropagation(); onAction(comp.key, 'start'); }}
            className="px-3 py-1 text-[11px] rounded bg-[var(--color-status-running)]/15 text-[var(--color-status-running)] active:bg-[var(--color-status-running)]/25">Start</button>
        ) : (
          <>
            <button onClick={(e) => { e.stopPropagation(); onAction(comp.key, 'restart'); }}
              className="px-2.5 py-1 text-[11px] rounded bg-[var(--color-status-boot)]/15 text-[var(--color-status-boot)] active:bg-[var(--color-status-boot)]/25">Restart</button>
            <button onClick={(e) => { e.stopPropagation(); onAction(comp.key, 'stop'); }}
              className="px-2.5 py-1 text-[11px] rounded bg-[var(--color-danger)]/15 text-[var(--color-danger)] active:bg-[var(--color-danger)]/25">Stop</button>
          </>
        )}
      </div>
    </div>
  );
}

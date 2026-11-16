import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { apiFetch, wsUrl, isAuthWsClose, notifyWsAuthFailed } from '../auth';
import {
  attachHardwareKeyboardBridge,
  isKbdFocusProxy,
  shouldAttachHardwareKeyboardBridge,
} from '../lib/hardwareKeyboardBridge';
import { onSuppressKbdChange } from '../lib/keyboardMode';
import { getInsecureTooltip, supportsInsecureMode } from '../lib/agentClis';
import {
  extractClipboardImageFiles,
  readClipboardImageBlobs,
  uploadTerminalImage,
} from '../lib/terminalClipboardImage';

const API_BASE = '';

export default function TerminalWindow({ sessionId, name, onClose, onMinimize, onMaximize, isMaximized, windowKey, onRename, agentType, isClaude: isCladeProp, isCopilot: isCopilotProp, onSessionSwitch, activeSessionId, insecure, onToggleInsecure, reconnectSignal, minimal, chromeless, onData, onExit }) {
  // `chromeless` hides the header chrome (rename / picker / pop-out / close)
  // but keeps the terminal interactive — used when an outer panel (e.g.
  // PlansPanel) owns the chrome and just wants the xterm pane embedded.
  // Distinct from `minimal` which is the read-only "automation terminal"
  // mode that also disables keystroke forwarding.
  const hideHeader = !!chromeless || !!minimal;
  const readOnly   = !!minimal;
  // Derive agent type booleans — agentType prop takes precedence over legacy isClaude/isCopilot booleans
  const isClaude = agentType ? agentType === 'claude' : !!isCladeProp;
  const isCopilot = agentType ? agentType === 'copilot' : !!isCopilotProp;
  const isCursor = agentType === 'cursor';
  const isCodex = agentType === 'codex';
  const isGemini = agentType === 'gemini';
  const isAntigravity = agentType === 'antigravity';
  const isOpenCode = agentType === 'opencode';
  const isAgent = !!(agentType) || !!isCladeProp || !!isCopilotProp;
  const effectiveAgentType = agentType || (isClaude ? 'claude' : isCopilot ? 'copilot' : null);
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const lastImagePasteTsRef = useRef(0);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name || '');

  // Sync editName whenever the name prop changes from outside (e.g. a rename
  // broadcast arriving from another browser window).  Only applies when not
  // actively typing — we don't want to stomp over the user's in-progress edit.
  useEffect(() => {
    if (!editing) setEditName(name || '');
  }, [name, editing]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 });
  const pickerAnchorRef = useRef(null);
  const [claudeSessions, setClaudeSessions] = useState([]);
  const [reconnectKey, setReconnectKey] = useState(0);
  const reconnectAttemptsRef = useRef(0);
  const wsRef = useRef(null);
  const fitRef = useRef(null);
  const searchRef = useRef(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);
  // Live list of processes running inside this terminal's screen session
  const [procs, setProcs] = useState([]);
  const [procsOpen, setProcsOpen] = useState(false);
  const [procsPos, setProcsPos] = useState({ top: 0, left: 0 });
  const procsAnchorRef = useRef(null);

  // One-shot fetch of the running-process list — used to warm the badge on
  // mount and to refresh instantly after an explicit action (open / kill).
  // Steady-state updates arrive via the ProcsWatchdog push (see below), so
  // there is no polling loop. Skipped in header-less modes (minimal /
  // chromeless) where the badge isn't rendered.
  const fetchProcs = useCallback(() => {
    apiFetch(`${API_BASE}/api/terminals/${sessionId}/procs`)
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.procs)) setProcs(d.procs); })
      .catch(() => {});
  }, [sessionId]);

  // Live process list is pushed by the backend ProcsWatchdog over /ws/status
  // every 5s (one ps snapshot for all sessions), routed here as
  // `aw-procs-update` keyed by session id. We warm the badge once on mount and
  // then let the push keep it fresh — no per-window polling.
  useEffect(() => {
    if (hideHeader) return;
    fetchProcs();
    const onProcs = (e) => {
      const map = e.detail?.procs;
      if (map && Object.prototype.hasOwnProperty.call(map, sessionId)) {
        setProcs(map[sessionId] || []);
      }
    };
    window.addEventListener('aw-procs-update', onProcs);
    return () => window.removeEventListener('aw-procs-update', onProcs);
  }, [hideHeader, sessionId, fetchProcs]);

  const killProc = useCallback((pid) => {
    apiFetch(`${API_BASE}/api/terminals/${sessionId}/procs/${pid}/kill`, { method: 'POST' })
      .then(() => setTimeout(fetchProcs, 300))
      .catch(() => {});
  }, [sessionId, fetchProcs]);

  // Fit terminal to container — debounced
  const fitTimeout = useRef(null);
  const doFit = useCallback(() => {
    clearTimeout(fitTimeout.current);
    fitTimeout.current = setTimeout(() => {
      const fit = fitRef.current;
      const ws = wsRef.current;
      if (!fit) return;
      try {
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
        }
      } catch { /* container not visible yet */ }
    }, 50);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !sessionId) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
      scrollback: 10000,
      scrollOnOutput: minimal === true,  // auto-scroll only for automation terminal
      allowProposedApi: true,
      theme: {
        background: '#000000',
        foreground: '#e2e8f0',
        cursor: '#e2e8f0',
        selectionBackground: '#3b3b5c',
        black: '#4b5563',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#6b7280',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;
    searchRef.current = searchAddon;

    // Disable iOS autocorrect / smart-substitution on xterm's hidden
    // textarea. xterm sets these in most versions, but iOS with a
    // hardware keyboard can still fire text replacements (e.g. ~ → ˜).
    // Belt-and-suspenders: set them explicitly after open().
    if (term.textarea) {
      term.textarea.setAttribute('autocorrect', 'off');
      term.textarea.setAttribute('autocapitalize', 'off');
      term.textarea.setAttribute('autocomplete', 'off');
      term.textarea.setAttribute('spellcheck', 'false');
      term.textarea.setAttribute('data-gramm', 'false'); // Grammarly
    }

    // ─── Cmd/Ctrl+C copy from selection ───────────────────────────
    // xterm renders into a hidden helper <textarea> with no real text,
    // so the browser's native Cmd+C has nothing to copy — the visible
    // selection lives in xterm's own presentation/DOM. We must copy it
    // ourselves. This is the iPad-with-hardware-keyboard path: Safari
    // there reports Command as e.metaKey (NOT ctrlKey), so a handler
    // that only checks ctrlKey/Ctrl+Shift+C never fires on iPad.
    //
    // navigator.clipboard.writeText needs a secure context and can
    // reject, so we fall back to document.execCommand('copy') via a
    // throwaway textarea. Wrapped in try/catch — copy failure must
    // never crash the keystroke path.
    const copySelectionToClipboard = (text) => {
      if (!text) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(() => execCommandCopy(text));
        } else {
          execCommandCopy(text);
        }
      } catch {
        execCommandCopy(text);
      }
    };
    const execCommandCopy = (text) => {
      // This focuses a real, editable textarea — a textbook keyboard-raiser
      // on iPhone, and removing the node afterwards does not reliably
      // dismiss it. In bridge mode a failed copy is a smaller regression
      // than a keyboard that will not go away — skip the fallback entirely.
      if (shouldAttachHardwareKeyboardBridge()) return;
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* clipboard unavailable — surface nothing */ }
    };

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const key = (e.key || '').toLowerCase();
      // Cmd+C (iPad/Mac, e.metaKey): unambiguous copy. If there is a
      // selection, copy it and swallow so it isn't forwarded as ^C.
      // With no selection, let it pass through (harmless).
      if (key === 'c' && e.metaKey && !e.ctrlKey) {
        if (term.hasSelection()) {
          copySelectionToClipboard(term.getSelection());
          return false;
        }
        return true;
      }
      // Ctrl+C is overloaded: copy only when something is selected,
      // otherwise let it through so it still sends SIGINT to the PTY.
      if (key === 'c' && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        if (term.hasSelection()) {
          copySelectionToClipboard(term.getSelection());
          term.clearSelection();
          return false;
        }
        return true;
      }
      // Ctrl+V in agent CLIs (Claude Code / Codex / Antigravity on macOS):
      // On macOS, Cmd+V triggers the browser's `paste` event (handled via
      // onPasteCapture), whereas Ctrl+V only fires keydown and would send
      // raw ^V (\x16) to the remote container PTY (which cannot read the
      // client's local clipboard). Check the browser clipboard for an image
      // first; if none is present, forward \x16 to the PTY as usual.
      const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);
      if (!readOnly && isAgent && isMac && key === 'v' && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.read === 'function') {
          if (Date.now() - lastImagePasteTsRef.current < 200) return false;
          lastImagePasteTsRef.current = Date.now();
          readClipboardImageBlobs(navigator.clipboard).then(async (blobs) => {
            const curWs = wsRef.current;
            if (!curWs || curWs.readyState !== WebSocket.OPEN) return;
            if (blobs.length > 0) {
              for (const blob of blobs) {
                const uploadedPath = await uploadTerminalImage(blob, { fetchImpl: apiFetch, apiBase: API_BASE });
                if (uploadedPath && curWs.readyState === WebSocket.OPEN) {
                  curWs.send(new TextEncoder().encode(uploadedPath + ' '));
                }
              }
            } else {
              curWs.send(new TextEncoder().encode('\x16'));
            }
          }).catch(() => {});
          return false;
        }
      }
      return true;
    });

    // iPad-desktop-UA workaround: hide the iOS keyboard accessory bar that
    // appears whenever xterm's hidden textarea gains focus. inputmode="none"
    // tells iOS "editable but no on-screen keyboard," which also removes the
    // accessory bar. Hardware keyboard input is unaffected.
    // Narrowed to iPad-only: iPhone with "Request Desktop Website" also
    // sends a Macintosh UA and reports maxTouchPoints > 1, which used to
    // match this branch and apply inputmode="none" — that breaks hardware
    // keyboard input on iPhone (WebKit bug 193811). The screen-shortest-side
    // guard (>=600px) cleanly excludes iPhone (Pro Max short side ~430px)
    // while still including all iPads (mini short side 744px).
    const isIPadDesktopMode =
      typeof navigator !== 'undefined' &&
      typeof window !== 'undefined' &&
      navigator.maxTouchPoints > 1 &&
      /Macintosh/.test(navigator.userAgent) &&
      Math.min(window.screen.width, window.screen.height) >= 600;
    if (isIPadDesktopMode && term.textarea) {
      term.textarea.setAttribute('inputmode', 'none');
    }

    // iPhone: inputmode="none" is a no-op there (WebKit 193811), so the only
    // way to keep the soft keyboard down is to never focus an editable
    // element. The bridge parks focus on a non-editable div and re-dispatches
    // keydowns into xterm — see lib/hardwareKeyboardBridge.js. It gates itself
    // on the top-bar toggle and on iPhone-class screens, and is a no-op
    // everywhere else, so this is unconditional here. Re-attach when the
    // toggle flips so it takes effect without reopening the terminal.
    let detachKbdBridge = attachHardwareKeyboardBridge(term, containerRef.current);
    const offSuppressKbd = onSuppressKbdChange(() => {
      detachKbdBridge();
      detachKbdBridge = attachHardwareKeyboardBridge(term, containerRef.current);
    });

    // ─── Mobile control bridge ─────────────────────────────────────
    // External controls (the floating PgUp/PgDn buttons in
    // MobileTerminalView) talk to this xterm instance via a
    // window-level CustomEvent keyed on sessionId.  This avoids
    // passing the term ref through React props/context and keeps
    // TerminalWindow self-contained.
    //
    // Copy-from-selection is intentionally NOT in this bridge — the
    // phone's native selection menu (iOS / Android) handles copy on
    // top of xterm's accessibility tree, so a custom Copy command is
    // unnecessary.
    const onTermCmd = (e) => {
      if (e.detail?.sessionId !== sessionId) return;
      const action = e.detail.action;
      if (action === 'scroll-up') term.scrollLines(-5);
      else if (action === 'scroll-down') term.scrollLines(5);
      else if (action === 'scroll-page-up') term.scrollPages(-1);
      else if (action === 'scroll-page-down') term.scrollPages(1);
      else if (action === 'scroll-top') term.scrollToTop();
      else if (action === 'scroll-bottom') term.scrollToBottom();
    };
    window.addEventListener('aw-term-cmd', onTermCmd);

    // Initial fit after a tick (container must have dimensions)
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* container hidden */ }
    });

    // Connect WebSocket
    const ws = new WebSocket(wsUrl(`/ws/terminal/${sessionId}`));
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    let intentionalClose = false;
    // Only forgive past reconnect attempts once the socket has proven it can
    // stay open for a bit — resetting the counter the instant `onopen` fires
    // (the old behaviour) let a socket that opens and immediately closes
    // again reconnect forever, because the counter never got the chance to
    // reach the give-up threshold below. A flapping connection (server
    // rejecting/dropping it right away) would then hammer the endpoint with
    // a new WebSocket every ~1-2s indefinitely instead of ever giving up.
    let stableTimer = null;
    console.debug('[DUPDBG] ws-construct', sessionId, 'reconnectKey=', reconnectKey, 't=', performance.now());

    ws.onopen = () => {
      console.debug('[DUPDBG] ws-open', sessionId, 't=', performance.now());
      stableTimer = setTimeout(() => { reconnectAttemptsRef.current = 0; }, 4000);
      try {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
        }
      } catch {}
      // ─── On-screen keyboard fast path ─────────────────────────
      // Register a synchronous send callback so TerminalKeyboard
      // (and any other in-app input source) can route keystrokes
      // through this open WebSocket instead of POSTing to
      // /api/terminals/{id}/write per keypress.
      //
      // Why this matters: each HTTP write is a separate request,
      // and on a flaky mobile connection requests can arrive
      // OUT OF ORDER at the server — meaning "abc" typed quickly
      // arrives at the PTY as "bac" or "acb", or one request
      // fails silently and the key appears dropped.  The WS is
      // ordered and already-open, so sends are ~5ms and in order.
      //
      // We attach to a window-level registry keyed by sessionId
      // (rather than React context) so popped-out terminal
      // windows and the embedded MobileApp keyboard can both
      // find it without prop drilling.
      if (typeof window !== 'undefined') {
        window.__awTermSend = window.__awTermSend || {};
        window.__awTermSend[sessionId] = (text) => {
          if (ws.readyState !== WebSocket.OPEN) return false;
          const bytes = new TextEncoder().encode(text);
          if (bytes.length <= CHUNK_SIZE) ws.send(bytes);
          else sendChunked(bytes);
          return true;
        };
      }
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const preview = new TextDecoder().decode(event.data).slice(0, 40);
        console.debug('[DUPDBG] ws-message', sessionId, 'len=', event.data.byteLength, 'preview=', JSON.stringify(preview), 't=', performance.now());
        term.write(new Uint8Array(event.data));
        if (onData) onData(new TextDecoder().decode(event.data));
      } else {
        console.debug('[DUPDBG] ws-message-text', sessionId, 'len=', event.data.length, 'preview=', JSON.stringify(event.data.slice(0, 40)), 't=', performance.now());
        term.write(event.data);
        if (onData) onData(event.data);
      }
    };

    ws.onclose = (event) => {
      console.debug('[DUPDBG] ws-close', sessionId, 'intentional=', intentionalClose, 'code=', event.code, 't=', performance.now());
      clearTimeout(stableTimer);
      if (intentionalClose) return;
      // A bad/expired token gets 4401 forever — retrying just hot-loops
      // silently against the auth wall for up to 8 attempts before finally
      // giving up with a misleading "session ended". Skip straight to
      // giving up, with the real reason, and surface it globally.
      if (isAuthWsClose(event.code)) {
        term.write('\r\n\x1b[90m[session expired — log in again]\x1b[0m\r\n');
        notifyWsAuthFailed();
        if (onExit) onExit();
        return;
      }
      // Auto-reconnect — handles restarts triggered from other browsers.
      // Back off: 1s, 2s, 3s... Give up after 8 attempts.
      if (reconnectAttemptsRef.current < 8) {
        reconnectAttemptsRef.current += 1;
        const delay = Math.min(reconnectAttemptsRef.current * 1000, 3000);
        console.debug('[DUPDBG] ws-reconnect-scheduled', sessionId, 'attempt=', reconnectAttemptsRef.current, 'delay=', delay);
        setTimeout(() => setReconnectKey((k) => k + 1), delay);
      } else {
        term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
        if (onExit) onExit();
      }
    };

    // Forward keystrokes
    // Chunked send for large pastes — prevents PTY buffer overflow.
    // PTY input buffers are ~4KB on macOS, and shells (bash/zsh) have
    // even smaller readline limits. Send in small chunks with delays.
    const CHUNK_SIZE = 64;
    const CHUNK_DELAY = 5; // ms between chunks
    let sendQueue = Promise.resolve();

    const sendChunked = (bytes) => {
      if (bytes.length <= CHUNK_SIZE) {
        ws.send(bytes);
        return;
      }
      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        const chunk = bytes.slice(i, i + CHUNK_SIZE);
        sendQueue = sendQueue.then(() => new Promise((resolve) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
          setTimeout(resolve, CHUNK_DELAY);
        }));
      }
    };

    // Forward keystrokes (disabled for `minimal` automation-terminal mode
    // — that one is intentionally output-only. `chromeless` keeps input.)
    if (!readOnly) {
      term.onData((data) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        // Translate iOS typographic substitutions that slip past
        // autocorrect="off". The hardware keyboard on iPad can still
        // trigger OS-level text replacements before the browser sees the
        // key. Map each smart char to its ASCII shell equivalent so the
        // PTY never receives garbage (˜ instead of ~, smart quotes, etc.).
        const mapped = data
          .replace(/˜/g, '~')   // ˜ SMALL TILDE (iOS ~ replacement)
          .replace(/‘/g, "'")   // ' LEFT SINGLE QUOTE
          .replace(/’/g, "'")   // ' RIGHT SINGLE QUOTE
          .replace(/“/g, '"')   // " LEFT DOUBLE QUOTE
          .replace(/”/g, '"')   // " RIGHT DOUBLE QUOTE
          .replace(/–/g, '-')   // – EN DASH
          .replace(/—/g, '--'); // — EM DASH
        const encoded = new TextEncoder().encode(mapped);
        console.debug('[DUPDBG] term-onData', sessionId, 'raw=', JSON.stringify(data), 'len=', encoded.length, 't=', performance.now());
        if (encoded.length <= CHUNK_SIZE) {
          ws.send(encoded);
        } else {
          sendChunked(encoded);
        }
      });
    }

    term.onBinary((data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i) & 0xff;
      }
      if (bytes.length <= CHUNK_SIZE) {
        ws.send(bytes.buffer);
      } else {
        sendChunked(bytes.buffer);
      }
    });

    // Resize observer on the container
    const resizeObserver = new ResizeObserver(() => doFit());
    resizeObserver.observe(containerRef.current);

    term.focus();

    return () => {
      clearTimeout(fitTimeout.current);
      clearTimeout(stableTimer);
      resizeObserver.disconnect();
      window.removeEventListener('aw-term-cmd', onTermCmd);
      offSuppressKbd();
      detachKbdBridge();
      // Deregister the fast-path send callback so a later HTTP
      // fallback knows the socket is gone.  Done before ws.close()
      // so any in-flight keystroke from the on-screen keyboard
      // routes through HTTP instead of a half-closed socket.
      if (typeof window !== 'undefined' && window.__awTermSend) {
        delete window.__awTermSend[sessionId];
      }
      intentionalClose = true;
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId, doFit, reconnectKey]);

  // External reconnect signal (e.g. insecure toggle from another browser, or
  // server restart detected by useComponentStatus).  Reset the retry counter
  // so the WebSocket is allowed to reconnect even if it previously exhausted
  // all 8 automatic attempts while the server was down.
  const prevSignalRef = useRef(reconnectSignal);
  useEffect(() => {
    if (reconnectSignal !== prevSignalRef.current) {
      console.debug('[DUPDBG] external-reconnect-signal', sessionId, 'from=', prevSignalRef.current, 'to=', reconnectSignal, 't=', performance.now());
      prevSignalRef.current = reconnectSignal;
      reconnectAttemptsRef.current = 0;
      setTimeout(() => setReconnectKey((k) => k + 1), 500);
    }
  }, [reconnectSignal]);

  // Search functionality — yellow highlight matching LogWindow's search-hit style
  const searchOpts = {
    caseSensitive: false,
    regex: false,
    decorations: {
      matchBackground: '#3A2D02',
      matchBorder: '#EAB308',
      matchOverviewRuler: '#EAB308',
      activeMatchBackground: '#A47D06',
      activeMatchBorder: '#EAB308',
      activeMatchColorOverviewRuler: '#EAB308',
    },
  };

  const doSearch = useCallback((query, direction = 'next') => {
    const addon = searchRef.current;
    if (!addon || !query) return;
    if (direction === 'next') {
      addon.findNext(query, searchOpts);
    } else {
      addon.findPrevious(query, searchOpts);
    }
  }, []);

  const toggleSearch = useCallback(() => {
    if (searchVisible) {
      setSearchVisible(false);
      setSearchQuery('');
      searchRef.current?.clearDecorations();
      termRef.current?.focus();
    } else {
      setSearchVisible(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [searchVisible]);

  // Keyboard shortcut: Cmd+F to toggle search
  useEffect(() => {
    const el = containerRef.current?.closest('.terminal-window');
    if (!el) return;
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        toggleSearch();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && !isAgent) {
        e.preventDefault();
        e.stopPropagation();
        termRef.current?.clear();
      }
      if (e.key === 'Escape' && searchVisible) {
        setSearchVisible(false);
        setSearchQuery('');
        searchRef.current?.clearDecorations();
        termRef.current?.focus();
      }
      // Ctrl+C fallback for iPad hardware-keyboard (and any case where a
      // header button / picker stole focus away from xterm's textarea).
      // xterm's attachCustomKeyEventHandler only fires when the hidden
      // textarea is the active element; if focus is on a button or the
      // outer container div, the SIGINT never reaches the PTY.
      // Guard: only act when xterm's own textarea does NOT have focus, so
      // we never double-send when xterm is already handling the event. In
      // keyboard-suppressed mode the textarea is *never* focused — the
      // hardware-keyboard bridge parks focus on a non-editable proxy and
      // forwards the keystroke into xterm itself — so the proxy counts as
      // "xterm has focus" here too, otherwise every Ctrl+C sends two SIGINTs.
      // `e.key` can be undefined for some iOS hardware-key events.
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && (e.key || '').toLowerCase() === 'c') {
        const term = termRef.current;
        const ws = wsRef.current;
        const active = document.activeElement;
        if (term && active !== term.textarea && !isKbdFocusProxy(active)) {
          if (term.hasSelection()) {
            const text = term.getSelection();
            try { navigator.clipboard?.writeText(text).catch(() => {}); } catch {}
            term.clearSelection();
          } else if (!readOnly && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(new TextEncoder().encode('\x03'));
          }
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    el.addEventListener('keydown', handleKeyDown, true);
    return () => el.removeEventListener('keydown', handleKeyDown, true);
  }, [searchVisible, toggleSearch]);

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      setSearchVisible(false);
      setSearchQuery('');
      searchRef.current?.clearDecorations();
      termRef.current?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      doSearch(searchQuery, e.shiftKey ? 'prev' : 'next');
    }
  };

  // Update search when query changes
  useEffect(() => {
    if (searchQuery) {
      doSearch(searchQuery, 'next');
    } else {
      searchRef.current?.clearDecorations();
    }
  }, [searchQuery, doSearch]);

  // Drag & drop files (Claude only) — upload to server, paste path into PTY
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (!isAgent || !e.dataTransfer.files.length) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    for (const file of e.dataTransfer.files) {
      const uploadedPath = await uploadTerminalImage(file, {
        fetchImpl: apiFetch,
        apiBase: API_BASE,
        filename: file.name || undefined,
      });
      if (uploadedPath && ws.readyState === WebSocket.OPEN) {
        // Type the file path into the terminal
        ws.send(new TextEncoder().encode(uploadedPath + ' '));
      }
    }
    termRef.current?.focus();
  }, [isAgent]);

  const handleDragOver = useCallback((e) => {
    if (!isAgent) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, [isAgent]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  // Clipboard image paste (Cmd+V / Ctrl+V / context-menu Paste) — intercept
  // image items in capture phase before xterm.js ignores them, upload to
  // `/api/terminals/upload`, and write the server-side file path into the PTY.
  const handlePasteCapture = useCallback(async (e) => {
    if (readOnly) return;
    const imageFiles = extractClipboardImageFiles(e.clipboardData);
    if (!imageFiles.length) return;
    e.preventDefault();
    e.stopPropagation();
    lastImagePasteTsRef.current = Date.now();
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    for (const file of imageFiles) {
      const uploadedPath = await uploadTerminalImage(file, { fetchImpl: apiFetch, apiBase: API_BASE });
      if (uploadedPath && ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(uploadedPath + ' '));
      }
    }
    termRef.current?.focus();
  }, [readOnly]);

  return (
    <div
      className={`terminal-window flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border ${insecure ? 'border-[var(--color-danger)]/50' : dragOver ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}
      tabIndex={0}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onPasteCapture={handlePasteCapture}
    >
      {/* Header — hidden in minimal (read-only automation) and chromeless
          (outer panel owns the chrome) modes. Cmd+F search still works. */}
      {hideHeader ? null : (
      <div
        className="drag-handle flex items-center justify-between px-3 py-[3px] bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0"
        // Double-click on the title bar's blank space toggles maximize/restore
        // (same behavior as the [ ] button).
        //
        // Why mousedown + e.detail instead of onDoubleClick:
        //   react-rnd's drag layer calls preventDefault on mousedown to
        //   start tracking a potential drag. That suppresses the synthetic
        //   `click`/`dblclick` event chain entirely — onDoubleClick never
        //   fires on the drag-handle. The browser still increments
        //   MouseEvent.detail (1, 2, 3…) for consecutive clicks within
        //   the platform's double-click window, so detecting detail===2
        //   on mousedown gives us reliable dblclick semantics regardless
        //   of what react-rnd does downstream.
        //
        // The two inner rows below stop propagation on mousedown (already
        // there for the drag layer) AND we additionally guard here by
        // checking e.target === e.currentTarget so this only fires when
        // the click actually lands on the bar itself.
        onMouseDown={(e) => {
          if (e.detail === 2 && e.target === e.currentTarget && onMaximize) {
            onMaximize(windowKey);
          }
        }}
      >
        <div
          className="flex items-center gap-2 min-w-0 relative no-drag"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {isClaude ? (
            <svg className="w-3.5 h-3.5 text-[#d97706] shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z" />
            </svg>
          ) : isCopilot ? (
            <svg className="w-3.5 h-3.5 text-[#2ea043] shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
            </svg>
          ) : isCursor ? (
            <svg className="w-3.5 h-3.5 text-[#7c3aed] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 3l14 9-14 9V3z" />
            </svg>
          ) : isCodex ? (
            <svg className="w-3.5 h-3.5 text-[#0ea5e9] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3l7.5 4.25v8.5L12 20l-7.5-4.25v-8.5L12 3z" />
              <path d="M8.5 9.5L12 7.5l3.5 2v5L12 16.5l-3.5-2v-5z" />
            </svg>
          ) : isGemini ? (
            <svg className="w-3.5 h-3.5 text-[#4796E3] shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z" />
            </svg>
          ) : isAntigravity ? (
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2.5c.7 5.3 4.2 8.8 9.5 9.5-5.3.7-8.8 4.2-9.5 9.5-.7-5.3-4.2-8.8-9.5-9.5 5.3-.7 8.8-4.2 9.5-9.5Z" fill="#4285F4" />
              <path d="M12 2.5c.7 5.3 4.2 8.8 9.5 9.5H12V2.5Z" fill="#34A853" />
              <path d="M12 12h9.5c-5.3.7-8.8 4.2-9.5 9.5V12Z" fill="#FBBC04" />
              <path d="M2.5 12H12v9.5c-.7-5.3-4.2-8.8-9.5-9.5Z" fill="#EA4335" />
            </svg>
          ) : isOpenCode ? (
            <svg className="w-3.5 h-3.5 text-[#14b8a6] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="OpenCode">
              <path d="M8 7l-5 5 5 5" />
              <path d="M16 7l5 5-5 5" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          )}
          {isAgent ? (
            <>
              {editing ? (
                <input
                  autoFocus
                  data-allow-focus="true"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => { setEditing(false); if (editName.trim() && editName !== name) onRename?.(sessionId, editName.trim()); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { setEditing(false); if (editName.trim() && editName !== name) onRename?.(sessionId, editName.trim()); }
                    if (e.key === 'Escape') { setEditing(false); setEditName(name || ''); }
                    e.stopPropagation();
                  }}
                  className="font-semibold text-[15px] text-[var(--color-text-primary)] bg-[var(--color-bg-primary)] border border-[var(--color-accent)] rounded px-1 py-0 outline-none w-40"
                />
              ) : (
                <>
                  <button
                    ref={pickerAnchorRef}
                    className={`font-semibold text-[15px] truncate flex items-center gap-1 hover:text-[var(--color-accent)] transition-colors ${insecure ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-primary)]'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (pickerOpen) {
                        setPickerOpen(false);
                      } else {
                        const rect = pickerAnchorRef.current?.getBoundingClientRect();
                        if (rect) setPickerPos({ top: rect.bottom + 4, left: rect.left });
                        setClaudeSessions([]);
                        setPickerOpen(true);
                        apiFetch(`${API_BASE}/api/apps/code-agent-clis/agent-sessions?type=${agentType || 'claude'}`).then((r) => r.json()).then(setClaudeSessions);
                      }
                    }}
                    title={
                      isCopilot ? 'Switch Copilot session' :
                      isCursor ? 'Switch Cursor session' :
                      isCodex ? 'Switch Codex session' :
                      isGemini ? 'Switch Gemini session' :
                      isAntigravity ? 'Switch Antigravity session' :
                      isOpenCode ? 'Switch OpenCode session' :
                      'Switch Claude session'
                    }
                  >
                    {name || sessionId}
                    <svg className={`w-3 h-3 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditing(true); setEditName(name || ''); }}
                    className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
                    title="Rename"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                  </button>
                </>
              )}
              {pickerOpen && createPortal(
                <div
                  className="fixed w-96 max-h-72 overflow-y-auto bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl shadow-black/60"
                  style={{ top: pickerPos.top, left: pickerPos.left, zIndex: 99999 }}
                >
                  {/* New session — always first */}
                  <button
                    className="w-full text-left px-3 py-2 text-xs text-[var(--color-accent)] hover:bg-white/5 border-b border-[var(--color-border)] flex items-center gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPickerOpen(false);
                      onSessionSwitch?.(sessionId, null, null);
                      setTimeout(() => setReconnectKey((k) => k + 1), 500);
                    }}
                  >
                    <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                    New session
                  </button>
                  {claudeSessions.map((s) => {
                    const isActive = activeSessionId && s.session_id === activeSessionId;
                    // screen_alive = a live terminal in ANOTHER window already holds this session
                    const inUse = s.screen_alive && !isActive;
                    const displayName = isActive ? (name || s.name) : s.name;
                    return (
                      <button
                        key={s.session_id}
                        className={`w-full text-left px-3 py-2 hover:bg-white/5 transition-colors border-b border-[var(--color-border)] last:border-0 ${isActive ? 'bg-[var(--color-accent)]/10' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPickerOpen(false);
                          if (inUse) {
                            // Session is already open in another window — just notify, don't switch.
                            window.dispatchEvent(new CustomEvent('aw-notification', {
                              detail: { level: 'error', title: 'Session already open', message: 'This session is already open in another window. Close it there first.' },
                            }));
                            return;
                          }
                          onSessionSwitch?.(sessionId, s.session_id, isActive ? name : s.name);
                          setTimeout(() => setReconnectKey((k) => k + 1), 500);
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          {isActive
                            ? <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] shrink-0" />
                            : inUse
                              ? <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] shrink-0 opacity-60" />
                              : <span className="w-1.5 h-1.5 shrink-0" />}
                          <div className="text-xs font-medium text-[var(--color-text-primary)] truncate">{displayName}</div>
                          {isActive && <span className="text-[10px] text-[var(--color-accent)] shrink-0 ml-auto">active</span>}
                          {inUse && <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 ml-auto opacity-70">in use</span>}
                        </div>
                        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 pl-3 truncate">
                          {s.session_id.slice(0, 8) + '… ' + (s.updated_at ? new Date(s.updated_at * 1000).toLocaleDateString() : '')}
                        </div>
                      </button>
                    );
                  })}
                  {claudeSessions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-[var(--color-text-muted)]">No sessions found</div>
                  )}
                </div>,
                document.body
              )}
            </>
          ) : editing ? (
            <input
              autoFocus
              data-allow-focus="true"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => { setEditing(false); if (editName.trim() && editName !== name) onRename?.(sessionId, editName.trim()); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { setEditing(false); if (editName.trim() && editName !== name) onRename?.(sessionId, editName.trim()); }
                if (e.key === 'Escape') { setEditing(false); setEditName(name || ''); }
                e.stopPropagation();
              }}
              className="font-semibold text-[15px] text-[var(--color-text-primary)] bg-[var(--color-bg-primary)] border border-[var(--color-accent)] rounded px-1 py-0 outline-none w-40"
            />
          ) : (
            <span
              className="font-semibold text-[15px] text-[var(--color-text-primary)] truncate cursor-text"
              onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditName(name || ''); }}
              title="Double-click to rename"
            >
              {name || sessionId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 no-drag" onMouseDown={(e) => e.stopPropagation()}>
          {/* Procs badge — processes running inside this terminal's screen session */}
          <button
            ref={procsAnchorRef}
            onClick={(e) => {
              e.stopPropagation();
              if (procsOpen) {
                setProcsOpen(false);
              } else {
                const rect = procsAnchorRef.current?.getBoundingClientRect();
                if (rect) setProcsPos({ top: rect.bottom + 4, left: rect.left });
                fetchProcs();
                setProcsOpen(true);
              }
            }}
            className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors bg-white/5 text-[var(--color-text-muted)] hover:bg-white/10 flex items-center gap-1"
            title="Processes running in this terminal"
          >
            Procs
            <span className={`px-1 rounded-full text-[9px] leading-none py-0.5 ${procs.length > 0 ? 'bg-[var(--color-accent)]/30 text-[var(--color-accent)]' : 'bg-white/10 text-[var(--color-text-muted)]'}`}>
              {procs.length}
            </span>
          </button>
          {procsOpen && createPortal(
            <>
              <div className="fixed inset-0" style={{ zIndex: 99998 }} onClick={() => setProcsOpen(false)} />
              <div
                className="fixed w-80 max-h-72 overflow-y-auto bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl shadow-black/60"
                style={{ top: procsPos.top, left: procsPos.left, zIndex: 99999 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] border-b border-[var(--color-border)] flex items-center justify-between">
                  <span>Running processes</span>
                  <span>{procs.length}</span>
                </div>
                {procs.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-[var(--color-text-muted)]">No processes running</div>
                ) : (
                  procs.map((p) => (
                    <div
                      key={p.pid}
                      className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] last:border-0 hover:bg-white/5"
                    >
                      <span className="text-[10px] text-[var(--color-text-muted)] font-mono w-14 shrink-0">{p.pid}</span>
                      <span className="text-xs text-[var(--color-text-primary)] font-mono truncate flex-1" title={p.name}>{p.name}</span>
                      <span
                        className={`text-[10px] font-mono w-12 shrink-0 text-right tabular-nums ${(p.cpu ?? 0) >= 50 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}`}
                        title="CPU% (average over the process lifetime)"
                      >
                        {(p.cpu ?? 0).toFixed(1)}%
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); killProc(p.pid); }}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-danger)]/20 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/30 shrink-0"
                        title={`kill -9 ${p.pid}`}
                      >
                        kill
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>,
            document.body
          )}
          {/* Insecure toggle — driven by decoupled CLI metadata in aw-app-code-agent-clis */}
          {supportsInsecureMode(effectiveAgentType) && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleInsecure?.(sessionId, !insecure); setTimeout(() => setReconnectKey((k) => k + 1), 500); }}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${insecure
                ? 'bg-[var(--color-danger)]/20 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/30'
                : 'bg-white/5 text-[var(--color-text-muted)] hover:bg-white/10'}`}
              title={getInsecureTooltip(effectiveAgentType, insecure)}
            >
              {insecure ? 'INSECURE' : 'insecure'}
            </button>
          )}
          {/* Search */}
          <button
            onClick={toggleSearch}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="Search (Cmd+F)"
          >
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </button>
          {/* Pop out */}
          <button
            onClick={() => {
              const url = `/terminal.html?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name || sessionId)}`;
              window.open(url, `terminal-${sessionId}`, 'popup=1,width=900,height=600');
              onMinimize?.();
            }}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="Pop out to new window"
          >
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
          {/* Minimize */}
          <button
            onClick={onMinimize}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="Minimize"
          >
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14" />
            </svg>
          </button>
          {/* Maximize / Restore */}
          <button
            onClick={() => onMaximize && onMaximize(windowKey)}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="5" width="14" height="14" rx="1" />
                <path d="M8 2h12a2 2 0 0 1 2 2v12" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            )}
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      )}

      {/* Search bar */}
      {searchVisible && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-header)]">
          <svg className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search terminal..."
            className="flex-1 bg-transparent text-[15px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
          />
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => doSearch(searchQuery, 'prev')}
              className="p-0.5 rounded hover:bg-white/10 transition-colors"
              title="Previous (Shift+Enter)"
            >
              <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              onClick={() => doSearch(searchQuery, 'next')}
              className="p-0.5 rounded hover:bg-white/10 transition-colors"
              title="Next (Enter)"
            >
              <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
          <button
            onClick={() => { setSearchQuery(''); setSearchVisible(false); searchRef.current?.clearDecorations(); termRef.current?.focus(); }}
            className="p-0.5 rounded hover:bg-white/10 transition-colors"
            title="Close search (Escape)"
          >
            <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Terminal */}
      {/* Terminal + drop overlay */}
      <div className="flex-1 relative">
        <div ref={containerRef} className="absolute inset-0 bg-black" style={{ padding: '4px 4px 0 4px' }} />
        {dragOver && isAgent && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-accent)]/10 border-2 border-dashed border-[var(--color-accent)] rounded pointer-events-none">
            <span className="text-sm font-medium text-[var(--color-accent)]">Drop files to add to conversation</span>
          </div>
        )}
      </div>
    </div>
  );
}

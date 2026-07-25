/**
 * Dev-control client — remote JS eval over WebSocket.
 *
 * Activates on `?devctl=1` or `localStorage.aw_devctl = '1'`.
 * Pass `?devctl=0` to disable and clear the flag.
 *
 * - Opens WS to /ws/devctl, reconnects with backoff on drop.
 * - Receives `{cmd: 'eval', id, code}` messages, evaluates in an
 *   async wrapper (so `await` works), sends back `{id, result, error,
 *   ms}`.
 * - Renders a tiny status pill bottom-left so I can see at a glance
 *   from a screenshot whether the channel is up.
 *
 * Diagnostic only.  Remove once iPhone Safari layout work is done.
 */

import { wsUrl } from '../auth';

let started = false;
let ws = null;
let reconnectDelay = 1000;
let reconnectTimer = null;
let connectionState = 'closed'; // 'closed' | 'connecting' | 'open' | 'error'
const stateListeners = new Set();

// Public state API so UI components (top-bar [dev] toggle) can react.
export function isDevctlEnabled() {
  try { return localStorage.getItem('aw_devctl') === '1'; } catch { return false; }
}

export function getDevctlConnectionState() {
  return connectionState;
}

export function onDevctlStateChange(cb) {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

function notify() {
  for (const cb of stateListeners) {
    try { cb({ enabled: isDevctlEnabled(), state: connectionState }); } catch {}
  }
}

export function enableDevctl() {
  try { localStorage.setItem('aw_devctl', '1'); } catch {}
  // Allow connect even if a prior startDevctl() returned early.
  started = false;
  startDevctl();
  notify();
}

export function disableDevctl() {
  try { localStorage.removeItem('aw_devctl'); } catch {}
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) {
    try { ws.onclose = null; ws.close(); } catch {}
  }
  ws = null;
  started = false;
  connectionState = 'closed';
  const pill = document.getElementById('aw-devctl-pill');
  if (pill) pill.remove();
  notify();
}

function shouldStart() {
  // TEMPORARY: force-enable so the user doesn't have to toggle the
  // [dev] button after every reload during PWA debugging.  Revert to
  // the localStorage/URL-param check once the PWA top-menu issues are
  // diagnosed.
  try { localStorage.setItem('aw_devctl', '1'); } catch {}
  return true;
}

// Bottom-left status pill removed — the top-bar [dev] toggle (see
// AuthenticatedApp in App.jsx) now displays connection state.  Keep
// the function as a no-op so the rest of the file doesn't need to
// change.
function ensureIndicator() { return null; }

function setStatus(state) {
  // Track for the UI toggle in the top bar.
  connectionState = state === 'hello' ? 'open' : state;
  notify();
  const el = ensureIndicator();
  if (!el) return;
  const colors = { open: '#22c55e', connecting: '#eab308', closed: '#ef4444', error: '#ef4444', hello: '#22c55e' };
  el.style.background = colors[state] || '#666';
  el.style.color = '#000';
  el.textContent = 'devctl:' + state;
}

function safeSerialize(v, depth) {
  depth = depth || 0;
  if (depth > 4) return '[deep]';
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === 'function') return '[Function ' + (v.name || '') + ']';
  if (t === 'symbol') return v.toString();
  if (t !== 'object') return v;
  if (v instanceof Error) return { _error: v.name, message: v.message, stack: (v.stack || '').slice(0, 1200) };
  if (typeof Element !== 'undefined' && v instanceof Element) {
    return {
      _element: v.tagName,
      id: v.id || undefined,
      class: v.className || undefined,
      attrs: Array.from(v.attributes || []).reduce((m, a) => (m[a.name] = a.value, m), {}),
      rect: (() => { try { const r = v.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; } catch { return null; } })(),
      text: (v.textContent || '').slice(0, 200),
    };
  }
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => safeSerialize(x, depth + 1));
  // Plain object: enumerate own keys only, cap count
  try {
    const out = {};
    const keys = Object.keys(v).slice(0, 100);
    for (const k of keys) {
      try { out[k] = safeSerialize(v[k], depth + 1); } catch (e) { out[k] = '[err:' + e.message + ']'; }
    }
    return out;
  } catch {
    return String(v);
  }
}

async function evalCode(code) {
  const t0 = (performance && performance.now) ? performance.now() : Date.now();
  try {
    // Async wrapper so `await` works inside snippets.
    // eslint-disable-next-line no-new-func
    const fn = new Function('return (async () => { ' + code + ' })()');
    const result = await fn();
    const ms = Math.round(((performance && performance.now) ? performance.now() : Date.now()) - t0);
    return { result: safeSerialize(result), ms };
  } catch (e) {
    const ms = Math.round(((performance && performance.now) ? performance.now() : Date.now()) - t0);
    return { error: String((e && e.stack) || (e && e.message) || e), ms };
  }
}

function connect() {
  setStatus('connecting');
  try {
    ws = new WebSocket(wsUrl('/ws/devctl'));
  } catch (e) {
    setStatus('error');
    scheduleReconnect();
    return;
  }
  ws.addEventListener('open', () => {
    setStatus('open');
    reconnectDelay = 1000;
  });
  ws.addEventListener('message', async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.cmd === 'hello') {
      setStatus('hello');
      return;
    }
    if (msg.cmd === 'eval') {
      const out = await evalCode(msg.code || '');
      try { ws.send(JSON.stringify({ id: msg.id, ...out })); } catch {}
    }
  });
  ws.addEventListener('close', () => {
    setStatus('closed');
    scheduleReconnect();
  });
  ws.addEventListener('error', () => {
    setStatus('error');
  });
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (started) connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

export function startDevctl() {
  if (started) return;
  if (!shouldStart()) return;
  started = true;
  const start = () => {
    ensureIndicator();
    connect();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

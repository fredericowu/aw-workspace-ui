/**
 * Viewport debug client — temporary diagnostic.
 *
 * Activates on `?viewdbg=1` or `localStorage.aw_viewdbg = '1'`.
 *
 * - Renders an always-visible top-right overlay with live viewport state.
 * - POSTs each snapshot to /api/debug/viewdbg as JSONL so the dev machine
 *   can `tail -f /tmp/aw-viewdbg.jsonl` and watch pinch attempts in real
 *   time.
 * - Listens to: window.resize, hashchange, orientationchange,
 *   visualViewport.resize, visualViewport.scroll, DOMContentLoaded.
 *
 * Remove this file (and the import in main.jsx) once the iPhone pinch-
 * zoom-out bug is diagnosed.
 */

let started = false;
let seq = 0;
let lastSentKey = '';

function shouldStart() {
  try {
    const usp = new URLSearchParams(window.location.search);
    if (usp.get('viewdbg') === '1') {
      try { localStorage.setItem('aw_viewdbg', '1'); } catch {}
      return true;
    }
    if (usp.get('viewdbg') === '0') {
      try { localStorage.removeItem('aw_viewdbg'); } catch {}
      return false;
    }
    return localStorage.getItem('aw_viewdbg') === '1';
  } catch {
    return false;
  }
}

function snapshot(reason) {
  const meta = document.querySelector('meta[name="viewport"]');
  const vv = window.visualViewport || null;
  let displayMode = 'unknown';
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) displayMode = 'standalone';
    else if (window.matchMedia('(display-mode: browser)').matches) displayMode = 'browser';
  } catch {}
  return {
    seq: ++seq,
    ts: Date.now(),
    reason,
    hash: window.location.hash,
    href: window.location.href,
    metaViewport: meta ? meta.getAttribute('content') : '<missing>',
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    docW: document.documentElement.clientWidth,
    docH: document.documentElement.clientHeight,
    screenW: window.screen.width,
    screenH: window.screen.height,
    screenAvailW: window.screen.availWidth,
    screenAvailH: window.screen.availHeight,
    orientation: (window.screen.orientation && window.screen.orientation.type) || 'n/a',
    vvW: vv ? vv.width : null,
    vvH: vv ? vv.height : null,
    vvScale: vv ? vv.scale : null,
    vvOffL: vv ? vv.offsetLeft : null,
    vvOffT: vv ? vv.offsetTop : null,
    vvPageL: vv ? vv.pageLeft : null,
    vvPageT: vv ? vv.pageTop : null,
    dpr: window.devicePixelRatio,
    standalone: navigator.standalone === true,
    displayMode,
    ua: navigator.userAgent,
  };
}

function post(snap) {
  // Avoid spamming when nothing meaningful changed.
  const key =
    snap.reason + '|' +
    snap.hash + '|' +
    snap.metaViewport + '|' +
    snap.innerW + 'x' + snap.innerH + '|' +
    snap.vvW + 'x' + snap.vvH + '@' + snap.vvScale;
  if (key === lastSentKey) return;
  lastSentKey = key;
  try {
    fetch('/api/debug/viewdbg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(snap),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

// Overlay rendering removed — devctl (remote eval over WS) is now the
// primary debugging surface and is far more flexible.  Viewdbg still
// posts snapshots to the server for passive logging; left in place so
// `tail -f /tmp/aw-viewdbg.jsonl` remains useful, but no on-screen UI.
function renderOverlay(/* snap */) { /* no-op */ }
// Also remove any existing overlay from a prior page-load that beat
// us to mount (defensive — handles HMR-style re-imports).
try {
  const stale = document.getElementById('aw-viewdbg-overlay');
  if (stale) stale.remove();
} catch {}

function fire(reason) {
  const snap = snapshot(reason);
  renderOverlay(snap);
  post(snap);
}

export function startViewdbg() {
  if (started) return;
  if (!shouldStart()) return;
  started = true;

  // Fire after DOM is ready so document.body exists for the overlay.
  const init = () => {
    fire('init');

    window.addEventListener('resize', () => fire('window.resize'));
    window.addEventListener('hashchange', () => fire('hashchange'));
    window.addEventListener('orientationchange', () => fire('orientationchange'));
    document.addEventListener('visibilitychange', () => fire('visibility:' + document.visibilityState));

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => fire('vv.resize'));
      window.visualViewport.addEventListener('scroll', () => fire('vv.scroll'));
    }

    // Periodic heartbeat so we know the page is still alive even if
    // no events have fired (e.g. when the user is staring at it).
    setInterval(() => fire('tick'), 5000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}

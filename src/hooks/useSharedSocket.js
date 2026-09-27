// Shared aw-ws/1 client — the ONE place that owns the §7 client rules
// (docs/standards/app-backend-websocket-messaging.md) so every reconnecting
// WebSocket in the estate gets them for free instead of re-deriving them at
// each call site.
//
// Promoted from apps/tasks/ui/src/ws.js (Kanban
// 3d65bf3b-9510-8186-b22d-f1c583cdd0f1), which was a deliberate stand-in —
// see that file's own header before it was deleted. Two things changed on
// the move:
//
//  - §7.1 fix: the backoff counter is no longer reset in `onopen`. A
//    connection only counts as healthy — and only then resets the attempt
//    counter — once it has done something a broken one cannot: received its
//    first inbound frame, or stayed open MIN_HEALTHY_MS. A server that
//    accepts and closes 150ms later (the tunnel-bridge premature-accept
//    failure, §2.6.1) used to reset to attempt=0 on every single retry,
//    producing a fixed-interval hot loop no backoff tuning could fix — the
//    11,518-request signature behind bug:presentations-ws-fast-reconnect-loop.
//  - §7.7: after MAX_UNHEALTHY_STREAK consecutive connects that never
//    reached healthy, onStatus gets an 'unhealthy' status (plus a
//    console.warn) so a silently hot-looping socket is visible somewhere
//    other than a DevTools Network panel.
//
// App plugins can't import this file directly (no aw-workspace-ui internals
// across the bundle boundary) — they reach it via
// host.sdk.ws.createSharedSocket, wired in apps/sdk.js from this same
// function.

import { isAuthWsClose } from '../auth';

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30000;
// The fallback for a socket the server legitimately holds silent (§7.1) —
// no frame is required for this long before the connection is trusted.
const MIN_HEALTHY_MS = 10000;
// §7.7 — enough consecutive failures that "transient blip" no longer applies.
const MAX_UNHEALTHY_STREAK = 3;

function backoffDelay(attempt) {
  const capped = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  // Half fixed, half jitter: spreads a fleet of tabs reconnecting after a
  // workspace restart instead of stampeding on the same tick.
  return capped / 2 + Math.random() * (capped / 2);
}

/**
 * A single shared, ref-counted aw-ws/1 connection.
 *
 * @param {object}   opts
 * @param {function} opts.url        () => string — built fresh per attempt so
 *                                    a host that rewrites its base (BYOD) is
 *                                    picked up.
 * @param {function} opts.onFrame    (frame) => void, for every parsed frame
 *                                    except the literal `type: "error"`
 *                                    (handled centrally) — unknown `type`s
 *                                    reach here too, so ignoring them is the
 *                                    caller's job (§4.3).
 * @param {function} [opts.onStatus] ({state, code, message}) => void.
 *                                    state: 'open' | 'closed' | 'unhealthy' | 'fatal'.
 * @param {string}   [opts.initType] this socket's `<domain>_init` type, if it
 *                                   negotiates a protocol version (§4.3). When
 *                                   given, a `data.protocol` greater than
 *                                   opts.supportedProtocol closes the socket
 *                                   4426 instead of degrading silently.
 * @param {number}   [opts.supportedProtocol] default 1.
 * @param {number}   [opts.keepAliveMs] when set, sends the literal text
 *                                      "ping" on this interval while open —
 *                                      for a socket whose server never pings
 *                                      and needs a client-side nudge to
 *                                      detect a silently-dropped TCP
 *                                      connection the browser/OS won't
 *                                      always surface as `onclose`.
 * @returns {{retain: function(): function()}} retain() opens the socket if it
 *          isn't open and returns the matching release().
 */
export function createSharedSocket({
  url,
  onFrame,
  onStatus = () => {},
  initType = null,
  supportedProtocol = 1,
  keepAliveMs = null,
}) {
  let ws = null;
  let retryTimer = null;
  let healthyTimer = null;
  let keepAliveTimer = null;
  let attempt = 0;
  let refs = 0;
  let fatal = null;
  let healthy = false;
  let unhealthyStreak = 0;

  function notify(state, code, message) {
    try {
      onStatus({ state, code, message });
    } catch {
      /* a listener that throws must not take the socket down */
    }
  }

  function markHealthy() {
    if (healthy) return;
    healthy = true;
    attempt = 0;
    unhealthyStreak = 0;
    clearTimeout(healthyTimer);
    notify('open', null, null);
  }

  function scheduleReconnect() {
    if (refs === 0 || fatal || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      attempt += 1;
      connect();
    }, backoffDelay(attempt));
  }

  function handleFrame(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // not an envelope — nothing to do with it
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    const data = (msg.data && typeof msg.data === 'object') ? msg.data : {};

    // Rule: protocol is negotiated once, in the handshake frame — checked
    // BEFORE marking healthy, since a socket about to be closed 4426 never
    // was.
    if (initType && msg.type === initType) {
      const protocol = Number(data.protocol);
      if (Number.isFinite(protocol) && protocol > supportedProtocol) {
        fatal = 4426;
        notify('fatal', 4426,
          `This page needs a reload (server protocol ${protocol}).`);
        try { ws.close(4426, 'protocol not supported'); } catch { /* already gone */ }
        return;
      }
    }

    // Rule (§7.1): a connection is healthy once its first inbound frame
    // lands — §4.3 already makes `<domain>_init` mandatory and the server's
    // first frame, so for any conforming socket this IS the handshake
    // landing.
    markHealthy();

    // Rule 4 (§4.4): the literal "error", not "<domain>_error", handled in
    // one place.
    if (msg.type === 'error') {
      console.warn(`[ws] error: ${data.code || 'unknown'} — ${data.message || ''}`);
      return;
    }
    onFrame(msg); // Rule 3: unknown types reach here and are simply dropped.
  }

  function connect() {
    if (fatal || refs === 0) return;
    let socket;
    try {
      socket = new WebSocket(url());
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;
    healthy = false;
    // §7.1: do NOT reset `attempt` in onopen — a socket that opens and dies
    // 150ms later (the tunnel's premature-accept failure) must not look
    // like a successful connection. The dwell timer is the fallback for a
    // socket the server legitimately holds silent.
    healthyTimer = setTimeout(markHealthy, MIN_HEALTHY_MS);
    if (keepAliveMs) {
      keepAliveTimer = setInterval(() => {
        try {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send('ping');
          else clearInterval(keepAliveTimer);
        } catch { clearInterval(keepAliveTimer); }
      }, keepAliveMs);
    }
    socket.onmessage = (event) => handleFrame(event.data);
    socket.onerror = () => { try { socket.close(); } catch { /* already gone */ } };
    socket.onclose = (event) => {
      if (ws === socket) ws = null;
      clearTimeout(healthyTimer);
      clearInterval(keepAliveTimer);
      if (fatal) return; // already reported (e.g. the protocol check above closed us)
      // Rule 1. Without this branch an expired session reconnects forever
      // against a 4401 instead of telling the user they're logged out.
      if (isAuthWsClose(event.code)) {
        fatal = event.code;
        const why = event.code === 4403 ? 'not permitted'
          : event.code === 4426 ? 'reload required'
          : 'session expired';
        console.warn(`[ws] live updates stopped (${event.code} — ${why}); not reconnecting.`);
        notify('fatal', event.code, `Live updates stopped — ${why}.`);
        return;
      }
      if (!healthy) {
        unhealthyStreak += 1;
        // §7.7: a socket hot-looping against a broken tunnel/backend must
        // not keep looking like a transient blip after enough consecutive
        // failures.
        if (unhealthyStreak >= MAX_UNHEALTHY_STREAK) {
          console.warn(`[ws] ${unhealthyStreak} consecutive unhealthy connects (last close ${event.code}) — connection is not recovering.`);
          notify('unhealthy', event.code,
            `Live updates degraded — ${unhealthyStreak} failed attempts (last close ${event.code}).`);
          scheduleReconnect();
          return;
        }
      }
      notify('closed', event.code, null);
      scheduleReconnect(); // Rule 2
    };
  }

  function teardown() {
    clearTimeout(retryTimer);
    clearTimeout(healthyTimer);
    clearInterval(keepAliveTimer);
    retryTimer = null;
    attempt = 0;
    unhealthyStreak = 0;
    if (ws) {
      const socket = ws;
      ws = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try { socket.close(); } catch { /* already gone */ }
    }
  }

  return {
    retain() {
      refs += 1;
      if (refs === 1) connect();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        refs -= 1;
        if (refs === 0) teardown();
      };
    },
    // Skip the rest of the current backoff wait and try now — for a caller
    // that knows something changed (e.g. the tab just became visible again
    // after the OS suspended it, which is exactly when a socket is most
    // likely to be silently dead with nothing yet scheduled to notice). A
    // no-op while a connection is already open/connecting or the socket is
    // fatal/unretained.
    kick() {
      if (fatal || refs === 0 || ws) return;
      clearTimeout(retryTimer);
      retryTimer = null;
      connect();
    },
  };
}

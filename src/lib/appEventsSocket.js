// Module-level singleton for the generic `app_event` WS frame — the push an
// app's backend fires (via ctx.notify.event(), src/apps/base.py) to nudge an
// already-open window to refresh without a full remount. Rides the SAME
// /ws/notifications socket TopNotifications.jsx already keeps open (one
// connection, many consumers), through the shared aw-ws/1 client
// (hooks/useSharedSocket.js) — never a second socket per app.
//
// Frame shape: { type: "app_event", data: { app, event, ...fields } }.
// subscribe(appId, fn) dispatches only frames whose data.app === appId.

import { createSharedSocket } from '../hooks/useSharedSocket';
import { wsUrl, notifyWsAuthFailed } from '../auth';

const listeners = new Map(); // appId -> Set<(data) => void>
let socket = null;

function dispatch(msg) {
  if (msg.type !== 'app_event') return;
  if (msg.version !== undefined && msg.version !== 1) return;
  const data = (msg.data && typeof msg.data === 'object') ? msg.data : {};
  const set = listeners.get(data.app);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(data);
    } catch {
      /* a listener that throws must not break the others */
    }
  }
}

function getSocket() {
  if (!socket) {
    socket = createSharedSocket({
      url: () => wsUrl('/ws/notifications'),
      initType: 'ninja_init',
      onFrame: dispatch,
      onStatus: ({ state }) => {
        if (state === 'fatal') notifyWsAuthFailed();
      },
    });
  }
  return socket;
}

/**
 * Subscribe to `app_event` frames for one app id. Retains the shared
 * socket for the lifetime of the subscription. Returns an unsubscribe
 * function — call it on unmount, or the socket (shared with every other
 * subscriber) is held open past the caller's lifetime.
 */
export function subscribeAppEvents(appId, fn) {
  if (!appId || typeof fn !== 'function') return () => {};

  let set = listeners.get(appId);
  if (!set) {
    set = new Set();
    listeners.set(appId, set);
  }
  set.add(fn);

  const release = getSocket().retain();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    set.delete(fn);
    if (set.size === 0) listeners.delete(appId);
    release();
  };
}

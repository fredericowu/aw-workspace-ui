/**
 * Tell an app iframe about the "suppress on-screen keyboard" toggle.
 *
 * Tier-2 apps are served from `<app-id>.app.<apex>` while this shell is at
 * `<apex>`, so their iframes are CROSS-ORIGIN — `contentDocument` is blocked
 * and nothing here can reach the fields inside them (WindowManager.jsx:199-201
 * already says as much). An app that wants the toggle has to implement its own
 * suppressor and cooperate over postMessage; this module is the shell half of
 * that contract.
 *
 * The app half, for reference, lives in
 * repos/aw-app-code-server/container/ios-kbd-suppressor.js.
 *
 * Two rules this module exists to keep:
 *
 *   1. NEVER post to '*'. The target origin is always derived from the
 *      iframe's own `src`, so the state cannot leak to whatever else happens
 *      to be loaded in that frame after a navigation.
 *   2. The hello leg is not optional. We post on the iframe's `load`, but the
 *      app's script can boot after that fired (bfcache, a slow bundle), which
 *      would leave it never learning the state. So the app may ask, and this
 *      module answers.
 */

import { getSuppressKbd, onSuppressKbdChange } from './keyboardMode';

/** Shell -> app: the current toggle state. */
export const APP_KBD_MSG = 'aw:kbd-suppress';
/** App -> shell: "I just booted, tell me the state". */
export const APP_KBD_HELLO = 'aw:kbd-suppress-hello';

/**
 * Target origin for an iframe, from its `src`.
 * Returns null for a src we cannot parse or that isn't http(s) — posting to a
 * `null`/opaque origin would either throw or, worse, tempt a '*' fallback.
 */
export function originForIframeSrc(src) {
  if (!src || typeof src !== 'string') return null;
  try {
    const u = new URL(src, window.location.href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Post the current suppress state to one iframe. Safe to call at any time:
 * a missing iframe, an unparseable src or a frame that has gone away are all
 * no-ops rather than throws, because the callers are event handlers.
 */
export function postSuppressState(iframeEl, on) {
  if (!iframeEl) return false;
  const origin = originForIframeSrc(iframeEl.src);
  if (!origin) return false;
  const win = iframeEl.contentWindow;
  if (!win) return false;
  try {
    win.postMessage({ type: APP_KBD_MSG, on: !!on }, origin);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep one app iframe in sync with the toggle for as long as it is mounted.
 *
 * @param {() => HTMLIFrameElement|null} getIframe  reads the CURRENT iframe —
 *        a getter, not the element, because the caller holds it in a ref that
 *        is still null when this runs and can be swapped later (refreshIframe
 *        reassigns `src`).
 * @returns {() => void} cleanup
 */
export function installAppIframeKbdSync(getIframe) {
  const send = () => postSuppressState(getIframe(), getSuppressKbd());

  // The app asking. Checked against the iframe's own origin AND its
  // contentWindow, so another frame on the page cannot impersonate it.
  const onMessage = (ev) => {
    const d = ev.data;
    if (!d || typeof d !== 'object' || d.type !== APP_KBD_HELLO) return;
    const iframe = getIframe();
    if (!iframe) return;
    if (ev.origin !== originForIframeSrc(iframe.src)) return;
    if (ev.source !== iframe.contentWindow) return;
    postSuppressState(iframe, getSuppressKbd());
  };

  window.addEventListener('message', onMessage);
  const offToggle = onSuppressKbdChange(send);

  return () => {
    window.removeEventListener('message', onMessage);
    offToggle();
  };
}

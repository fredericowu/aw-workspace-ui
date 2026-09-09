/**
 * Suppressed text input — a real `<input>` that never raises the iOS
 * on-screen keyboard, while hardware/Bluetooth keystrokes still reach it.
 *
 * Same mechanism as lib/hardwareKeyboardBridge.js, and for the same reason:
 * `inputmode="none"` is a confirmed no-op on iOS Safari (WebKit 193811), so
 * the only thing that keeps the soft keyboard down is never focusing an
 * editable element. While attached we park DOM focus on a plain, non-editable
 * `<div tabindex="0">` (the "focus proxy") and hand every keydown that lands
 * there to the caller's `onKey`, which owns all key semantics.
 *
 * Deliberately NOT sharing an abstraction with hardwareKeyboardBridge.js: the
 * ~30 lines that overlap are DOM boilerplate, while the parts that matter are
 * unrelated (that module generates xterm escape sequences through `term`'s own
 * `_keyDown`; this one hands raw events to a React state setter). Extracting a
 * shared base would put a hard-won, live-device-tested feature at risk for no
 * user-visible gain. What IS shared is what has to be shared: the proxy
 * attribute, so the two mechanisms recognise each other's proxies instead of
 * fighting over focus when a terminal sits behind the caller's UI.
 *
 * Three layers, all three required — a focus proxy alone is not enough (see
 * commit 7a86d4a, found on a real device):
 *
 *   a. The input is made untappable (`pointer-events:none`) via an injected
 *      stylesheet rule keyed off an attribute — a native tap that hit-tests a
 *      real editable element focuses it before any JS focus redirect runs.
 *   b. `input.focus` is shadowed with an own-property function that focuses
 *      the proxy instead, so every existing caller (including a mount
 *      autofocus) is covered at one chokepoint. Restored on detach.
 *   c. Focus that lands on the input anyway is `blur()`ed before the proxy
 *      takes it back — moving focus away is not the same as ending WebKit's
 *      editing session.
 *
 * Suppressing the keyboard is only half the job: the field still has to be
 * usable. An earlier cut stopped at (a)-(c) and shipped a field nobody could
 * enter at all ("ele nem deixa eu entrar no campo de busca"). So a tap on
 * `containerEl` focuses the proxy — silently, with no UI of any kind — and the
 * input is marked active (see ACTIVE_ATTR) so the tap visibly did something.
 *
 * "No UI of any kind" is the point, and it was learned the hard way: a later
 * cut answered "how does someone type with no keyboard?" by popping the in-app
 * virtual keyboard on tap, which is the same mistake in a new costume. The
 * user of this mode HAS a Bluetooth keyboard — that is why suppression is on —
 * and wants zero keyboards on screen: "eu to com o teclado bluetooth, por isso
 * eu quero dar o supress... nao quero ver o teclado virtual que criamos".
 * Focusing the proxy is the whole job; the hardware keyboard does the rest.
 *
 * Scope: iPhone-class touch devices only. Desktop, iPad and everything else
 * get an immediate no-op detach and zero behaviour change.
 */

import {
  isPhoneClassTouchDevice,
  isKbdFocusProxy,
  KBD_FOCUS_PROXY_ATTR,
} from './hardwareKeyboardBridge';

// Marks the suppressed input for the injected stylesheet rule below. An
// attribute + a stylesheet `!important` rule, not `input.style.pointerEvents`:
// a React controlled input re-renders on every keystroke, and an inline style
// prop would be wiped by the next render with no error anywhere.
//
// Deliberately NOT `data-aw-kbd-suppressed`: lib/keyboardMode.js already
// writes that one onto every xterm helper textarea (`dataset.awKbdSuppressed`)
// to track its own inputmode bookkeeping, and an attribute-selector rule would
// silently reach those too.
const UNTAPPABLE_ATTR = 'data-aw-kbd-untappable';
// Set while the proxy holds focus, so CSS can render the field as active —
// `:focus` can never match a field we deliberately keep unfocused.
const ACTIVE_ATTR = 'data-aw-kbd-active';
const STYLE_ID = 'aw-kbd-untappable-style';
const MAX_LOG_ENTRIES = 200;

/** Inject the untappable-input rule once per document. */
function ensureSuppressedStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `[${UNTAPPABLE_ATTR}]{pointer-events:none!important;}`;
  (doc.head || doc.documentElement).appendChild(style);
}

/** Short `TAG.class[#id][proxy]` description for the diagnostic log. */
function describeEl(el) {
  if (!el || el.nodeType !== 1) return null;
  let s = el.tagName;
  if (typeof el.className === 'string' && el.className.trim()) {
    s += '.' + el.className.trim().split(/\s+/).join('.');
  }
  if (el.id) s += `#${el.id}`;
  if (isKbdFocusProxy(el)) s += '[proxy]';
  return s;
}

/**
 * Same `window.__awKbd` ring buffer hardwareKeyboardBridge.js fills, so a
 * real-device DevCtl session reads ONE timeline across both mechanisms
 * instead of two half-stories. `src` is the only added field — it says which
 * of the two wrote the entry; bridge entries have none.
 */
function logKbdEvent(win, doc, ev, target) {
  const store = win.__awKbd || (win.__awKbd = { log: [] });
  store.log.push({
    t: Date.now(),
    ev,
    src: 'suppressed-input',
    target: describeEl(target),
    active: describeEl(doc.activeElement),
    ih: win.innerHeight,
    vv: win.visualViewport ? win.visualViewport.height : null,
    sw: win.screen ? win.screen.width : null,
  });
  if (store.log.length > MAX_LOG_ENTRIES) {
    store.log.splice(0, store.log.length - MAX_LOG_ENTRIES);
  }
}

/**
 * Fields that should keep focus when the user deliberately taps them — the
 * bounce below does not fight these, or a text field elsewhere on the page
 * (an app's settings window, say) would be untypable while we hold focus.
 * The suppressed input itself is explicitly not one of them: letting it hold
 * focus is the whole bug.
 */
function isEditableTarget(el, inputEl) {
  if (!el || el.nodeType !== 1) return false;
  if (el === inputEl) return false;
  if (el.disabled) return false;
  if (el.tagName === 'TEXTAREA') return !el.readOnly;
  if (el.tagName === 'INPUT') {
    const type = (el.type || '').toLowerCase();
    return !el.readOnly && ['text', 'search', 'email', 'password', 'url', 'tel', 'number'].includes(type);
  }
  return !!el.isContentEditable;
}

/**
 * Suppress the on-screen keyboard for one text input.
 *
 * @param {HTMLInputElement} inputEl     the real controlled input
 * @param {HTMLElement} containerEl      element the proxy is appended to and
 *                                       keydown is captured on — must be
 *                                       positioned (the proxy is absolute)
 * @param {{onKey?: (ev: KeyboardEvent) => void}} [opts]
 *        `onKey` receives every keydown reaching the proxy, raw. This module
 *        writes no key mapping of its own: the caller owns what a key means,
 *        because against a React controlled input the only correct write path
 *        is the caller's own state setter, never `input.value`.
 * @returns {() => void} detach — always safe to call, idempotent
 */
export function attachSuppressedTextInput(inputEl, containerEl, { onKey } = {}) {
  const noop = () => {};
  if (!inputEl || !containerEl) return noop;
  if (!isPhoneClassTouchDevice()) return noop;

  const doc = containerEl.ownerDocument || document;
  const win = doc.defaultView || window;

  // ── Untappable input (layer a) ─────────────────────────────────────
  ensureSuppressedStyle(doc);
  inputEl.setAttribute(UNTAPPABLE_ATTR, '1');

  // ── Focus proxy ────────────────────────────────────────────────────
  // Focusable (tabindex) but NOT editable — that is the entire mechanism.
  // Carries the same attribute hardwareKeyboardBridge.js mints its proxies
  // with: a terminal bridge open behind us checks `isKbdFocusProxy` before
  // bouncing focus back, so a shared attribute is what stops the two from
  // ping-ponging focus at each other.
  const proxy = doc.createElement('div');
  proxy.setAttribute(KBD_FOCUS_PROXY_ATTR, '1');
  proxy.setAttribute('tabindex', '0');
  proxy.setAttribute('aria-hidden', 'true');
  proxy.style.cssText =
    'position:absolute;left:0;top:0;width:1px;height:1px;padding:0;border:0;' +
    'opacity:0;outline:none;pointer-events:none;';
  containerEl.appendChild(proxy);

  // ── Focus shadow (layer b) ─────────────────────────────────────────
  const hadOwnFocus = Object.prototype.hasOwnProperty.call(inputEl, 'focus');
  const originalFocus = inputEl.focus;
  inputEl.focus = function awSuppressedInputFocus() {
    proxy.focus({ preventScroll: true });
  };

  // ── Hold focus ─────────────────────────────────────────────────────
  // Anything that steals focus (a button, a tap on a result row) leaves a
  // hardware-keyboard user unable to type, with no soft keyboard to fall back
  // on. Take it back — but never from something genuinely editable or from
  // another proxy, and never synchronously: the bounce runs a tick later so
  // the tap that moved focus completes as a normal click first.
  const onProxyFocusOut = (ev) => {
    const next = ev.relatedTarget;
    if (isKbdFocusProxy(next) || isEditableTarget(next, inputEl)) return;
    setTimeout(() => {
      if (!proxy.isConnected) return;
      const active = doc.activeElement;
      if (isKbdFocusProxy(active) || isEditableTarget(active, inputEl)) return;
      logKbdEvent(win, doc, 'bounce', ev.target);
      // Layer (c): moving focus away is not the same as ending WebKit's
      // editing session — an explicit blur() is, and it has to happen before
      // the proxy takes focus back.
      if (active === inputEl) {
        try { inputEl.blur(); } catch { /* ignore */ }
      }
      try { proxy.focus({ preventScroll: true }); } catch { /* ignore */ }
    }, 0);
  };

  // ── Forward keydown ────────────────────────────────────────────────
  // On the DOCUMENT, capture phase. Scoping this to containerEl was a real
  // bug: a keydown is delivered to the focused element, and on iOS the focus
  // does not reliably stay on our proxy. A tap lands on the wrapper, which is
  // not focusable, so WebKit drops focus to <body> once the gesture ends —
  // after which every hardware keystroke targets <body>, outside containerEl,
  // and a container-scoped listener never sees it. That is exactly the
  // reported symptom: tap the field, then the Bluetooth keyboard does nothing.
  //
  // Listening at the document means the guard below is what decides ownership,
  // rather than where the event happened to land.
  const ownsKeyboard = () => {
    const active = doc.activeElement;
    // Someone is genuinely typing somewhere else — never steal from them.
    if (isEditableTarget(active, inputEl)) return false;
    if (isKbdFocusProxy(active)) return true;
    // The clear button and anything else inside the search box.
    if (active && containerEl.contains(active)) return true;
    // Focus drifted to nothing (the iOS post-tap case above). While attached,
    // the suppressed field is still what the user is aiming at.
    return !active || active === doc.body || active === doc.documentElement;
  };

  const onKeyDown = (ev) => {
    if (!ownsKeyboard()) {
      // Logged, not silent: on the next real-device report this is what
      // separates "the key never reached the page at all" (no entry) from
      // "it arrived and we handed it to someone else" (this entry). Guessing
      // between those two has already cost several round-trips.
      logKbdEvent(win, doc, 'key-declined', ev.target);
      return;
    }
    logKbdEvent(win, doc, 'key', ev.target);
    if (typeof onKey === 'function') onKey(ev);
  };

  const onDocFocusIn = (ev) => logKbdEvent(win, doc, 'focusin', ev.target);
  const onTouchStart = (ev) => logKbdEvent(win, doc, 'touchstart', ev.target);

  // ── Tap to activate ────────────────────────────────────────────────
  // The input is untappable, so the tap lands on containerEl. Focus the PROXY
  // — never the input, which is what would raise the OS keyboard. Nothing else
  // happens: no keyboard is summoned, in-app or otherwise (see the header).
  // No preventDefault either, so the tap still completes as a normal click for
  // anything else in the box (a clear button, say).
  const onActivatePointer = (ev) => {
    logKbdEvent(win, doc, 'activate', ev.target);
    try { proxy.focus({ preventScroll: true }); } catch { /* ignore */ }
  };

  // ── Active styling ─────────────────────────────────────────────────
  // While the proxy holds focus the field IS the thing receiving keys, but
  // `:focus` cannot match — it genuinely is not focused. Mark it so the CSS
  // can show it as active; otherwise a tap looks like it did nothing.
  const onProxyFocusActive = () => inputEl.setAttribute(ACTIVE_ATTR, '1');
  const onProxyBlurActive = () => inputEl.removeAttribute(ACTIVE_ATTR);

  proxy.addEventListener('focus', onProxyFocusActive);
  proxy.addEventListener('blur', onProxyBlurActive);
  containerEl.addEventListener('pointerdown', onActivatePointer, true);
  containerEl.addEventListener('touchstart', onActivatePointer, true);
  // Also on click: iOS blurs to <body> when the gesture ends on a
  // non-focusable element, and a re-focus from the focusout bounce runs in a
  // setTimeout, i.e. outside the user gesture, where WebKit is far less
  // willing to honour it. Re-asserting here is still inside the gesture.
  containerEl.addEventListener('click', onActivatePointer, true);
  proxy.addEventListener('focusout', onProxyFocusOut);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('focusin', onDocFocusIn, true);
  containerEl.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });

  logKbdEvent(win, doc, 'attach', inputEl);

  // Take focus now: on a fresh attach nothing is focused yet, and on a
  // re-attach (re-suppressing after the user cleared a search they had tapped
  // into) the input itself may hold it — moving focus off it is what dismisses
  // an already-open soft keyboard. blur() first, see the bounce above for why
  // moving focus alone is not enough. Never steal from a genuinely editable
  // element elsewhere on the page.
  const activeOnAttach = doc.activeElement;
  if (activeOnAttach === inputEl) {
    try { inputEl.blur(); } catch { /* ignore */ }
  }
  if (!isEditableTarget(activeOnAttach, inputEl)) {
    try { proxy.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  let detached = false;
  return function detachSuppressedTextInput() {
    if (detached) return;
    detached = true;
    proxy.removeEventListener('focusout', onProxyFocusOut);
    proxy.removeEventListener('focus', onProxyFocusActive);
    proxy.removeEventListener('blur', onProxyBlurActive);
    containerEl.removeEventListener('pointerdown', onActivatePointer, true);
    containerEl.removeEventListener('touchstart', onActivatePointer, true);
    containerEl.removeEventListener('click', onActivatePointer, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('focusin', onDocFocusIn, true);
    containerEl.removeEventListener('touchstart', onTouchStart, true);
    inputEl.removeAttribute(ACTIVE_ATTR);

    const hadFocus = doc.activeElement === proxy;
    if (hadOwnFocus) {
      inputEl.focus = originalFocus;
    } else {
      try { delete inputEl.focus; } catch { inputEl.focus = originalFocus; }
    }
    inputEl.removeAttribute(UNTAPPABLE_ATTR);
    try { proxy.remove(); } catch { /* already gone */ }
    logKbdEvent(win, doc, 'detach', inputEl);

    // Detached while holding focus — hand the caret to the real input, which
    // is exactly what a deliberate tap-to-type asked for. Skipped once the
    // input is gone from the document (an unmount), where focusing a detached
    // node is pointless.
    if (hadFocus && inputEl.isConnected) {
      try { inputEl.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  };
}

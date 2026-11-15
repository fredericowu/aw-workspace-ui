/**
 * Hardware-keyboard bridge — real on-screen-keyboard suppression on iPhone.
 *
 * `inputmode="none"` (lib/keyboardMode.js) is a confirmed no-op on iOS Safari
 * (WebKit bug 193811, resolved in 2019 by making Safari *ignore* the attribute).
 * It still works on iPad, but only because iPadOS natively hides the soft
 * keyboard when a hardware one is attached — nothing we do makes that happen.
 *
 * On iPhone the only thing that keeps the soft keyboard down is never focusing
 * an editable element in the first place. So while this bridge is attached we
 * keep DOM focus on a plain, non-editable `<div tabindex="0">` (the "focus
 * proxy") and re-dispatch a faithful synthetic `keydown` onto xterm's hidden
 * textarea, letting xterm's own `_keyDown` do all the key→escape-sequence work.
 * We write no key mapping of our own.
 *
 * Two @xterm/xterm@6 internals this depends on (neither is public API — an
 * xterm major bump requires a re-read of both, and a device retest):
 *
 *   1. `CoreBrowserTerminal._bindKeys()` binds `keydown` on `this.textarea`,
 *      and `_keyDown` checks neither `isTrusted` nor `document.activeElement`.
 *      A synthetic event dispatched at that node is therefore handled exactly
 *      like a real one — including `evaluateKeyboardEvent`'s `case 0:` branch
 *      for iOS's `UIKeyInputUpArrow`-shaped hardware arrow keys, which is the
 *      piece of iOS-specific knowledge that makes arrows work at all.
 *   2. `_keyDown`'s A–Z HACK: a plain (no ctrl/alt/meta) single-character key
 *      whose char code is 65..90 returns early and sends *nothing*, deferring
 *      to the `keypress` event to fix a macOS IME/caps-lock issue. We cannot
 *      rely on `keypress` reaching a non-editable div on iOS, so we detect the
 *      same condition and send that one key via the public `term.input()`.
 *      See `_keyDown` in node_modules/@xterm/xterm/src/browser/
 *      CoreBrowserTerminal.ts (the "HACK: Process A-Z in the keypress event"
 *      comment).
 *
 * The non-obvious half is that focusing the proxy once is not enough:
 * `Terminal.focus()` is literally `textarea.focus({ preventScroll: true })`,
 * and xterm's own `_keyUp` calls it on *every* non-modifier key release, on top
 * of the half-dozen `term.focus()` calls in TerminalWindow.jsx. So we shadow
 * `term.textarea.focus` with an own-property function that focuses the proxy
 * instead — one chokepoint covering internal and external callers alike,
 * restored on detach.
 *
 * Scope: iPhone-class touch devices only. iPad keeps the existing native
 * `inputmode="none"` path in TerminalWindow.jsx (`isIPadDesktopMode`), which
 * works — replacing a working path with a monkey-patched one would be a bad
 * trade. The gate here is the deliberate complement of that one; the two never
 * both fire on the same device.
 */

import { getSuppressKbd } from './keyboardMode';
import { apiFetch } from '../auth';
import { readClipboardImageBlobs, uploadTerminalImage } from './terminalClipboardImage';

/**
 * Marks a focus proxy. Exported because it is a contract between mechanisms,
 * not an internal detail: `onProxyFocusOut` below bounces focus back unless
 * the next target is *also* a proxy, so any other suppressed-input mechanism
 * on the page (lib/suppressedTextInput.js) has to mint its proxies with this
 * exact attribute or the two fight over focus.
 */
export const KBD_FOCUS_PROXY_ATTR = 'data-aw-kbd-proxy';
// Marks the events we dispatch ourselves. The synthetic is dispatched on the
// textarea, which lives *inside* containerEl, so our own capture-phase listener
// on containerEl sees it on the way down — without this flag that is a loop.
const SYNTHETIC = '__awKbdBridgeSynthetic';

// Marks the real xterm textarea while the bridge is attached, so the injected
// stylesheet rule below can make it untappable. See the module doc: the proxy
// keeps focus off it, but `_syncTextArea` still parks it, opacity:0, exactly on
// the cursor cell — a real native tap can still hit-test and focus it.
const BRIDGE_ATTR = 'data-aw-kbd-bridge';
const STYLE_ID = 'aw-kbd-bridge-style';
const MAX_LOG_ENTRIES = 200;

/**
 * Inject the untappable-textarea rule once per document. An attribute + a
 * stylesheet `!important` rule, not `textarea.style.pointerEvents` — xterm's
 * `_syncTextArea` writes inline styles on every cursor move and a future
 * version that assigns `cssText` wholesale would silently wipe an inline
 * property, with no error anywhere. A stylesheet rule cannot be clobbered
 * that way. Left in the document once inserted; a second bridge attaching
 * (e.g. a second terminal) just finds it already there.
 */
function ensureBridgeStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `.xterm-helper-textarea[${BRIDGE_ATTR}]{pointer-events:none!important;}`;
  (doc.head || doc.documentElement).appendChild(style);
}

/** Short `TAG.class[#id][proxy]` description for the diagnostic log — never the node itself. */
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
 * Diagnostic ring buffer for the next real-device report — see design §2d.
 * Left on `window` after detach so DevCtl can read it after the fact; only
 * the listeners that fill it are torn down.
 */
function logKbdEvent(win, doc, ev, target) {
  const store = win.__awKbd || (win.__awKbd = { log: [] });
  store.log.push({
    t: Date.now(),
    ev,
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
 * True on iPhone-class touch devices: a real touch screen whose shortest side
 * is under 600px. Deliberately the complement of TerminalWindow.jsx's
 * `isIPadDesktopMode` (touch + Macintosh UA + shortest side >= 600), so a
 * device matches at most one of the two paths. iPhone in "Request Desktop
 * Website" mode reports a Macintosh UA and maxTouchPoints > 1, which is why
 * the screen size — not the UA — is what separates them.
 */
export function isPhoneClassTouchDevice() {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof window !== 'undefined' &&
      navigator.maxTouchPoints > 1 &&
      Math.min(window.screen.width, window.screen.height) < 600
    );
  } catch {
    return false;
  }
}

/** True when the bridge would attach: the toggle is on and the device qualifies. */
export function shouldAttachHardwareKeyboardBridge() {
  return getSuppressKbd() && isPhoneClassTouchDevice();
}

/**
 * True for a bridge focus proxy. Callers that ask "does xterm have focus?" by
 * comparing against `term.textarea` must also accept the proxy — in suppressed
 * mode the textarea is never the active element (see the Ctrl+C fallback in
 * TerminalWindow.jsx).
 */
export function isKbdFocusProxy(el) {
  return !!(el && el.nodeType === 1 && el.hasAttribute && el.hasAttribute(KBD_FOCUS_PROXY_ATTR));
}

/**
 * Fields that should keep focus when the user deliberately taps them — we do
 * not fight these. xterm's own helper textarea is explicitly *not* one of them:
 * letting it hold focus is the whole bug.
 */
function isEditableTarget(el, xtermTextarea) {
  if (!el || el.nodeType !== 1) return false;
  if (el === xtermTextarea) return false;
  if (el.disabled) return false;
  if (el.tagName === 'TEXTAREA') return !el.readOnly;
  if (el.tagName === 'INPUT') {
    const type = (el.type || '').toLowerCase();
    return !el.readOnly && ['text', 'search', 'email', 'password', 'url', 'tel', 'number'].includes(type);
  }
  return !!el.isContentEditable;
}

/**
 * Attach the bridge to a live xterm terminal.
 *
 * @param {import('@xterm/xterm').Terminal} term  an already-`open()`ed terminal
 * @param {HTMLElement} containerEl  the element `term.open()` was given
 * @returns {() => void} detach function — always safe to call, idempotent
 */
export function attachHardwareKeyboardBridge(term, containerEl) {
  const noop = () => {};
  if (!term || !containerEl) return noop;
  if (!shouldAttachHardwareKeyboardBridge()) return noop;
  const textarea = term.textarea;
  if (!textarea) return noop;

  const doc = containerEl.ownerDocument || document;
  const win = doc.defaultView || window;

  // ── Untappable textarea ────────────────────────────────────────────
  // The proxy below keeps DOM focus off the textarea, but xterm parks it,
  // opacity:0, exactly on the cursor cell (`_syncTextArea`) — hit-testable,
  // so a native tap can still focus it directly and raise the keyboard
  // without ever going through our focus shadow. Make it untappable too.
  ensureBridgeStyle(doc);
  textarea.setAttribute(BRIDGE_ATTR, '1');

  // ── Focus proxy ────────────────────────────────────────────────────
  // Focusable (tabindex) but NOT editable — no contenteditable, no input.
  // That is the entire mechanism: iOS shows the soft keyboard only for a
  // focused *editable* element. `pointer-events:none` keeps taps going to
  // xterm's own screen element, which is what drives text selection.
  const proxy = doc.createElement('div');
  proxy.setAttribute(KBD_FOCUS_PROXY_ATTR, '1');
  proxy.setAttribute('tabindex', '0');
  proxy.setAttribute('aria-hidden', 'true');
  proxy.style.cssText =
    'position:absolute;left:0;top:0;width:1px;height:1px;padding:0;border:0;' +
    'opacity:0;outline:none;pointer-events:none;';
  containerEl.appendChild(proxy);

  // ── Focus shadow ───────────────────────────────────────────────────
  const hadOwnFocus = Object.prototype.hasOwnProperty.call(textarea, 'focus');
  const originalFocus = textarea.focus;
  textarea.focus = function awKbdBridgeFocus() {
    proxy.focus({ preventScroll: true });
  };

  // ── Cursor focus styling ───────────────────────────────────────────
  // xterm toggles `.xterm.focus` (the solid vs hollow cursor) off the
  // textarea's own focus/blur events, which now never fire. A synthetic
  // FocusEvent runs those handlers without moving real focus.
  const onProxyFocus = () => {
    try { textarea.dispatchEvent(new FocusEvent('focus')); } catch { /* ignore */ }
  };
  const onProxyBlur = () => {
    try { textarea.dispatchEvent(new FocusEvent('blur')); } catch { /* ignore */ }
  };

  // ── Hold focus ─────────────────────────────────────────────────────
  // Anything that steals focus (a header button, xterm's own tap handling,
  // Tab) leaves the user unable to type, with no soft keyboard to fall back
  // on. Take it back unless the user landed on something genuinely editable
  // or on another terminal's proxy (which would ping-pong).
  const onProxyFocusOut = (ev) => {
    const next = ev.relatedTarget;
    if (isKbdFocusProxy(next) || isEditableTarget(next, textarea)) return;
    setTimeout(() => {
      if (!proxy.isConnected) return;
      const active = doc.activeElement;
      if (isKbdFocusProxy(active) || isEditableTarget(active, textarea)) return;
      logKbdEvent(win, doc, 'bounce', ev.target);
      // Moving focus away is not the same as ending WebKit's editing
      // session — an explicit blur() is, and it must happen before the
      // proxy takes focus back or the cursor renders hollow.
      if (active === textarea) {
        try { textarea.blur(); } catch { /* ignore */ }
      }
      try { proxy.focus({ preventScroll: true }); } catch { /* ignore */ }
    }, 0);
  };

  // ── Forward keydown ────────────────────────────────────────────────
  // On containerEl, capture phase — not on the proxy alone: a tap can move
  // focus onto xterm's screen element, and then keydown targets that, not
  // the proxy.
  const onKeyDown = (ev) => {
    if (ev[SYNTHETIC]) return;
    // A real event already delivered to the textarea is xterm's to handle;
    // forwarding it would double every keystroke.
    if (ev.target === textarea) return;

    const key = ev.key;

    // Paste. With a non-editable element focused iOS offers no paste menu and
    // Cmd+V maps to nothing, so read the clipboard ourselves. On iOS Safari
    // this puts a one-time "Paste" confirmation in front of the user — a real
    // behaviour change versus the editable-textarea path.
    if (key && key.toLowerCase() === 'v' && ((ev.metaKey && !ev.ctrlKey) || (ev.ctrlKey && ev.shiftKey))) {
      ev.preventDefault();
      (async () => {
        try {
          const blobs = await readClipboardImageBlobs(navigator.clipboard);
          if (blobs.length > 0) {
            for (const blob of blobs) {
              const path = await uploadTerminalImage(blob, { fetchImpl: apiFetch });
              if (path) term.paste(path + ' ');
            }
            return;
          }
          const text = await navigator.clipboard?.readText?.();
          if (text) term.paste(text);
        } catch { /* clipboard unavailable */ }
      })();
      return;
    }

    // WebKit walks focus off the proxy on Tab; xterm wants the \t itself.
    if (key === 'Tab') ev.preventDefault();

    const synthetic = new KeyboardEvent('keydown', {
      key: ev.key,
      code: ev.code,
      keyCode: ev.keyCode,
      which: ev.which,
      ctrlKey: ev.ctrlKey,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      metaKey: ev.metaKey,
      repeat: ev.repeat,
      location: ev.location,
      bubbles: true,
      cancelable: true,
    });
    synthetic[SYNTHETIC] = true;
    textarea.dispatchEvent(synthetic);

    // xterm's A–Z carve-out (see the header): it deliberately sent nothing,
    // expecting a `keypress` we cannot count on here. `ev.key` is unambiguously
    // the right payload for this case, and only this case.
    if (key && key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      const charCode = key.charCodeAt(0);
      if (charCode >= 65 && charCode <= 90) {
        term.input(key, true);
        ev.preventDefault();
        return;
      }
    }

    // xterm's `cancel()` only sets this when it actually consumed the key, so
    // an unhandled Cmd+C still reaches the browser's native copy.
    if (synthetic.defaultPrevented) ev.preventDefault();
  };

  // `keyup` is deliberately NOT forwarded: `_keyUp` only refreshes the cursor
  // style and calls `this.focus()`. Harmless with the shadow in place, but it
  // buys nothing and would reintroduce the bug if the shadow ever regressed.

  // ── Diagnostic ring buffer (design §2d) ───────────────────────────
  // Document-level, capture phase — not containerEl-scoped: the leading
  // open question is whether something *outside* the terminal is what
  // actually raises the keyboard, and a container-scoped listener could
  // never see that.
  const onDocFocusIn = (ev) => logKbdEvent(win, doc, 'focusin', ev.target);
  const onDocFocusOut = (ev) => logKbdEvent(win, doc, 'focusout', ev.target);
  const onTouchStart = (ev) => logKbdEvent(win, doc, 'touchstart', ev.target);
  const onVisualViewportResize = () => logKbdEvent(win, doc, 'vvresize', null);

  doc.addEventListener('focusin', onDocFocusIn, true);
  doc.addEventListener('focusout', onDocFocusOut, true);
  containerEl.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  if (win.visualViewport) {
    win.visualViewport.addEventListener('resize', onVisualViewportResize);
  }

  proxy.addEventListener('focus', onProxyFocus);
  proxy.addEventListener('blur', onProxyBlur);
  proxy.addEventListener('focusout', onProxyFocusOut);
  containerEl.addEventListener('keydown', onKeyDown, true);

  logKbdEvent(win, doc, 'attach', null);

  // Toggled on while the terminal is focused: move focus off the textarea now,
  // which is what dismisses an already-open soft keyboard. blur() first — see
  // onProxyFocusOut above for why moving focus alone is not enough.
  if (doc.activeElement === textarea) {
    try { textarea.blur(); } catch { /* ignore */ }
    try { proxy.focus({ preventScroll: true }); } catch { /* ignore */ }
  }

  let detached = false;
  return function detachHardwareKeyboardBridge() {
    if (detached) return;
    detached = true;
    containerEl.removeEventListener('keydown', onKeyDown, true);
    proxy.removeEventListener('focus', onProxyFocus);
    proxy.removeEventListener('blur', onProxyBlur);
    proxy.removeEventListener('focusout', onProxyFocusOut);
    doc.removeEventListener('focusin', onDocFocusIn, true);
    doc.removeEventListener('focusout', onDocFocusOut, true);
    containerEl.removeEventListener('touchstart', onTouchStart, true);
    if (win.visualViewport) {
      win.visualViewport.removeEventListener('resize', onVisualViewportResize);
    }

    const hadFocus = doc.activeElement === proxy;
    if (hadOwnFocus) {
      textarea.focus = originalFocus;
    } else {
      try { delete textarea.focus; } catch { textarea.focus = originalFocus; }
    }
    textarea.removeAttribute(BRIDGE_ATTR);
    try { proxy.remove(); } catch { /* already gone */ }
    // Toggled off while focused — hand the caret back to xterm so normal
    // on-screen typing works again.
    if (hadFocus) {
      try { textarea.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  };
}

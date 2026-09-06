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

const PROXY_ATTR = 'data-aw-kbd-proxy';
// Marks the events we dispatch ourselves. The synthetic is dispatched on the
// textarea, which lives *inside* containerEl, so our own capture-phase listener
// on containerEl sees it on the way down — without this flag that is a loop.
const SYNTHETIC = '__awKbdBridgeSynthetic';

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
  return !!(el && el.nodeType === 1 && el.hasAttribute && el.hasAttribute(PROXY_ATTR));
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

  // ── Focus proxy ────────────────────────────────────────────────────
  // Focusable (tabindex) but NOT editable — no contenteditable, no input.
  // That is the entire mechanism: iOS shows the soft keyboard only for a
  // focused *editable* element. `pointer-events:none` keeps taps going to
  // xterm's own screen element, which is what drives text selection.
  const proxy = doc.createElement('div');
  proxy.setAttribute(PROXY_ATTR, '1');
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
      try {
        navigator.clipboard?.readText?.()
          .then((text) => { if (text) term.paste(text); })
          .catch(() => {});
      } catch { /* clipboard unavailable */ }
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

  proxy.addEventListener('focus', onProxyFocus);
  proxy.addEventListener('blur', onProxyBlur);
  proxy.addEventListener('focusout', onProxyFocusOut);
  containerEl.addEventListener('keydown', onKeyDown, true);

  // Toggled on while the terminal is focused: move focus off the textarea now,
  // which is what dismisses an already-open soft keyboard.
  if (doc.activeElement === textarea) {
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

    const hadFocus = doc.activeElement === proxy;
    if (hadOwnFocus) {
      textarea.focus = originalFocus;
    } else {
      try { delete textarea.focus; } catch { textarea.focus = originalFocus; }
    }
    try { proxy.remove(); } catch { /* already gone */ }
    // Toggled off while focused — hand the caret back to xterm so normal
    // on-screen typing works again.
    if (hadFocus) {
      try { textarea.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  };
}

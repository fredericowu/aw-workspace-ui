import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachSuppressedTextInput } from '../lib/suppressedTextInput';
import { isKbdFocusProxy } from '../lib/hardwareKeyboardBridge';

// Same idiom as hardwareKeyboardBridge.test.js — the device gate reads
// navigator.maxTouchPoints and window.screen, neither of which jsdom varies.
function setDevice({ maxTouchPoints, width, height }) {
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
  Object.defineProperty(window.screen, 'width', { value: width, configurable: true });
  Object.defineProperty(window.screen, 'height', { value: height, configurable: true });
}

const IPHONE = { maxTouchPoints: 5, width: 430, height: 932 };
const IPAD = { maxTouchPoints: 5, width: 834, height: 1194 };
const DESKTOP = { maxTouchPoints: 0, width: 2560, height: 1440 };

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('attachSuppressedTextInput', () => {
  let container;
  let input;
  let detach;
  let keys;

  const proxyOf = () => container.querySelector('[data-aw-kbd-proxy]');
  const attach = () => attachSuppressedTextInput(input, container, { onKey: (ev) => keys.push(ev.key) });

  beforeEach(() => {
    setDevice(IPHONE);
    container = document.createElement('div');
    input = document.createElement('input');
    input.type = 'text';
    container.appendChild(input);
    document.body.appendChild(container);
    keys = [];
    detach = attach();
  });

  afterEach(() => {
    detach?.();
    container.remove();
    setDevice(DESKTOP);
  });

  it('is a no-op on desktop — nothing mounted, nothing shadowed', () => {
    detach();
    setDevice(DESKTOP);
    const off = attachSuppressedTextInput(input, container, { onKey: () => {} });
    expect(proxyOf()).toBeNull();
    expect(input.hasAttribute('data-aw-kbd-untappable')).toBe(false);
    input.focus();
    expect(document.activeElement).toBe(input);
    off();
  });

  it('is a no-op on iPad — that device keeps its native inputmode path', () => {
    detach();
    setDevice(IPAD);
    const off = attachSuppressedTextInput(input, container, { onKey: () => {} });
    expect(proxyOf()).toBeNull();
    off();
  });

  it('mounts a focusable READONLY INPUT proxy carrying the SHARED proxy attribute', () => {
    const proxy = proxyOf();
    expect(proxy).toBeTruthy();
    // A real form control, not a div: real-device evidence showed WebKit never
    // routes hardware key events to a non-editable element, so the old
    // `<div tabindex=0>` could suppress the keyboard but never accept typing.
    expect(proxy.tagName).toBe('INPUT');
    expect(proxy.getAttribute('tabindex')).toBe('0');
    // readonly is what is meant to keep the on-screen keyboard down, and it is
    // also what keeps both sibling modules from mistaking this for a field the
    // user is typing in — hardwareKeyboardBridge's isEditableTarget and
    // virtualKeyboardTrackpad's isWritableField both test `!el.readOnly`.
    expect(proxy.readOnly).toBe(true);
    expect(proxy.hasAttribute('contenteditable')).toBe(false);
    // Same attribute hardwareKeyboardBridge.js mints, so a terminal bridge
    // open behind the launcher recognises ours and stands down instead of
    // ping-ponging focus with it.
    expect(isKbdFocusProxy(proxy)).toBe(true);
  });

  it('marks the input untappable and injects the pointer-events rule', () => {
    expect(input.getAttribute('data-aw-kbd-untappable')).toBe('1');
    const style = document.getElementById('aw-kbd-untappable-style');
    expect(style).toBeTruthy();
    expect(style.textContent).toContain('[data-aw-kbd-untappable]');
    expect(style.textContent).toContain('pointer-events:none!important');
  });

  it('redirects input.focus() onto the proxy — this is what catches a mount autofocus', () => {
    input.focus();
    expect(document.activeElement).toBe(proxyOf());
    expect(document.activeElement).not.toBe(input);
  });

  it('takes focus at attach time, blurring the input if it held it', () => {
    detach();
    input.focus();
    expect(document.activeElement).toBe(input);
    detach = attach();
    expect(document.activeElement).toBe(proxyOf());
  });

  it('forwards a printable keydown from the proxy to onKey', () => {
    proxyOf().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(keys).toEqual(['a']);
  });

  it('forwards Backspace, Enter and the arrows — the caller owns what they mean', () => {
    ['Backspace', 'Enter', 'ArrowDown', 'ArrowUp'].forEach((key) => {
      proxyOf().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
    expect(keys).toEqual(['Backspace', 'Enter', 'ArrowDown', 'ArrowUp']);
  });

  it('bounces focus back to the proxy when something non-editable steals it', async () => {
    const button = document.createElement('button');
    container.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);
    // Bounced a tick later, not synchronously, so the tap that moved focus
    // still completes as a normal click first.
    await tick();
    expect(document.activeElement).toBe(proxyOf());
  });

  it('does NOT bounce focus away from a genuinely editable field elsewhere', async () => {
    const other = document.createElement('input');
    other.type = 'text';
    document.body.appendChild(other);
    other.focus();
    await tick();
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it('detach restores the real focus, removes the proxy and stops forwarding', () => {
    detach();
    expect(proxyOf()).toBeNull();
    expect(input.hasAttribute('data-aw-kbd-untappable')).toBe(false);
    input.focus();
    expect(document.activeElement).toBe(input);

    keys = [];
    container.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(keys).toEqual([]);
  });

  it('detaching while the proxy holds focus hands the caret to the real input (tap-to-type)', () => {
    input.focus(); // shadowed → proxy
    expect(document.activeElement).toBe(proxyOf());
    detach();
    expect(document.activeElement).toBe(input);
  });

  // Regression, real-device report: the first cut left the field completely
  // inert under suppression — "ele nem deixa eu entrar no campo de busca".
  // A tap must ACTIVATE the field (focus the proxy, never the input) and tell
  // the caller to offer a non-OS way to type.
  it('a tap on the container silently focuses the PROXY — no callback, no UI', () => {
    // Move focus off the proxy first, so the assertion proves the tap did it.
    const button = document.createElement('button');
    container.appendChild(button);
    button.focus();

    container.dispatchEvent(new Event('touchstart', { bubbles: true }));

    expect(document.activeElement).toBe(proxyOf());
    // The whole point: never the real input, which is what raises the keyboard.
    expect(document.activeElement).not.toBe(input);
    // And the field stays untappable — the tap is handled, not permitted.
    expect(input.getAttribute('data-aw-kbd-untappable')).toBe('1');
  });

  // Real-device regression: "eu pressiono a tecla focado no campo da busca mas
  // nao funciona". On iOS a tap lands on the non-focusable wrapper, so WebKit
  // drops focus to <body> once the gesture ends, and every hardware keystroke
  // then targets <body> — outside containerEl, where the old container-scoped
  // listener could never see it.
  it('forwards keys after a tap even when focus has drifted to <body> (iOS post-tap)', () => {
    container.dispatchEvent(new Event('touchstart', { bubbles: true }));
    expect(document.activeElement).toBe(proxyOf());

    // What WebKit does when the gesture ends on a non-focusable node: focus
    // goes to <body>. The keystroke then targets <body>, not the proxy.
    proxyOf().blur();
    expect(document.activeElement).toBe(document.body);

    keys = [];
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true }));
    expect(keys).toEqual(['g']);
  });

  it('does NOT steal keys from a genuinely editable field elsewhere on the page', () => {
    const other = document.createElement('input');
    other.type = 'text';
    document.body.appendChild(other);
    other.focus();

    keys = [];
    other.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true }));
    expect(keys).toEqual([]);

    other.remove();
  });

  it('marks the input active while the proxy holds focus, so a tap does not look dead', () => {
    input.focus(); // shadowed → proxy
    expect(input.getAttribute('data-aw-kbd-active')).toBe('1');
    detach();
    expect(input.hasAttribute('data-aw-kbd-active')).toBe(false);
  });

  it('writes into the same window.__awKbd ring buffer the terminal bridge uses', () => {
    proxyOf().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    const entries = (window.__awKbd?.log || []).filter((e) => e.src === 'suppressed-input');
    expect(entries.some((e) => e.ev === 'attach')).toBe(true);
    expect(entries.some((e) => e.ev === 'key')).toBe(true);
  });
});

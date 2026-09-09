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

  it('mounts a focusable, non-editable proxy carrying the SHARED proxy attribute', () => {
    const proxy = proxyOf();
    expect(proxy).toBeTruthy();
    expect(proxy.tagName).toBe('DIV');
    expect(proxy.getAttribute('tabindex')).toBe('0');
    // Editability is the whole bug — iOS shows the keyboard only for these.
    expect(proxy.hasAttribute('contenteditable')).toBe(false);
    expect(proxy.isContentEditable).toBeFalsy();
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
  it('a tap on the container focuses the PROXY and fires onActivate', () => {
    detach();
    const activations = [];
    detach = attachSuppressedTextInput(input, container, {
      onKey: () => {},
      onActivate: (ev) => activations.push(ev.type),
    });
    // Move focus off the proxy first, so the assertion proves the tap did it.
    const button = document.createElement('button');
    container.appendChild(button);
    button.focus();

    container.dispatchEvent(new Event('touchstart', { bubbles: true }));

    expect(activations).toEqual(['touchstart']);
    expect(document.activeElement).toBe(proxyOf());
    // The whole point: never the real input, which is what raises the keyboard.
    expect(document.activeElement).not.toBe(input);
    // And the field stays untappable — the tap is handled, not permitted.
    expect(input.getAttribute('data-aw-kbd-untappable')).toBe('1');
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

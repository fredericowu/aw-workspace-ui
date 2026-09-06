import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { Terminal } from '@xterm/xterm';
import {
  attachHardwareKeyboardBridge,
  isPhoneClassTouchDevice,
  isKbdFocusProxy,
  shouldAttachHardwareKeyboardBridge,
} from '../lib/hardwareKeyboardBridge';
import { setSuppressKbd } from '../lib/keyboardMode';

// xterm's CoreBrowserService reads window.matchMedia for the device pixel
// ratio; jsdom doesn't implement it.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (q) => ({
      matches: false, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    });
  }
});

function setDevice({ maxTouchPoints, width, height }) {
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
  Object.defineProperty(window.screen, 'width', { value: width, configurable: true });
  Object.defineProperty(window.screen, 'height', { value: height, configurable: true });
}

const IPHONE = { maxTouchPoints: 5, width: 430, height: 932 };
const IPAD = { maxTouchPoints: 5, width: 834, height: 1194 };
const DESKTOP = { maxTouchPoints: 0, width: 2560, height: 1440 };

describe('isPhoneClassTouchDevice', () => {
  afterEach(() => setDevice(DESKTOP));

  it('is true on an iPhone-class touch screen', () => {
    setDevice(IPHONE);
    expect(isPhoneClassTouchDevice()).toBe(true);
  });

  it('is false on iPad — that device keeps the native inputmode path', () => {
    setDevice(IPAD);
    expect(isPhoneClassTouchDevice()).toBe(false);
  });

  it('is false without a touch screen, whatever the window size', () => {
    setDevice({ maxTouchPoints: 0, width: 375, height: 667 });
    expect(isPhoneClassTouchDevice()).toBe(false);
  });

  it('gates on the toggle as well as the device', () => {
    setDevice(IPHONE);
    setSuppressKbd(false);
    expect(shouldAttachHardwareKeyboardBridge()).toBe(false);
    setSuppressKbd(true);
    expect(shouldAttachHardwareKeyboardBridge()).toBe(true);
    setSuppressKbd(false);
  });
});

describe('attachHardwareKeyboardBridge', () => {
  let container;
  let term;
  let detach;
  let sent;

  const keydown = (init) => {
    const target = container.querySelector('[data-aw-kbd-proxy]') || container;
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  };

  beforeEach(() => {
    setDevice(IPHONE);
    setSuppressKbd(true);
    container = document.createElement('div');
    document.body.appendChild(container);
    term = new Terminal({ allowProposedApi: true });
    term.open(container);
    sent = [];
    term.onData((d) => sent.push(d));
    detach = attachHardwareKeyboardBridge(term, container);
  });

  afterEach(() => {
    detach?.();
    term.dispose();
    container.remove();
    setSuppressKbd(false);
    setDevice(DESKTOP);
  });

  it('does not attach when the toggle is off', () => {
    detach();
    setSuppressKbd(false);
    const off = attachHardwareKeyboardBridge(term, container);
    expect(container.querySelector('[data-aw-kbd-proxy]')).toBeNull();
    off();
  });

  it('does not attach on an iPad-class screen', () => {
    detach();
    setDevice(IPAD);
    const off = attachHardwareKeyboardBridge(term, container);
    expect(container.querySelector('[data-aw-kbd-proxy]')).toBeNull();
    off();
  });

  it('mounts a focusable, non-editable proxy', () => {
    const proxy = container.querySelector('[data-aw-kbd-proxy]');
    expect(proxy).toBeTruthy();
    expect(proxy.getAttribute('tabindex')).toBe('0');
    // Editability is the whole bug — iOS shows the keyboard for these.
    // (jsdom leaves isContentEditable undefined, hence falsy rather than false.)
    expect(proxy.isContentEditable).toBeFalsy();
    expect(proxy.hasAttribute('contenteditable')).toBe(false);
    expect(proxy.tagName).toBe('DIV');
    expect(isKbdFocusProxy(proxy)).toBe(true);
    expect(isKbdFocusProxy(term.textarea)).toBe(false);
  });

  it('redirects term.focus() onto the proxy, not the textarea', () => {
    term.focus();
    expect(document.activeElement).toBe(container.querySelector('[data-aw-kbd-proxy]'));
    expect(document.activeElement).not.toBe(term.textarea);
  });

  it('forwards arrow keys as the escape sequences xterm produces', () => {
    keydown({ key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38 });
    keydown({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
    keydown({ key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 });
    keydown({ key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 });
    expect(sent).toEqual(['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D']);
  });

  it('forwards the iOS hardware-arrow shape (keyCode 0, UIKeyInputUpArrow)', () => {
    // WebKit 149054: iOS emits this for a Bluetooth keyboard's arrow keys.
    // Handled by evaluateKeyboardEvent's `case 0:` branch — the reason we
    // re-dispatch into xterm instead of writing our own key mapping.
    keydown({ key: 'UIKeyInputUpArrow', keyCode: 0, which: 0 });
    expect(sent).toEqual(['\x1b[A']);
  });

  it('forwards Ctrl+C as SIGINT', () => {
    keydown({ key: 'c', code: 'KeyC', keyCode: 67, which: 67, ctrlKey: true });
    expect(sent).toEqual(['\x03']);
  });

  it('forwards Enter as CR', () => {
    keydown({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
    expect(sent).toEqual(['\r']);
  });

  it('forwards a lowercase letter', () => {
    keydown({ key: 'a', code: 'KeyA', keyCode: 65, which: 65 });
    expect(sent).toEqual(['a']);
  });

  it('forwards an uppercase letter exactly once (xterm A-Z carve-out)', () => {
    // xterm's _keyDown deliberately sends NOTHING for a plain A-Z, deferring
    // to `keypress`, which we cannot rely on for a non-editable div. The
    // bridge covers it via term.input() — the risk being a double send.
    keydown({ key: 'A', code: 'KeyA', keyCode: 65, which: 65, shiftKey: true });
    expect(sent).toEqual(['A']);
  });

  it('does not double-send when a real keydown reaches the textarea itself', () => {
    term.textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
    expect(sent).toEqual(['\r']);
  });

  it('detach restores the real focus behaviour and removes the proxy', () => {
    detach();
    expect(container.querySelector('[data-aw-kbd-proxy]')).toBeNull();
    term.focus();
    expect(document.activeElement).toBe(term.textarea);
    // ...and stops forwarding.
    sent = [];
    container.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
    expect(sent).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Terminal } from '@xterm/xterm';
import TerminalWindow from '../components/TerminalWindow';
import { setSuppressKbd } from '../lib/keyboardMode';

// xterm's CoreBrowserService reads window.matchMedia for the device pixel
// ratio; jsdom doesn't implement it. Same shim as hardwareKeyboardBridge.test.js.
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
const DESKTOP = { maxTouchPoints: 0, width: 2560, height: 1440 };

function ctrlC(textarea) {
  textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'c', code: 'KeyC', keyCode: 67, which: 67, ctrlKey: true,
    bubbles: true, cancelable: true,
  }));
}

describe('TerminalWindow execCommandCopy — bridge-mode guard (design §2c)', () => {
  let hasSelectionSpy;
  let getSelectionSpy;
  let originalClipboard;

  beforeEach(() => {
    hasSelectionSpy = vi.spyOn(Terminal.prototype, 'hasSelection').mockReturnValue(true);
    getSelectionSpy = vi.spyOn(Terminal.prototype, 'getSelection').mockReturnValue('selected text');
    originalClipboard = navigator.clipboard;
    // Absent clipboard forces the execCommandCopy fallback path — the one
    // that must be skipped in bridge mode.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  afterEach(() => {
    cleanup();
    hasSelectionSpy.mockRestore();
    getSelectionSpy.mockRestore();
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    setSuppressKbd(false);
    setDevice(DESKTOP);
  });

  it('does not append a throwaway textarea when the hardware-keyboard bridge would attach', () => {
    setDevice(IPHONE);
    setSuppressKbd(true);
    const { container } = render(<TerminalWindow sessionId="test-session-bridge" chromeless />);
    const textarea = container.querySelector('.xterm-helper-textarea');
    expect(textarea).toBeTruthy();

    const before = document.body.querySelectorAll('textarea').length;
    ctrlC(textarea);
    expect(document.body.querySelectorAll('textarea').length).toBe(before);
  });

  it('still runs the throwaway-textarea fallback outside bridge mode (desktop)', () => {
    setDevice(DESKTOP);
    setSuppressKbd(false);
    const { container } = render(<TerminalWindow sessionId="test-session-desktop" chromeless />);
    const textarea = container.querySelector('.xterm-helper-textarea');
    expect(textarea).toBeTruthy();

    const before = document.body.querySelectorAll('textarea').length;
    ctrlC(textarea);
    // execCommand('copy') is not implemented in jsdom and throws, which the
    // fallback swallows — what matters here is that it *ran*, i.e. it
    // appended-then-removed its own textarea rather than short-circuiting.
    // A thrown execCommand leaves the throwaway node behind (removeChild is
    // never reached), so its presence is the signal the fallback executed.
    expect(document.body.querySelectorAll('textarea').length).toBe(before + 1);
  });
});

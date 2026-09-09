import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  APP_KBD_MSG,
  APP_KBD_HELLO,
  originForIframeSrc,
  postSuppressState,
  installAppIframeKbdSync,
} from '../lib/appIframeKbd';
import { setSuppressKbd } from '../lib/keyboardMode';

// What this file can and cannot prove: these are the SHELL-side mechanics —
// which origin we target, and that all three send legs fire. Whether iOS
// actually keeps its on-screen keyboard down is not observable from jsdom (or
// from any headless browser); only a real iPhone answers that.

const APP_ORIGIN = 'https://code-server.app.example.com';
const APP_SRC = `${APP_ORIGIN}/?folder=/opt/aw-workspace`;

/**
 * Stand-in for a cross-origin iframe. jsdom will not actually load one, and a
 * real `contentWindow` would reject a postMessage to a foreign origin, so the
 * contentWindow is a spy — the thing under test is which origin we pass it.
 */
function fakeIframe(src = APP_SRC) {
  const postMessage = vi.fn();
  return { src, contentWindow: { postMessage }, postMessage };
}

describe('originForIframeSrc', () => {
  it('derives the app origin from the iframe src', () => {
    expect(originForIframeSrc(APP_SRC)).toBe(APP_ORIGIN);
  });

  it('drops the path and query', () => {
    expect(originForIframeSrc(`${APP_ORIGIN}/a/b?c=d#e`)).toBe(APP_ORIGIN);
  });

  it('returns null for a src it cannot use, so no caller can fall back to "*"', () => {
    expect(originForIframeSrc('')).toBeNull();
    expect(originForIframeSrc(null)).toBeNull();
    expect(originForIframeSrc('about:blank')).toBeNull();
    expect(originForIframeSrc('data:text/html,hi')).toBeNull();
    expect(originForIframeSrc('javascript:void 0')).toBeNull();
  });
});

describe('postSuppressState', () => {
  it('posts the state to the iframe origin, never to a wildcard', () => {
    const iframe = fakeIframe();
    expect(postSuppressState(iframe, true)).toBe(true);
    expect(iframe.postMessage).toHaveBeenCalledWith(
      { type: APP_KBD_MSG, on: true },
      APP_ORIGIN,
    );
    expect(iframe.postMessage.mock.calls[0][1]).not.toBe('*');
  });

  it('sends the off state too — suppression has to be revocable', () => {
    const iframe = fakeIframe();
    postSuppressState(iframe, false);
    expect(iframe.postMessage).toHaveBeenCalledWith(
      { type: APP_KBD_MSG, on: false },
      APP_ORIGIN,
    );
  });

  it('coerces to a boolean rather than forwarding whatever it was given', () => {
    const iframe = fakeIframe();
    postSuppressState(iframe, 1);
    expect(iframe.postMessage.mock.calls[0][0]).toEqual({ type: APP_KBD_MSG, on: true });
  });

  it('is a no-op for a missing iframe, an unusable src or a dead frame', () => {
    expect(postSuppressState(null, true)).toBe(false);
    expect(postSuppressState({ src: 'about:blank', contentWindow: {} }, true)).toBe(false);
    expect(postSuppressState({ src: APP_SRC, contentWindow: null }, true)).toBe(false);
  });
});

describe('installAppIframeKbdSync', () => {
  let iframe;
  let cleanup;

  const hello = (opts = {}) =>
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: APP_KBD_HELLO },
      origin: opts.origin ?? APP_ORIGIN,
      source: 'source' in opts ? opts.source : iframe.contentWindow,
    }));

  beforeEach(() => {
    setSuppressKbd(false);
    iframe = fakeIframe();
    cleanup = installAppIframeKbdSync(() => iframe);
  });

  afterEach(() => {
    cleanup?.();
    setSuppressKbd(false);
  });

  it('answers the app hello with the current state', () => {
    setSuppressKbd(true);
    iframe.postMessage.mockClear();
    hello();
    expect(iframe.postMessage).toHaveBeenCalledWith(
      { type: APP_KBD_MSG, on: true },
      APP_ORIGIN,
    );
  });

  it('pushes every toggle change without being asked', () => {
    setSuppressKbd(true);
    expect(iframe.postMessage).toHaveBeenLastCalledWith(
      { type: APP_KBD_MSG, on: true },
      APP_ORIGIN,
    );
    setSuppressKbd(false);
    expect(iframe.postMessage).toHaveBeenLastCalledWith(
      { type: APP_KBD_MSG, on: false },
      APP_ORIGIN,
    );
  });

  it('ignores a hello from another origin', () => {
    hello({ origin: 'https://evil.example.com' });
    expect(iframe.postMessage).not.toHaveBeenCalled();
  });

  it('ignores a hello whose source is not this iframe', () => {
    hello({ source: { postMessage: vi.fn() } });
    expect(iframe.postMessage).not.toHaveBeenCalled();
  });

  it('ignores messages that are not a hello', () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'something-else' },
      origin: APP_ORIGIN,
      source: iframe.contentWindow,
    }));
    window.dispatchEvent(new MessageEvent('message', {
      data: 'a string', origin: APP_ORIGIN, source: iframe.contentWindow,
    }));
    expect(iframe.postMessage).not.toHaveBeenCalled();
  });

  it('reads the iframe through the getter, so a swapped ref is still reached', () => {
    const replacement = fakeIframe();
    iframe = replacement;
    hello();
    expect(replacement.postMessage).toHaveBeenCalled();
  });

  it('survives having no iframe yet', () => {
    iframe = null;
    expect(() => setSuppressKbd(true)).not.toThrow();
  });

  it('stops listening after cleanup', () => {
    cleanup();
    cleanup = null;
    const stale = iframe;
    setSuppressKbd(true);
    hello();
    expect(stale.postMessage).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import TerminalWindow from '../components/TerminalWindow';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (q) => ({
      matches: false, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    });
  }
});

describe('TerminalWindow Ctrl+V OS gating and handleDrop upload', () => {
  let originalUserAgent;
  let originalClipboard;
  let originalWebSocket;
  let originalFetch;
  let sentPayloads;

  beforeEach(() => {
    originalUserAgent = navigator.userAgent;
    originalClipboard = navigator.clipboard;
    originalWebSocket = global.WebSocket;
    originalFetch = global.fetch;
    sentPayloads = [];

    class RecordingWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 1;
        this.onopen = null;
        this.onclose = null;
        this.onmessage = null;
        this.onerror = null;
        setTimeout(() => this.onopen?.(), 0);
      }
      send(data) {
        sentPayloads.push(ArrayBuffer.isView(data) ? new TextDecoder().decode(data) : String(data));
      }
      close(code = 1000, reason = '') {
        this.readyState = 3;
        this.onclose?.({ code, reason });
      }
    }
    RecordingWebSocket.OPEN = 1;
    global.WebSocket = RecordingWebSocket;
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    global.WebSocket = originalWebSocket;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does not intercept Ctrl+V on Linux/Windows so native paste handles text and images', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0',
      configurable: true,
    });
    const read = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, 'clipboard', { value: { read }, configurable: true });

    const { container } = render(
      <TerminalWindow sessionId="linux-agent" agentType="claude" isClaude chromeless />,
    );
    const textarea = container.querySelector('.xterm-helper-textarea');
    expect(textarea).toBeTruthy();

    const ev = new KeyboardEvent('keydown', {
      key: 'v', code: 'KeyV', keyCode: 86, which: 86, ctrlKey: true,
      bubbles: true, cancelable: true,
    });
    textarea.dispatchEvent(ev);
    // On Linux/Windows, the macOS Ctrl+V image-clipboard intercept must NOT run;
    // xterm handles the key normally without calling navigator.clipboard.read().
    expect(read).not.toHaveBeenCalled();
  });

  it('intercepts Ctrl+V on macOS agent terminals and forwards \\x16 when clipboard has no image', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      configurable: true,
    });
    const read = vi.fn().mockResolvedValue([{ types: ['text/plain'], getType: vi.fn() }]);
    Object.defineProperty(navigator, 'clipboard', { value: { read }, configurable: true });

    const { container } = render(
      <TerminalWindow sessionId="mac-agent" agentType="claude" isClaude chromeless />,
    );
    const textarea = container.querySelector('.xterm-helper-textarea');
    expect(textarea).toBeTruthy();

    const ev = new KeyboardEvent('keydown', {
      key: 'v', code: 'KeyV', keyCode: 86, which: 86, ctrlKey: true,
      bubbles: true, cancelable: true,
    });
    // attachCustomKeyEventHandler returns false so xterm itself skips the key
    // (does not call preventDefault or synchronously emit \x16), and instead
    // resolves clipboard.read() before sending \x16 when no image is found.
    const notCanceled = textarea.dispatchEvent(ev);
    expect(notCanceled).toBe(true);
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledOnce();
      expect(sentPayloads).toContain('\x16');
    });
  });

  it('uploads dropped files via uploadTerminalImage and writes returned path to WebSocket', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: '/tmp/aw-drops/diagram.png' }),
    });

    const { container } = render(
      <TerminalWindow sessionId="drop-agent" agentType="claude" isClaude chromeless />,
    );
    const root = container.querySelector('.terminal-window');
    expect(root).toBeTruthy();

    const droppedFile = new File(['png-bytes'], 'diagram.png', { type: 'image/png' });
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [droppedFile] },
    });
    fireEvent(root, dropEvent);

    await vi.waitFor(() => {
      expect(sentPayloads).toContain('/tmp/aw-drops/diagram.png ');
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/terminals/upload',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    );
    const [, opts] = global.fetch.mock.calls.find(([url]) => url === '/api/terminals/upload');
    expect(opts.body.get('file').name).toBe('diagram.png');
  });
});

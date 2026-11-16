import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import TerminalKeyboard from '../components/TerminalKeyboard';

describe('TerminalKeyboard paste and attach', () => {
  let originalClipboard;
  let originalFetch;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalFetch = global.fetch;
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('pastes text from single clipboard.read() call without sequential readText()', async () => {
    const textBlob = new Blob(['pasted command'], { type: 'text/plain' });
    const read = vi.fn().mockResolvedValue([
      { types: ['text/plain'], getType: vi.fn().mockResolvedValue(textBlob) },
    ]);
    const readText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { read, readText }, configurable: true });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { getByTitle } = render(<TerminalKeyboard sessionId="kbd-sess" />);
    // Open keyboard panel from FAB
    fireEvent.click(getByTitle('Open keyboard'));

    fireEvent.click(getByTitle('Paste from clipboard'));

    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/terminals/kbd-sess/write',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'pasted command' }),
        }),
      );
    });
    expect(read).toHaveBeenCalledOnce();
    expect(readText).not.toHaveBeenCalled();
  });

  it('uploads attached file via uploadTerminalImage and writes returned path', async () => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url === '/api/terminals/upload') {
        return { ok: true, json: async () => ({ path: '/tmp/aw-drops/photo.jpg' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { getByTitle } = render(<TerminalKeyboard sessionId="kbd-sess" />);
    fireEvent.click(getByTitle('Open keyboard'));

    const attachLabel = getByTitle('Attach file');
    const input = attachLabel.querySelector('input[type="file"]');
    const file = new File(['jpg-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/terminals/kbd-sess/write',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: '/tmp/aw-drops/photo.jpg ' }),
        }),
      );
    });
    const uploadCall = global.fetch.mock.calls.find(([url]) => url === '/api/terminals/upload');
    expect(uploadCall).toBeTruthy();
    expect(uploadCall[1].body.get('file').name).toBe('photo.jpg');
  });
});

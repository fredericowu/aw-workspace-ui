import { describe, it, expect, vi } from 'vitest';
import {
  extractClipboardImageFiles,
  clipboardImageFilename,
  readClipboardImageBlobs,
  uploadTerminalImage,
} from '../lib/terminalClipboardImage';

describe('extractClipboardImageFiles', () => {
  it('returns empty array when clipboardData is null or empty', () => {
    expect(extractClipboardImageFiles(null)).toEqual([]);
    expect(extractClipboardImageFiles({})).toEqual([]);
  });

  it('extracts image files from clipboardData.items and ignores text items', () => {
    const imgFile = new Blob(['png-bytes'], { type: 'image/png' });
    const clipboardData = {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => imgFile },
        { kind: 'file', type: 'application/pdf', getAsFile: () => new Blob(['pdf'], { type: 'application/pdf' }) },
      ],
    };
    expect(extractClipboardImageFiles(clipboardData)).toEqual([imgFile]);
  });

  it('falls back to clipboardData.files when items is absent or yields nothing', () => {
    const jpgFile = new Blob(['jpg-bytes'], { type: 'image/jpeg' });
    const txtFile = new Blob(['hello'], { type: 'text/plain' });
    const clipboardData = {
      files: [jpgFile, txtFile],
    };
    expect(extractClipboardImageFiles(clipboardData)).toEqual([jpgFile]);
  });
});

describe('clipboardImageFilename', () => {
  it('builds a unique filename with the right extension for common image MIME types', () => {
    const pngName1 = clipboardImageFilename(new Blob([''], { type: 'image/png' }), 1700000000000);
    const pngName2 = clipboardImageFilename(new Blob([''], { type: 'image/png' }), 1700000000000);
    expect(pngName1).toMatch(/^clipboard-1700000000000-[a-z0-9]+\.png$/);
    expect(pngName2).toMatch(/^clipboard-1700000000000-[a-z0-9]+\.png$/);
    expect(pngName1).not.toBe(pngName2);

    const jpgName = clipboardImageFilename(new Blob([''], { type: 'image/jpeg' }), 1700000000000);
    expect(jpgName).toMatch(/^clipboard-1700000000000-[a-z0-9]+\.jpg$/);

    const webpName = clipboardImageFilename(new Blob([''], { type: 'image/webp' }), 1700000000000);
    expect(webpName).toMatch(/^clipboard-1700000000000-[a-z0-9]+\.webp$/);
  });

  it('defaults to .png when blob has no type', () => {
    const name = clipboardImageFilename({}, 12345);
    expect(name).toMatch(/^clipboard-12345-[a-z0-9]+\.png$/);
  });
});

describe('readClipboardImageBlobs', () => {
  it('extracts image blobs from navigator.clipboard.read()', async () => {
    const pngBlob = new Blob(['png'], { type: 'image/png' });
    const mockClipboard = {
      read: vi.fn().mockResolvedValue([
        {
          types: ['text/plain', 'image/png'],
          getType: vi.fn().mockImplementation(async (t) => (t === 'image/png' ? pngBlob : null)),
        },
      ]),
    };

    const blobs = await readClipboardImageBlobs(mockClipboard);
    expect(blobs).toEqual([pngBlob]);
    expect(mockClipboard.read).toHaveBeenCalledOnce();
  });

  it('returns empty array when clipboard contains only text or rejects', async () => {
    const textOnlyClipboard = {
      read: vi.fn().mockResolvedValue([
        { types: ['text/plain'], getType: vi.fn() },
      ]),
    };
    expect(await readClipboardImageBlobs(textOnlyClipboard)).toEqual([]);

    const deniedClipboard = {
      read: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
    };
    expect(await readClipboardImageBlobs(deniedClipboard)).toEqual([]);
    expect(await readClipboardImageBlobs(null)).toEqual([]);
  });
});

describe('uploadTerminalImage', () => {
  it('uploads blob as multipart FormData with unique filename and returns server path', async () => {
    const blob = new Blob(['image-data'], { type: 'image/png' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: '/tmp/aw-drops/clipboard-123-abcd.png', filename: 'clipboard-123-abcd.png' }),
    });

    const path = await uploadTerminalImage(blob, { fetchImpl: fetchMock, apiBase: '' });
    expect(path).toBe('/tmp/aw-drops/clipboard-123-abcd.png');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/terminals/upload');
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);
    const uploadedFile = options.body.get('file');
    expect(uploadedFile).toBeTruthy();
    expect(uploadedFile.name).toMatch(/^clipboard-\d+-[a-z0-9]+\.png$/);
  });

  it('returns null when upload fails or response is not ok', async () => {
    const blob = new Blob(['image-data'], { type: 'image/png' });
    const failFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await uploadTerminalImage(blob, { fetchImpl: failFetch })).toBeNull();

    const rejectFetch = vi.fn().mockRejectedValue(new Error('network error'));
    expect(await uploadTerminalImage(blob, { fetchImpl: rejectFetch })).toBeNull();
  });
});

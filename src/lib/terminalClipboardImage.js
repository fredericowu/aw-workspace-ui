const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

/**
 * Extract image File/Blob items from a paste event's DataTransfer (`e.clipboardData`).
 * Checks `clipboardData.items` first (standard for screenshots/copied images) and
 * falls back to `clipboardData.files`.
 */
export function extractClipboardImageFiles(clipboardData) {
  if (!clipboardData) return [];
  const files = [];

  if (clipboardData.items && clipboardData.items.length) {
    for (const item of Array.from(clipboardData.items)) {
      if (item && item.kind === 'file' && typeof item.type === 'string' && item.type.startsWith('image/')) {
        const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
        if (file) files.push(file);
      }
    }
  }

  if (files.length === 0 && clipboardData.files && clipboardData.files.length) {
    for (const file of Array.from(clipboardData.files)) {
      if (file && typeof file.type === 'string' && file.type.startsWith('image/')) {
        files.push(file);
      }
    }
  }

  return files;
}

/**
 * Build a unique filename for a pasted clipboard image blob so consecutive
 * pasted screenshots do not overwrite `/tmp/aw-drops/image.png` on the server.
 */
export function clipboardImageFilename(blob, now = Date.now()) {
  const mime = (blob && typeof blob.type === 'string' ? blob.type : '').toLowerCase();
  const ext =
    MIME_TO_EXT[mime] ||
    (mime.startsWith('image/') ? mime.slice(6).replace(/[^a-z0-9]/gi, '') : '') ||
    'png';
  const rand = Math.random().toString(36).slice(2, 6);
  return `clipboard-${now}-${rand}.${ext}`;
}

/**
 * Read image blobs from the Async Clipboard API (`navigator.clipboard.read()`).
 * Used when pasting via keyboard shortcuts that do not emit a native `paste`
 * event (e.g. `Ctrl+V` on macOS in Claude/Codex/Antigravity terminals, or the
 * iOS hardware-keyboard bridge / virtual keyboard paste button).
 */
export async function readClipboardImageBlobs(
  clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null,
) {
  if (!clipboard || typeof clipboard.read !== 'function') return [];
  try {
    const items = await clipboard.read();
    if (!Array.isArray(items)) return [];
    const blobs = [];
    for (const item of items) {
      const types = Array.isArray(item?.types) ? item.types : [];
      const imgType = types.find((t) => typeof t === 'string' && t.startsWith('image/'));
      if (imgType && typeof item.getType === 'function') {
        const blob = await item.getType(imgType);
        if (blob) blobs.push(blob);
      }
    }
    return blobs;
  } catch {
    return [];
  }
}

/**
 * Upload an image Blob/File to `/api/terminals/upload` and return its server-side path.
 */
export async function uploadTerminalImage(blob, { fetchImpl = fetch, apiBase = '' } = {}) {
  if (!blob || typeof fetchImpl !== 'function') return null;
  const formData = new FormData();
  formData.append('file', blob, clipboardImageFilename(blob));
  try {
    const res = await fetchImpl(`${apiBase}/api/terminals/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    return data?.path || null;
  } catch {
    return null;
  }
}

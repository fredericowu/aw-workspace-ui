/**
 * Desktop-on-phone viewport width chooser.
 *
 * Lets the user pick how wide the layout viewport should be when they
 * force `#desktop` mode on an iPhone/iPad in regular Safari.  Wider
 * values make the UI render smaller (better when mirrored to a TV /
 * external monitor); narrower values keep things readable on the
 * phone screen alone.
 *
 * State persists in localStorage (`aw_desktop_width`).  The companion
 * inline script in index.html reads the same key on initial paint so
 * the choice survives reloads without a layout flash.
 */

const KEY = 'aw_desktop_width';
export const DEFAULT_WIDTH = '1600';
export const WIDTH_OPTIONS = [
  'device',
  '1280',
  '1440',
  '1600',
  '1800',
  '1920',
  '2048',
  '2400',
  '2880',
];

export function getDesktopWidth() {
  try { return localStorage.getItem(KEY) || DEFAULT_WIDTH; } catch { return DEFAULT_WIDTH; }
}

export function setDesktopWidth(w) {
  try {
    if (w && w !== DEFAULT_WIDTH) localStorage.setItem(KEY, w);
    else localStorage.removeItem(KEY);
  } catch {}
  applyToMeta(w || DEFAULT_WIDTH);
}

/**
 * Swap the `<meta name="viewport">` element in place.  iOS Safari does
 * NOT re-evaluate the viewport when you mutate the `content` attribute
 * after first paint — you have to replace the node.  Insert the fresh
 * one first, then remove the old, so there's never a moment without a
 * viewport meta in the head.
 */
export function applyToMeta(w) {
  const old = document.querySelector('meta[name="viewport"]');
  if (!old) return;
  const fresh = document.createElement('meta');
  fresh.id = 'aw-viewport';
  fresh.name = 'viewport';
  if (w === 'device') {
    fresh.content = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
  } else {
    fresh.content = `width=${w}, minimum-scale=0.1, maximum-scale=3, user-scalable=yes, viewport-fit=cover`;
  }
  if (old.parentNode) {
    old.parentNode.insertBefore(fresh, old);
    old.remove();
  }
}

/** True only on physically phone-sized devices, where the picker makes sense. */
export function isPhoneSized() {
  try {
    return Math.min(window.screen.width, window.screen.height) < 768;
  } catch {
    return false;
  }
}

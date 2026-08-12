// The `appwin:` window-key format, and the localStorage record that lets a
// reload rebuild the app windows a previous page load left open.
//
// Any app contributing `contributes.windows[]` gets this for free — nothing
// here knows about a specific app, and nothing should ever be added that does
// (2026-08-04 decision: aw-workspace-ui owns the generic window shell only).
//
// WHY A SEPARATE RECORD FROM `aw-open-windows`
//
// `openWindows` is a Set of window keys — enough to restore a terminal, whose
// key IS its session id, but not an app window. An app window also needs the
// contribution its body renders from, which App.jsx holds in `appWindowSpecs`
// as plain React state: it dies on reload. What we must NOT do is persist that
// spec — it's resolved server-side from the app's manifest (title, icon, body
// type, inlined declarative spec_data) and goes stale the moment the app is
// updated or uninstalled. So we persist only the window's IDENTITY and re-look
// up the spec from a fresh /api/apps/-/contributions on every load.
//
// The one piece of identity that isn't derivable from the contributions is the
// title: for a multi-instance window it's supplied per-instance by the app at
// open time (`__awOpenAppWindow(windowId, instanceId, title)`) — "Diff Tool —
// titlebar", not the generic "Diff" from the manifest — so it's recorded here
// too.

export const APP_WINDOWS_KEY = 'aw-app-windows';

// `appwin:<windowId>` for a singleton window (Whiteboard, Tasks), or
// `appwin:<windowId>:<instanceId>` for one instance of a multi-instance window
// (one diff per diff id, one presentation per presentation id).
export function appWindowKey(windowId, instanceId) {
  return instanceId ? `appwin:${windowId}:${instanceId}` : `appwin:${windowId}`;
}

export function isAppWindowKey(key) {
  return typeof key === 'string' && key.startsWith('appwin:');
}

// Inverse of appWindowKey. Window ids are namespaced `<slug>.<name>` (ADR
// "Apps Own Their Front + Back Routes" Decision 8) and so never contain a
// colon — the FIRST colon after the prefix is therefore always the
// windowId/instanceId separator, no matter what the instance id looks like.
//
// Getting this wrong is what made restored multi-instance windows come back
// blank: passing the whole `<windowId>:<instanceId>` tail as a window id
// matches no contribution, so nothing reopened while the key stayed in
// `openWindows` — leaving a titleless, bodyless "App" window on screen.
export function parseAppWindowKey(key) {
  if (!isAppWindowKey(key)) return null;
  const rest = key.slice('appwin:'.length);
  if (!rest) return null;
  const sep = rest.indexOf(':');
  if (sep === -1) return { windowId: rest, instanceId: undefined };
  const instanceId = rest.slice(sep + 1);
  return { windowId: rest.slice(0, sep), instanceId: instanceId || undefined };
}

export function readPersistedAppWindows() {
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_WINDOWS_KEY) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Derives the persisted record from App.jsx's live `appWindowSpecs`, so the
// two can't drift: a window that isn't in the map is not open, and closing one
// prunes it here on the next write with no separate bookkeeping.
export function persistAppWindows(appWindowSpecs) {
  const identities = {};
  for (const [key, spec] of Object.entries(appWindowSpecs || {})) {
    if (!spec?.id) continue;
    identities[key] = { windowId: spec.id, instanceId: spec.instanceId, title: spec.title };
  }
  try {
    localStorage.setItem(APP_WINDOWS_KEY, JSON.stringify(identities));
  } catch { /* quota/private-mode — restoring windows is best-effort */ }
  return identities;
}

// What a reload needs for one persisted key: the saved identity when we have
// it, else whatever the key itself carries. The fallback matters for keys
// written by a build older than this record (their `openWindows` survives an
// upgrade, this map doesn't exist yet) — those restore without their
// per-instance title rather than not at all.
export function identityForKey(key, persisted) {
  const saved = persisted?.[key];
  if (saved?.windowId) return saved;
  const parsed = parseAppWindowKey(key);
  return parsed ? { ...parsed, title: undefined } : null;
}

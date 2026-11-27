// appWindowChrome — the single answer to "for this app: what is it called,
// what backs it, which controls are legal". Pure JS, no React: both the
// desktop shell (WindowManager's managedWindowAppEntry) and the mobile shell
// consume this instead of re-deriving any of it.
//
// See docs/knowledge_base/memory/mobile-apps-menu design notes for the
// rationale — the short version is that `managedWindowAppEntry` only ever
// covered the `managed_app` window body type (~9 of 24 visual apps); this
// module generalizes the same component-key/title resolution to every body
// type so both shells can open any launchable window.
import { appOrigin } from '../appHost';

// Mirrors AppLauncher.jsx:280 verbatim — manifests disagree on singular vs
// plural category names ("Service" vs "Services").
export function isCategory(app, name) {
  return (app?.category || '').trim().toLowerCase().replace(/s$/, '') === name;
}

// Mirrors src/apps/manifest.py Manifest.launchable_windows (windows minus
// any window that only serves as a settings panel) exactly. `installedApp`
// is a GET /api/apps row (carries `settings_panels`); `contributions` is the
// GET /api/apps/-/contributions payload (carries the raw `windows` list,
// each tagged with `app: <slug>`). If this Python rule changes, this must
// change with it — see AppRuntime.contributions() in src/apps/runtime.py.
export function launchableWindows(installedApp, contributions) {
  const settingsWindowIds = new Set(
    (installedApp?.settings_panels || []).map((p) => p.window)
  );
  const allWindows = (contributions?.windows || []).filter(
    (w) => w.app === installedApp?.slug
  );
  return allWindows.filter((w) => !settingsWindowIds.has(w.id));
}

// First launchable window for an app — the launch target used when opening
// an app from a grid/list rather than a specific nav entry.
export function defaultLaunchWindow(installedApp, contributions) {
  const windows = launchableWindows(installedApp, contributions);
  return windows[0] || null;
}

// The component-key ladder, lifted from WindowManager.jsx's original
// managedWindowAppEntry unchanged in order: body.component, windowSpec.component,
// legacyApp.component, `docker:aw-${appId}`, `docker:${appId}` — first one
// present in componentMap wins, else the first truthy candidate, else null.
export function resolveComponentKey({ appId, body, windowSpec, legacyApp, componentMap }) {
  const candidates = [
    body?.component,
    windowSpec?.component,
    legacyApp?.component,
    `docker:aw-${appId}`,
    `docker:${appId}`,
  ].filter(Boolean);
  return (
    candidates.find((key) => componentMap?.[key])
    || body?.component
    || windowSpec?.component
    || legacyApp?.component
    || null
  );
}

// windowSpec.title || legacyApp.label || legacyApp.name || installedApp.name || appId
// (legacyApp.name preserves the original managedWindowAppEntry fallback —
// some workspace_apps entries carry `name` instead of `label`.)
export function resolveTitle({ windowSpec, installedApp, legacyApp, appId }) {
  return (
    windowSpec?.title
    || legacyApp?.label
    || legacyApp?.name
    || installedApp?.name
    || appId
  );
}

// The one capability record both shells read for a given app + launch
// window. `componentMap` is a { [componentKey]: { key, status, standalone_app } }
// map built from GET /api/components (or the equivalent live component list).
export function appChrome({ appId, windowSpec, installedApp, legacyApp, componentMap }) {
  const body = windowSpec?.body || {};
  const bodyType = body.type;

  // Built exactly as the original managedWindowAppEntry did — installed-app
  // rows have no `url` field, so this is the only source for one.
  const path = body.path || '/';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = body.url || `${appOrigin(appId)}${normalizedPath}`;

  const component = resolveComponentKey({ appId, body, windowSpec, legacyApp, componentMap });
  const componentRow = component ? componentMap?.[component] : null;

  return {
    appId,
    title: resolveTitle({ windowSpec, installedApp, legacyApp, appId }),
    icon: windowSpec?.icon || body.icon || legacyApp?.icon || installedApp?.icon,
    component,
    status: componentRow?.status || 'off',
    bodyType,
    url,
    // Same predicate the desktop AppProxyWindow already applies inline
    // (WindowManager.jsx) — a container the framework can independently
    // start/stop/restart. `standalone_app` defaults to true when unset.
    canControlContainer: !!component && componentRow?.standalone_app !== false,
    canReloadFrame: bodyType === 'managed_app',
    canViewLogs: !!component,
  };
}

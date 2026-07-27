// Frontend contribution loader — the 3-mode runtime (ADR Decision 3b):
//
//   (a) declarative — the AppWindow renderer drives a spec JSON; NO app code
//       enters the SPA. Always allowed.
//   (b) component    — the app's prebuilt ESM bundle is dynamic-import()ed and
//       its register(host) mounts real React components into named slots. HIGH
//       trust: only honored for a SIGNED app granted `ui:code`; otherwise it is
//       forcibly DOWNGRADED to iframe (Decision 3b/4).
//   (c) iframe       — the app's served UI in a sandboxed <iframe> with a typed
//       postMessage bridge. No app JS enters the SPA context.
//
// `loadComponentPlugin` is the code path; the declarative/iframe modes are data
// the AppSlot/AppWindow components render, so the loader's job for them is just
// to resolve the effective mode. Returns a disposer for the component case.

import { hostForApp } from './pluginHost';

// Decide the mode actually honored, applying the trust gate. `app` carries the
// manifest-declared `frontend.mode`, `signed`, and `granted_permissions`.
export function effectiveMode(app) {
  const declared = app.frontend?.mode || app.mode || 'declarative';
  if (declared === 'declarative') return 'declarative';
  if (declared === 'component') {
    const granted = app.granted_permissions || app.grantedPermissions || [];
    const trusted = !!app.signed && granted.includes('ui:code');
    return trusted ? 'component' : 'iframe'; // untrusted → downgrade
  }
  return 'iframe';
}

// The `ui:slots:<id>` grants an app was given (component mode per-slot gate).
function grantedSlotsFor(app) {
  const perms = app.granted_permissions || app.grantedPermissions || [];
  return perms
    .filter((p) => p.startsWith('ui:slots:'))
    .map((p) => p.slice('ui:slots:'.length));
}

// Load a COMPONENT-mode plugin: dynamic-import the hashed bundle URL, hand its
// register() an app-scoped host, return a dispose fn. `importer` is injectable
// so tests supply a fake module without a network/module fetch.
export async function loadComponentPlugin(app, host, { importer } = {}) {
  if (effectiveMode(app) !== 'component') {
    throw new Error(`${app.slug}: component load refused (effective mode ${effectiveMode(app)})`);
  }
  const url = app.frontend?.bundle_url || app.bundle_url;
  if (!url) throw new Error(`${app.slug}: no frontend.bundle_url`);

  const doImport = importer || ((u) => import(/* @vite-ignore */ u));
  const mod = await doImport(url);
  const register = mod.register || mod.default;
  if (typeof register !== 'function') {
    throw new Error(`${app.slug}: bundle exports no register(host) function`);
  }

  const scoped = hostForApp(host, {
    slug: app.slug,
    grantedSlots: grantedSlotsFor(app),
  });
  await register(scoped);

  return function dispose() {
    scoped.dispose();
  };
}

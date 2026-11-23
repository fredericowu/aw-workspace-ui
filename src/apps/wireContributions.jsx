// wireContributions — turn a `/api/apps/-/contributions` payload into live SPA
// contributions (ADR F6 Capability 2). The F5 plugin runtime shipped as a
// library that App.jsx never called; this is the glue that makes it real:
//
//   (1) declarative `nav[]` entries → buttons mounted into the `core.nav`
//       (default) or `core.nav.workspace` (section:"workspace") slot; clicking
//       one opens the app's declarative `windows[]` window via AppWindow.
//   (2) `frontend[]` component-mode bundles → dynamic-imported and their
//       register(host) mounts real React components into their granted slots
//       (the trust gate in effectiveMode downgrades unsigned apps to iframe).
//
// Returns a disposer that unregisters everything (safe to call on re-fetch /
// unmount) so nothing leaks between contribution refreshes.
//
// REFRESHING is a DOUBLE-BUFFERED SWAP, not a teardown followed by a rebuild:
// pass the previous generation's disposer as `replace` and this function tears
// it down itself, in the same synchronous tick that mounts the new one. Doing
// it the other way round (caller disposes, then awaits this) is what made every
// app-contributed nav item blink out and back on each window refocus — the
// registry sat empty for the length of N bundle fetches, and AppSlot renders
// its (null) fallback for an empty slot.
import { slotRegistry as defaultRegistry } from './slotRegistry';
import { prepareComponentPlugin, effectiveMode } from './loadPlugin';
import AppIcon from '../components/AppIcon';

export async function wireContributions(contributions, host, {
  onOpenWindow,
  registry = defaultRegistry,
  importer, // injectable for tests; prod uses prepareComponentPlugin's dynamic import
  replace,  // previous generation's disposer — torn down inside the swap below
  retain,   // Set of app slugs whose OLD component code stays mounted (an open
            // window still runs it); their new bundle is not even fetched
  unchanged, // Set of app slugs whose per-app rev did not move: their mount is
             // carried over as-is (no re-fetch, no remount), so a rewire
             // triggered by ANOTHER app never touches them
} = {}) {
  const nav = contributions?.nav || [];
  const frontend = contributions?.frontend || [];

  // ── PREPARE ────────────────────────────────────────────────────────────────
  // Every await in this function lives here, and nothing below the registry is
  // touched yet, so whatever is currently on screen stays on screen. In
  // parallel, not sequentially: the bundles are independent, and serialising
  // them made the (previously visible) gap N round-trips long.
  const keepOld = (fe) => !!(retain?.has(fe.app) || unchanged?.has(fe.app)) && !!replace?.hasApp?.(fe.app);
  const prepared = await Promise.all(
    frontend
      .filter((fe) => effectiveMode(fe) === 'component' && !keepOld(fe))
      .map(async (fe) => {
        try {
          return { fe, mount: await prepareComponentPlugin(fe, host, importer ? { importer } : undefined) };
        } catch (e) {
          // One bad bundle must not cost the other apps their contributions.
          console.warn(`[apps] component load failed for ${fe.app}:`, e);
          return { fe, mount: null };
        }
      }),
  );

  // ── SWAP ───────────────────────────────────────────────────────────────────
  // Synchronous from here to the return. Do not add an `await` below this line:
  // any suspension point reopens the window where the slots are empty and the
  // nav disappears.
  const disposers = [];
  const appOffs = new Map(); // slug -> disposer of that app's component mount
  const retainedApps = [];   // carried because an open window pins the old code
  const carriedApps = [];    // every carried mount (pinned or simply unchanged)
  const failedApps = [];     // bundle failed to load/register in this generation
  let incomplete = false;
  // Coalesced into a single store notification, so the teardown-then-remount is
  // one atomic transition rather than a visit to "no apps contribute anything".
  const batch = typeof registry.batch === 'function'
    ? (fn) => registry.batch(fn)
    : (fn) => fn();

  batch(() => {
    // Carry the retained apps' old mounts over BEFORE tearing the previous
    // generation down, so its disposer no longer owns them.
    for (const fe of frontend) {
      if (!(retain?.has(fe.app) || unchanged?.has(fe.app)) || typeof replace?.detachApp !== 'function') continue;
      const off = replace.detachApp(fe.app);
      if (off) {
        appOffs.set(fe.app, off); disposers.push(off); carriedApps.push(fe.app);
        if (retain?.has(fe.app)) retainedApps.push(fe.app);
      }
    }
    if (replace) {
      // Failing to tear the old generation down is a leak, not a reason to skip
      // mounting the new one — keep going either way.
      try { replace(); } catch { /* superseded anyway */ }
    }

    // (1) declarative nav entries → slot buttons
    //
    // The two slots are laid out differently and a declarative entry has to
    // match whichever one it lands in, or it reads as a stray caption rather
    // than a menu item: `core.nav` is the horizontal top bar (compact, muted,
    // label-only), while `core.nav.workspace` is the Workspace dropdown, whose
    // native rows (Settings, Folders, Repos, …) are full-width icon + label.
    // Rendering the top-bar pill inside the dropdown is what made the Knowledge
    // Base entry show up as small grey text with no icon next to Tasks and
    // Whiteboard — those two are component-mode plugins that draw their own row.
    for (const entry of nav) {
      const inWorkspaceMenu = entry.section === 'workspace';
      const slot = inWorkspaceMenu ? 'core.nav.workspace' : 'core.nav';
      const off = registry.mount(slot, {
        id: `${entry.app}:nav:${entry.id}`,
        appId: entry.app,
        order: entry.order ?? 100,
        render: () => (inWorkspaceMenu ? (
          <button
            type="button"
            onClick={() => onOpenWindow?.(entry.opens, entry.app)}
            title={entry.label}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer text-left"
          >
            {/* Decorative: the label is right there. Without aria-hidden the
                unknown-icon letter badge leaks into the button's accessible
                name ("K Knowledge Base"). */}
            <span aria-hidden="true" className="flex shrink-0">
              <AppIcon
                icon={entry.icon}
                label={entry.label}
                className="text-[var(--color-text-muted)]"
              />
            </span>
            <span className="text-[13px] text-[var(--color-text-primary)]">{entry.label}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onOpenWindow?.(entry.opens, entry.app)}
            title={entry.label}
            className="px-3 py-1 text-xs rounded transition-colors cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5 flex items-center gap-1.5"
          >
            <span aria-hidden="true" className="flex shrink-0">
              <AppIcon icon={entry.icon} label={entry.label} size={12} />
            </span>
            {entry.label}
          </button>
        )),
      });
      disposers.push(off);
    }

    // (2) component-mode plugins → register(host) into their granted slots
    for (const { fe, mount } of prepared) {
      if (!mount) { incomplete = true; failedApps.push(fe.app); continue; }
      try {
        const off = mount();
        if (typeof off === 'function') { disposers.push(off); appOffs.set(fe.app, off); }
      } catch (e) {
        incomplete = true;
        failedApps.push(fe.app);
        console.warn(`[apps] component register failed for ${fe.app}:`, e);
      }
    }
  });

  const dispose = function dispose() {
    batch(() => {
      for (const off of disposers.splice(0)) {
        try { off(); } catch { /* keep disposing the rest */ }
      }
      appOffs.clear();
    });
  };
  // Hand an app's component mount to the NEXT generation instead of disposing
  // it with this one (see `retain`). Returns the disposer, or undefined.
  dispose.hasApp = (slug) => appOffs.has(slug);
  dispose.detachApp = (slug) => {
    const off = appOffs.get(slug);
    if (!off) return undefined;
    appOffs.delete(slug);
    const i = disposers.indexOf(off);
    if (i >= 0) disposers.splice(i, 1);
    return off;
  };
  dispose.retainedApps = retainedApps;
  // Which apps have a live component mount in this generation, and which of
  // those were carried over rather than freshly loaded (the caller records the
  // rev each mount was built from, to diff the next payload per app).
  dispose.mountedApps = [...appOffs.keys()];
  dispose.carriedApps = carriedApps;
  dispose.failedApps = failedApps;
  // True when at least one app did not make it into this generation. The caller
  // uses it to NOT record the contributions signature, so the next refresh
  // retries instead of treating the missing app as the steady state (a bundle
  // fetch that lost a race against the BYOD LAN-fast-path probe used to drop
  // that app's nav until a full page reload).
  dispose.incomplete = incomplete;
  return dispose;
}

// Look up a window contribution's resolved declarative spec by id (the backend
// inlines `body.spec_data` — see AppRuntime._resolve_window).
export function findWindowSpec(contributions, windowId) {
  const win = (contributions?.windows || []).find((w) => w.id === windowId);
  if (!win) return null;
  return {
    id: win.id,
    app: win.app,
    title: win.title || win.id,
    icon: win.icon,
    body: win.body || {},
    spec: win.body?.spec_data || null,
    rev: contributions?.app_revs?.[win.app],
  };
}

// Look up an app's DEFAULT window (its first declared `contributes.windows[]`
// entry — each window carries `app: <slug>` per AppRuntime.contributions()).
// Used to open a framework-installed app straight from its Apps-view card,
// where there's no nav entry (and therefore no window id) to click through.
export function findAppDefaultWindow(contributions, appId) {
  const win = (contributions?.windows || []).find((w) => w.app === appId);
  if (!win) return null;
  return {
    id: win.id,
    app: win.app,
    title: win.title || win.id,
    icon: win.icon,
    body: win.body || {},
    spec: win.body?.spec_data || null,
    rev: contributions?.app_revs?.[win.app],
  };
}

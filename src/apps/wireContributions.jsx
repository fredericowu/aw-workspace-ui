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
import { slotRegistry as defaultRegistry } from './slotRegistry';
import { loadComponentPlugin, effectiveMode } from './loadPlugin';

export async function wireContributions(contributions, host, {
  onOpenWindow,
  registry = defaultRegistry,
  importer, // injectable for tests; prod uses loadComponentPlugin's dynamic import
} = {}) {
  const disposers = [];
  const nav = contributions?.nav || [];
  const frontend = contributions?.frontend || [];

  // (1) declarative nav entries → slot buttons
  for (const entry of nav) {
    const slot = entry.section === 'workspace' ? 'core.nav.workspace' : 'core.nav';
    const off = registry.mount(slot, {
      id: `${entry.app}:nav:${entry.id}`,
      appId: entry.app,
      order: entry.order ?? 100,
      render: () => (
        <button
          type="button"
          onClick={() => onOpenWindow?.(entry.opens, entry.app)}
          title={entry.label}
          className="px-3 py-1 text-xs rounded transition-colors cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5"
        >
          {entry.label}
        </button>
      ),
    });
    disposers.push(off);
  }

  // (2) component-mode plugins → register(host) into their granted slots
  for (const fe of frontend) {
    if (effectiveMode(fe) !== 'component') continue;
    try {
      const dispose = await loadComponentPlugin(fe, host, importer ? { importer } : undefined);
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[apps] component load failed for ${fe.app}:`, e);
    }
  }

  return function dispose() {
    for (const off of disposers.splice(0)) {
      try { off(); } catch { /* keep disposing the rest */ }
    }
  };
}

// Look up a window contribution's resolved declarative spec by id (the backend
// inlines `body.spec_data` — see AppRuntime._resolve_window).
export function findWindowSpec(contributions, windowId) {
  const win = (contributions?.windows || []).find((w) => w.id === windowId);
  if (!win) return null;
  return { title: win.title || win.id, spec: win.body?.spec_data || null };
}

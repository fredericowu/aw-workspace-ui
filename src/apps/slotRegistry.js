// Slot Registry — the frontend twin of the backend ExtensionRegistry
// (ADR Decision 3b). A reactive store of NAMED SLOTS → registered
// contributions, driven by useSyncExternalStore so any component rendering a
// slot re-renders on hot mount/unmount.
//
// Slot ids share the `<slug>.<name>` namespace rule (Decision 8). Core declares
// a fixed set; apps declare their own (`frontend.slots`) that other apps extend
// — same bidirectionality as the backend. A contribution is
// `{ id, appId, render, order }` where `render(props)` returns a React node
// (component mode) OR is a declarative descriptor rendered by AppSlot.
//
// Unmount is by contribution id or wholesale by appId (what an app's dispose
// calls), so tearing an app down empties every slot it filled — no residue.

export const CORE_SLOTS = Object.freeze([
  'core.nav',
  'core.menu.main',
  'core.settings.panels',
  'core.toolbar',
  'core.home.widgets',
]);

// Body slot id for a given window (`core.window.body:<window-id>`).
export function windowBodySlot(windowId) {
  return `core.window.body:${windowId}`;
}

export function createSlotRegistry() {
  // slotId -> Map(contribId -> entry)
  const slots = new Map();
  const listeners = new Set();
  // Per-slot frozen array cache so getSlot() returns a STABLE reference between
  // mutations — required for useSyncExternalStore not to loop.
  let cache = new Map();

  function emit() {
    cache = new Map();
    for (const l of listeners) l();
  }

  function ensure(slotId) {
    let m = slots.get(slotId);
    if (!m) { m = new Map(); slots.set(slotId, m); }
    return m;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // Register a contribution into a slot. `entry` = { id, appId, render, order }.
    // Returns an unmount fn for this single contribution.
    mount(slotId, entry) {
      if (!slotId || !entry || !entry.id) {
        throw new Error('slotRegistry.mount needs a slotId and entry.id');
      }
      ensure(slotId).set(entry.id, { order: 100, ...entry, slotId });
      emit();
      return () => this.unmount(slotId, entry.id);
    },

    unmount(slotId, contribId) {
      const m = slots.get(slotId);
      if (m && m.delete(contribId)) {
        if (m.size === 0) slots.delete(slotId);
        emit();
      }
    },

    // Remove every contribution an app registered, across all slots (dispose).
    unmountApp(appId) {
      let changed = false;
      for (const [slotId, m] of slots) {
        for (const [cid, entry] of m) {
          if (entry.appId === appId) { m.delete(cid); changed = true; }
        }
        if (m.size === 0) slots.delete(slotId);
      }
      if (changed) emit();
    },

    // Stable, order-sorted snapshot of a slot's contributions.
    getSlot(slotId) {
      if (cache.has(slotId)) return cache.get(slotId);
      const m = slots.get(slotId);
      const arr = m
        ? Array.from(m.values()).sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
        : EMPTY;
      cache.set(slotId, arr);
      return arr;
    },

    listSlots() {
      return Array.from(slots.keys());
    },

    // Test/introspection helper — total contribution count.
    size() {
      let n = 0;
      for (const m of slots.values()) n += m.size;
      return n;
    },
  };
}

const EMPTY = Object.freeze([]);

// Process-wide singleton the SPA and every plugin share.
export const slotRegistry = createSlotRegistry();

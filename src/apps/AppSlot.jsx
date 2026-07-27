// AppSlot — renders every contribution registered into a named slot, each
// wrapped in its own ErrorBoundary (ADR Decision 3b). Subscribes to the slot
// registry via useSyncExternalStore so hot mount/unmount re-renders live.
//
// A contribution's `render(props)` returns a React node (component mode). Used
// for core slots (toolbar, nav, home widgets) and app-declared slots alike.
import { useSyncExternalStore, useCallback } from 'react';

import { slotRegistry as defaultRegistry } from './slotRegistry';
import AppErrorBoundary from './ErrorBoundary';

export default function AppSlot({ slot, props, registry = defaultRegistry, fallback = null, onError }) {
  const subscribe = useCallback((l) => registry.subscribe(l), [registry]);
  const getSnapshot = useCallback(() => registry.getSlot(slot), [registry, slot]);
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (!entries.length) return fallback;

  return (
    <>
      {entries.map((entry) => (
        <AppErrorBoundary
          key={entry.id}
          label={entry.appId}
          onError={(err, info) => onError?.(entry.appId, err, info)}
        >
          <SlotItem entry={entry} props={props} />
        </AppErrorBoundary>
      ))}
    </>
  );
}

// Isolated so a render() throw is caught by the boundary above (a bare call in
// the map would throw during AppSlot's own render, escaping the boundary).
function SlotItem({ entry, props }) {
  return entry.render(props || {});
}

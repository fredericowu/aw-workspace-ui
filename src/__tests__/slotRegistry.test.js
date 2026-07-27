import { describe, it, expect, vi } from 'vitest';
import { createSlotRegistry, windowBodySlot } from '../apps/slotRegistry';

describe('slotRegistry', () => {
  it('mounts, orders, and returns a stable snapshot until mutated', () => {
    const r = createSlotRegistry();
    const rA = () => 'A';
    const rB = () => 'B';
    r.mount('core.toolbar', { id: 'b', appId: 'x', render: rB, order: 20 });
    r.mount('core.toolbar', { id: 'a', appId: 'x', render: rA, order: 10 });

    const snap1 = r.getSlot('core.toolbar');
    expect(snap1.map((e) => e.id)).toEqual(['a', 'b']); // sorted by order
    // stable reference between reads (required for useSyncExternalStore)
    expect(r.getSlot('core.toolbar')).toBe(snap1);
  });

  it('unmount by id and by app empties the slot and notifies subscribers', () => {
    const r = createSlotRegistry();
    const listener = vi.fn();
    r.subscribe(listener);
    const off = r.mount('core.nav', { id: 'n1', appId: 'notes', render: () => null });
    r.mount('core.nav', { id: 'n2', appId: 'git', render: () => null });
    expect(r.size()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);

    off(); // unmount single contribution
    expect(r.size()).toBe(1);

    r.unmountApp('git'); // wholesale app dispose
    expect(r.size()).toBe(0);
    expect(r.getSlot('core.nav')).toEqual([]);
  });

  it('windowBodySlot namespaces per window id', () => {
    expect(windowBodySlot('notes.main')).toBe('core.window.body:notes.main');
  });

  it('unsubscribe stops notifications', () => {
    const r = createSlotRegistry();
    const listener = vi.fn();
    const unsub = r.subscribe(listener);
    unsub();
    r.mount('core.toolbar', { id: 'a', appId: 'x', render: () => null });
    expect(listener).not.toHaveBeenCalled();
  });
});

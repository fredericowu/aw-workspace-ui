import { describe, it, expect, vi } from 'vitest';
import { createSlotRegistry, windowBodySlot, windowTitlebarSlot } from '../apps/slotRegistry';

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

  it('batch() emits once and never exposes the intermediate state', () => {
    const r = createSlotRegistry();
    r.mount('core.nav', { id: 'old', appId: 'x', render: () => null });
    const seen = [];
    r.subscribe(() => seen.push(r.getSlot('core.nav').map((e) => e.id)));

    // The contributions-refresh shape: drop the old generation, mount the new.
    r.batch(() => {
      r.unmountApp('x');
      r.mount('core.nav', { id: 'new', appId: 'x', render: () => null });
    });

    expect(seen).toEqual([['new']]); // one notification, never an empty slot
  });

  it('batch() reads inside the batch see the new state (cache is not stale)', () => {
    const r = createSlotRegistry();
    r.batch(() => {
      r.mount('core.nav', { id: 'a', appId: 'x', render: () => null });
      expect(r.getSlot('core.nav')).toHaveLength(1);
    });
    expect(r.getSlot('core.nav')).toHaveLength(1);
  });

  it('batch() still flushes when the body throws', () => {
    const r = createSlotRegistry();
    const listener = vi.fn();
    r.subscribe(listener);
    expect(() => r.batch(() => {
      r.mount('core.nav', { id: 'a', appId: 'x', render: () => null });
      throw new Error('boom');
    })).toThrow('boom');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('nested batches collapse into the outermost', () => {
    const r = createSlotRegistry();
    const listener = vi.fn();
    r.subscribe(listener);
    r.batch(() => {
      r.mount('core.nav', { id: 'a', appId: 'x', render: () => null });
      r.batch(() => r.mount('core.nav', { id: 'b', appId: 'y', render: () => null }));
      expect(listener).not.toHaveBeenCalled();
    });
    expect(listener).toHaveBeenCalledTimes(1);
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

describe('windowTitlebarSlot', () => {
  it('namespaces a window title-bar slot the same way the body slot is', () => {
    expect(windowTitlebarSlot('notes.main')).toBe('core.window.titlebar:notes.main');
  });

  it('is a different slot from the body, so actions never render in the body', () => {
    expect(windowTitlebarSlot('notes.main')).not.toBe(windowBodySlot('notes.main'));
  });
});

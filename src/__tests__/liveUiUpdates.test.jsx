// Live UI updates phase 1 (card 4205bf3b): server push + catch-up turn into
// the existing `aw-apps-changed` event, and an install while the UI is open
// makes the shell-owned nav item appear with no reload.
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  socket: { onFrame: null, onStatus: null, release: vi.fn() },
}));

vi.mock('../auth', async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch: h.apiFetch,
  wsUrl: (p) => `ws://test${p}`,
}));
vi.mock('../hooks/useSharedSocket', () => ({
  createSharedSocket: (opts) => {
    h.socket.onFrame = opts.onFrame;
    h.socket.onStatus = opts.onStatus;
    return { retain: () => h.socket.release };
  },
}));

import { startLiveUiUpdates } from '../apps/liveUiUpdates';
import { setAppliedRevision, getAppliedRevision } from '../apps/contributionsRevision';
import { fetchContributions } from '../apps/appsApi';
import { usePluginContributions } from '../apps/usePluginContributions';
import AppSlot from '../apps/AppSlot';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const notModified = () => ({ ok: true, status: 304, json: async () => ({}) });

let changed;
const onChanged = () => { changed += 1; };

beforeEach(() => {
  vi.useFakeTimers();
  changed = 0;
  h.apiFetch.mockReset();
  h.socket.release.mockReset();
  setAppliedRevision(null);
  window.addEventListener('aw-apps-changed', onChanged);
});
afterEach(() => {
  window.removeEventListener('aw-apps-changed', onChanged);
  vi.useRealTimers();
});

// Stand-in for the shell's own refetch: applies the revision the event names.
const applyOnChange = (e) => { setAppliedRevision(e.detail.revision); };
const withShellApplying = () => {
  window.addEventListener('aw-apps-changed', applyOnChange);
  return () => window.removeEventListener('aw-apps-changed', applyOnChange);
};

const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('liveUiUpdates', () => {
  it('a ui_changed frame dispatches aw-apps-changed once the server is at the announced revision', async () => {
    setAppliedRevision('old');
    h.apiFetch.mockResolvedValue(notModified());
    const stop = startLiveUiUpdates();
    h.socket.onFrame({ type: 'ui_changed', version: 1, revision: 'new' });
    await tick(0);
    expect(h.apiFetch).toHaveBeenCalledWith('/api/apps/-/contributions',
      { headers: { 'If-None-Match': '"new"' } });
    expect(changed).toBe(1);
    stop();
  });

  it('ignores a frame whose revision is already applied, and other frame types', async () => {
    setAppliedRevision('same');
    const stop = startLiveUiUpdates();
    h.socket.onFrame({ type: 'ui_changed', revision: 'same' });
    h.socket.onFrame({ type: 'ninja_notification' });
    await tick(0);
    expect(h.apiFetch).not.toHaveBeenCalled();
    expect(changed).toBe(0);
    stop();
  });

  it('retries until the answering worker reaches the announced revision', async () => {
    setAppliedRevision('old');
    h.apiFetch
      .mockResolvedValueOnce(ok({ revision: 'old' }))   // lagging worker
      .mockResolvedValueOnce(ok({ revision: 'old' }))   // still lagging
      .mockResolvedValue(notModified());                // converged
    const stop = startLiveUiUpdates();
    h.socket.onFrame({ type: 'ui_changed', revision: 'new' });
    await tick(0);
    expect(changed).toBe(0);            // stale worker: must NOT claim a change
    await tick(600);
    expect(changed).toBe(0);
    await tick(1100);
    expect(changed).toBe(1);            // converged worker
    expect(h.apiFetch).toHaveBeenCalledTimes(3);
    stop();
  });

  it('keeps nudging until the shell actually applied the announced revision', async () => {
    setAppliedRevision('old');
    h.apiFetch.mockResolvedValue(notModified());
    const stop = startLiveUiUpdates();
    h.socket.onFrame({ type: 'ui_changed', revision: 'new' });
    await tick(0);
    expect(changed).toBe(1);
    await tick(600);                    // refetch had hit a stale worker: still old
    expect(changed).toBe(2);
    setAppliedRevision('new');          // the shell's own fetch caught up
    await tick(5000);
    expect(changed).toBe(2);
    stop();
  });

  it('the connect frame before the first fetch is covered by that fetch', async () => {
    const stop = startLiveUiUpdates();
    h.socket.onFrame({ type: 'ui_changed', revision: 'r', initial: true });
    await tick(0);
    expect(h.apiFetch).not.toHaveBeenCalled();
    // ...but a connect frame that disagrees with what was applied catches up
    setAppliedRevision('old');
    h.apiFetch.mockResolvedValue(notModified());
    h.socket.onFrame({ type: 'ui_changed', revision: 'r', initial: true });
    await tick(0);
    expect(changed).toBe(1);
    stop();
  });

  it('socket reconnect does a conditional check: 304 is silent, a changed payload dispatches', async () => {
    setAppliedRevision('r1');
    const stop = startLiveUiUpdates();
    h.apiFetch.mockResolvedValueOnce(notModified());
    h.socket.onStatus({ state: 'open' });
    await tick(0);
    expect(h.apiFetch).toHaveBeenCalledWith('/api/apps/-/contributions',
      { headers: { 'If-None-Match': '"r1"' } });
    expect(changed).toBe(0);
    const unapply = withShellApplying();
    h.apiFetch.mockResolvedValueOnce(ok({ revision: 'r2' }))
      .mockResolvedValue(notModified());   // convergence probe: worker is at r2
    h.socket.onStatus({ state: 'open' });
    await tick(0);
    expect(changed).toBe(1);
    unapply();
    stop();
  });

  it('online, becoming visible, and the 5 minute poll each run the conditional check', async () => {
    setAppliedRevision('r1');
    h.apiFetch.mockResolvedValue(ok({ revision: 'r2' }));
    const stop = startLiveUiUpdates();
    // Each check sees a change; the shell applies it, then the next one is a
    // fresh change (r3, r4) so every trigger is individually observable.
    let n = 2;
    const bump = () => { n += 1; h.apiFetch.mockResolvedValue(ok({ revision: `r${n}` })); };
    const unapply = withShellApplying();
    window.addEventListener('aw-apps-changed', bump);

    window.dispatchEvent(new Event('online'));
    await tick(0);
    expect(changed).toBe(1);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(0);
    expect(changed).toBe(1);            // hidden: nothing
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(0);
    expect(changed).toBe(2);

    await tick(5 * 60 * 1000);
    expect(changed).toBe(3);
    window.removeEventListener('aw-apps-changed', bump);
    unapply();
    stop();
  });

  it('the event carries the revision it converged on, for per-worker listeners', async () => {
    setAppliedRevision('old');
    h.apiFetch.mockResolvedValue(notModified());
    let detail;
    const cap = (e) => { detail = e.detail; };
    window.addEventListener('aw-apps-changed', cap);
    const stop = startLiveUiUpdates();
    h.socket.onFrame({ type: 'ui_changed', revision: 'new' });
    await tick(0);
    window.removeEventListener('aw-apps-changed', cap);
    expect(detail).toEqual({ revision: 'new' });
    stop();
  });

  it('tab wake keeps converging when the shell refetch lands on a lagging worker', async () => {
    // Multi-worker core mid-convergence: the wake probe sees B, the shell's own
    // refetch (listener) is answered by a worker still at A, the next is at B.
    setAppliedRevision('A');
    const workers = ['B', 'A', 'B', 'B', 'B'];
    h.apiFetch.mockImplementation(async (_p, opts = {}) => {
      const rev = workers.shift() ?? 'B';
      const inm = opts.headers?.['If-None-Match'];
      return inm === `"${rev}"` ? notModified() : ok({ revision: rev });
    });
    const shellRefetch = async () => {
      const r = await h.apiFetch('/api/apps/-/contributions');
      setAppliedRevision((await r.json()).revision);
    };
    window.addEventListener('aw-apps-changed', shellRefetch);
    const stop = startLiveUiUpdates();
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(5000);
    expect(getAppliedRevision()).toBe('B');
    window.removeEventListener('aw-apps-changed', shellRefetch);
    stop();
  });

  it('a delayed wake probe does not cancel convergence to a newer announced frame', async () => {
    // Wake probe is pending, frame C arrives, the first convergence probe hits
    // a lagging worker (A), then the wake probe resolves as stale B. The C
    // loop must keep running and apply C.
    setAppliedRevision('A');
    let n = 0;
    let resolveWake;
    h.apiFetch.mockImplementation((_p, opts = {}) => {
      n += 1;
      if (n === 1) return new Promise((res) => { resolveWake = res; });
      const rev = n === 2 ? 'A' : 'C';
      return Promise.resolve(opts.headers?.['If-None-Match'] === `"${rev}"` ? notModified() : ok({ revision: rev }));
    });
    const unshell = withShellApplying();
    const stop = startLiveUiUpdates();
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(0);
    h.socket.onFrame({ type: 'ui_changed', revision: 'C' });
    await tick(0);
    resolveWake(ok({ revision: 'B' }));
    await tick(5000);
    expect(getAppliedRevision()).toBe('C');
    unshell();
    stop();
  });

  it('a wake signal during a loop that later exhausts is replayed, not lost', async () => {
    setAppliedRevision('A');
    let current = 'A';
    h.apiFetch.mockImplementation(async (_p, opts = {}) => {
      const fresh = opts.headers?.['If-None-Match'] === `"${current}"`;
      return fresh ? notModified() : ok({ revision: current });
    });
    const unshell = withShellApplying();
    const stop = startLiveUiUpdates();
    h.socket.onFrame({ type: 'ui_changed', revision: 'B' });   // B never becomes current
    await tick(0);
    current = 'C';
    window.dispatchEvent(new Event('online'));                 // arrives mid-loop
    await tick(60_000);                                        // loop exhausts its attempts
    expect(getAppliedRevision()).toBe('C');
    unshell();
    stop();
  });

  it('a wake signal during a loop that converged is not replayed onto a lagging worker', async () => {
    setAppliedRevision('A');
    let served = 'B';
    h.apiFetch.mockImplementation(async (_p, opts = {}) => {
      const fresh = opts.headers?.['If-None-Match'] === `"${served}"`;
      return fresh ? notModified() : ok({ revision: served });
    });
    const unshell = withShellApplying();
    const applied = [];
    const rec = () => applied.push(getAppliedRevision());
    window.addEventListener('aw-apps-changed', rec);
    const stop = startLiveUiUpdates();
    h.socket.onFrame({ type: 'ui_changed', revision: 'B' });
    window.dispatchEvent(new Event('online'));                 // arrives mid-loop
    served = 'A';                                              // next probe lands on a lagging worker
    await tick(60_000);
    window.removeEventListener('aw-apps-changed', rec);
    expect(getAppliedRevision()).toBe('B');
    unshell();
    stop();
  });

  it('a backend that sends no revision is not treated as a change on every poll', async () => {
    setAppliedRevision('r1');
    h.apiFetch.mockResolvedValue(ok({ windows: [] }));   // older core: 200, no revision
    const stop = startLiveUiUpdates();
    window.dispatchEvent(new Event('online'));
    await tick(5 * 60 * 1000);
    expect(changed).toBe(0);
    stop();
  });

  it('a probe that resolves after stop() or supersession is discarded', async () => {
    setAppliedRevision('r1');
    let release;
    h.apiFetch.mockImplementation(() => new Promise((res) => { release = () => res(ok({ revision: 'r2' })); }));
    const stop = startLiveUiUpdates();
    window.dispatchEvent(new Event('online'));
    await tick(0);
    stop();
    release();
    await tick(0);
    expect(changed).toBe(0);
  });

  it('a convergence probe superseded by a newer announcement is discarded', async () => {
    setAppliedRevision('r1');
    const pending = [];
    h.apiFetch.mockImplementation(() => new Promise((res) => pending.push(res)));
    const details = [];
    const cap = (e) => details.push(e.detail.revision);
    window.addEventListener('aw-apps-changed', cap);
    const stop = startLiveUiUpdates();
    h.socket.onFrame({ type: 'ui_changed', revision: 'r2' });
    await tick(0);
    h.socket.onFrame({ type: 'ui_changed', revision: 'r3' });
    await tick(0);
    pending[0](notModified());          // the r2 probe resolves late
    await tick(0);
    expect(details).toEqual([]);        // r2 is stale: no event for it
    pending[1](notModified());
    await tick(0);
    window.removeEventListener('aw-apps-changed', cap);
    expect(details).toEqual(['r3']);
    stop();
  });

  it('an independent fetchContributions() (settings panel, mobile) does NOT mark the shell as applied', async () => {
    setAppliedRevision('r1');
    h.apiFetch.mockResolvedValueOnce(ok({ revision: 'r2', nav: [] }));
    await fetchContributions();
    expect(getAppliedRevision()).toBe('r1');
    h.apiFetch.mockResolvedValue(notModified());
    const stop = startLiveUiUpdates();
    h.socket.onFrame({ type: 'ui_changed', revision: 'r2' });
    await tick(0);
    expect(changed).toBe(1);          // still pushed to the shell
    stop();
  });

  it('stop() releases the socket and silences every trigger', async () => {
    setAppliedRevision('r1');
    h.apiFetch.mockResolvedValue(ok({ revision: 'r2' }));
    const stop = startLiveUiUpdates();
    stop();
    expect(h.socket.release).toHaveBeenCalled();
    window.dispatchEvent(new Event('online'));
    await tick(10 * 60 * 1000);
    expect(changed).toBe(0);
  });
});

// Real hook + real wireContributions + real slot registry; only the network
// edge is faked. This is the "install while the UI is open" scenario.
describe('install while the UI is open (no reload)', () => {
  it('a new app\'s nav item appears in the shell nav after a ui_changed frame', async () => {
    delete window.__AW_PLUGIN_HOST__;
    const server = { revision: 'r1', nav: [] };
    h.apiFetch.mockImplementation(async (url, opts = {}) => {
      const inm = opts.headers?.['If-None-Match'];
      if (inm === `"${server.revision}"`) return notModified();
      return ok({ windows: [], frontend: [], settings: [], event_hooks: [],
                  nav: server.nav, revision: server.revision });
    });

    function Shell() {
      usePluginContributions({});
      return <AppSlot slot="core.nav" />;
    }
    render(<Shell />);
    await tick(0);
    expect(screen.queryByRole('button', { name: 'Git' })).toBeNull();

    // someone installs "git" from the CLI / another device
    server.revision = 'r2';
    server.nav = [{ app: 'git', id: 'git.nav', label: 'Git', opens: 'git.main' }];
    await act(async () => {
      h.socket.onFrame({ type: 'ui_changed', version: 1, revision: 'r2' });
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screen.getByRole('button', { name: 'Git' })).toBeInTheDocument();

    expect(getAppliedRevision()).toBe('r2');
    // The shell recorded the revision it applied, so the convergence loop
    // stops instead of probing forever.
    const calls = h.apiFetch.mock.calls.length;
    await tick(20000);
    expect(h.apiFetch.mock.calls.length).toBe(calls);
  });
});

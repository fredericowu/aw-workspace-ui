// Live UI updates, phase 1 (card 4205bf3b): tell the shell the installed-app
// set changed WITHOUT a page reload.
//
// Core announces a content-hash `revision` of GET /api/apps/-/contributions
// (as the ETag, in the payload, and in `ui_changed` frames on
// /ws/notifications, including the connect frame). This module turns every
// "maybe it moved" signal into the DOM event the plugin runtime already
// listens for (`aw-apps-changed`, see usePluginContributions.js), so nothing
// downstream changes:
//
//   * a `ui_changed` frame            -> converge on the announced revision
//   * socket (re)connect              -> conditional check (If-None-Match)
//   * window `online`, tab visible    -> conditional check
//   * 5 minute poll                   -> conditional check (backstop)
//
// Workers: core runs several workers and each serves its OWN loaded set, so a
// refetch right after an announcement can land on a worker that has not
// converged yet and return the OLD payload. `converge()` therefore probes with
// If-None-Match: "<announced>" (304 = the worker answering is at that
// revision) and retries with backoff until it is, then dispatches the event;
// it keeps going until the shell's own refetch has actually applied it.
import { apiFetch, wsUrl } from '../auth';
import { createSharedSocket } from '../hooks/useSharedSocket';
import { getAppliedRevision } from './contributionsRevision';

const URL_PATH = '/api/apps/-/contributions';
export const POLL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => Math.min(8000, 500 * 2 ** attempt);

// `revision` (when known) rides along as event detail so listeners that read a
// DIFFERENT per-worker endpoint (the Apps launcher's GET /api/apps) can wait
// for a response at that same revision instead of settling on a lagging one.
function notifyChanged(revision) {
  window.dispatchEvent(new CustomEvent('aw-apps-changed', { detail: { revision: revision ?? null } }));
}

// One conditional GET. Resolves { notModified, revision }. Never records the
// revision: only the shell's own (applied) fetch does, so a probe that saw a
// change but whose follow-up refetch hit a lagging worker is retried instead
// of being mistaken for applied.
async function probe(etagRevision) {
  const res = await apiFetch(URL_PATH, {
    headers: etagRevision ? { 'If-None-Match': `"${etagRevision}"` } : {},
  });
  if (res.status === 304) return { notModified: true, revision: etagRevision };
  if (!res.ok) throw new Error(`contributions probe ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return { notModified: false, revision: body?.revision ?? null };
}

export function startLiveUiUpdates({ pollMs = POLL_MS } = {}) {
  let stopped = false;
  let generation = 0;

  // Drive the shell to `announced`. A newer announcement supersedes an older
  // loop (generation check) so a burst of installs costs one loop.
  async function converge(announced) {
    const mine = ++generation;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (stopped || mine !== generation) return;
      if (getAppliedRevision() === announced) return;
      try {
        const r = await probe(announced);
        if (stopped || mine !== generation) return;
        if (r.notModified || r.revision === announced) notifyChanged(announced);
      } catch { /* transient: retry */ }
      await sleep(backoff(attempt));
    }
  }

  // Conditional "has anything moved since what I applied?" check.
  async function checkNow() {
    if (stopped) return;
    const applied = getAppliedRevision();
    const startedAt = generation;
    try {
      const r = await probe(applied);
      // A newer announcement (socket frame) started a convergence while this
      // probe was in flight: it targets a newer revision, so do not supersede
      // it with this older answer.
      if (stopped || startedAt !== generation) return;
      // A backend that sends no revision (older core) can't be diffed: stay
      // quiet instead of treating every 200 as a change.
      // Converge (not a single dispatch): the shell's own refetch may land on
      // a worker still at the old revision, so keep driving until applied.
      if (!r.notModified && typeof r.revision === 'string' && r.revision !== applied) converge(r.revision);
    } catch { /* offline etc.: the next trigger retries */ }
  }

  const onFrame = (frame) => {
    if (frame?.type !== 'ui_changed') return;
    const rev = frame.revision;
    if (!rev) { checkNow(); return; }
    const applied = getAppliedRevision();
    // Connect frame before the first fetch landed: that fetch covers it.
    if (frame.initial && applied == null) return;
    if (rev === applied) return;
    converge(rev);
  };

  const socket = createSharedSocket({
    url: () => wsUrl('/ws/notifications'),
    onFrame,
    onStatus: ({ state }) => { if (state === 'open') checkNow(); },
  });
  const release = socket.retain();

  const onOnline = () => checkNow();
  const onVisible = () => { if (document.visibilityState === 'visible') checkNow(); };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(checkNow, pollMs);

  return () => {
    stopped = true;
    generation += 1;
    clearInterval(timer);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    try { release(); } catch { /* closing anyway */ }
  };
}

// Boot-reconcile status ("Setting up apps n/m"), card 4245bf3b.
//
// Core publishes the boot pass's progress as GET /api/apps/-/boot-status
// (read from a shared file, so any worker answers) and as `boot_progress`
// frames on /ws/notifications (only the boot leader's worker emits them).
// So: fetch once, open the socket only after that fetch was authorised, apply
// frames as they arrive, and poll while a pass is running so a socket on a
// different worker still sees the counts move. Nothing here blocks the shell.
import { apiFetch, wsUrl } from '../auth';
import { createSharedSocket } from '../hooks/useSharedSocket';

const URL_PATH = '/api/apps/-/boot-status';
export const POLL_MS = 3000;

export function startBootStatus(onChange, { pollMs = POLL_MS } = {}) {
  let stopped = false;
  let release = null;
  let timer = null;
  let last = null;

  const apply = (s) => {
    if (stopped || !s || typeof s.phase !== 'string') return;
    last = s;
    onChange(s);
    schedule();
  };

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!stopped && last?.phase === 'reconciling') timer = setTimeout(fetchNow, pollMs);
  }

  async function fetchNow() {
    try {
      const res = await apiFetch(URL_PATH);
      if (!res.ok) return; // 401 pre-login, 404 older core: stay hidden
      apply(await res.json());
      if (!release && !stopped) {
        release = createSharedSocket({
          url: () => wsUrl('/ws/notifications'),
          onFrame: (f) => { if (f?.type === 'boot_progress') apply(f); },
        }).retain();
      }
    } catch { /* transient: the next trigger retries */ }
  }

  fetchNow();
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (release) { try { release(); } catch { /* closing anyway */ } }
  };
}

// Keep a shell-owned installed-apps list live. An install/uninstall/update
// elsewhere (CLI, agent, another tab) announces itself as `aw-apps-changed`
// (liveUiUpdates.js); re-run `refresh` (which must call listInstalledApps())
// until the answering worker's X-Apps-Revision matches the announced one —
// GET /api/apps is served by ONE worker, which can lag the revision that was
// announced. An older core sends no revision: accept the first answer.
// Returns the unsubscribe function.
import { getAppsListRevision } from './contributionsRevision';

export function watchAppsList(refresh) {
  let alive = true;
  const onChanged = async (e) => {
    const target = e?.detail?.revision ?? null;
    for (let attempt = 0; attempt < 6 && alive; attempt += 1) {
      await refresh();
      const got = getAppsListRevision();
      if (!target || !got || got === target) return;
      await new Promise((r) => setTimeout(r, Math.min(4000, 500 * 2 ** attempt)));
    }
  };
  window.addEventListener('aw-apps-changed', onChanged);
  return () => { alive = false; window.removeEventListener('aw-apps-changed', onChanged); };
}

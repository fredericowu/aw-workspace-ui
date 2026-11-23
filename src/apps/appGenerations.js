// App generations (live UI phase 2). A window opened from an app's contributions
// remembers that app's `rev` (core's per-app revision, `app_revs[slug]`) in its
// spec snapshot. When the app's rev later moves, the window is "stale": it keeps
// running the code it opened with until the user closes it (we never swap code
// under an open window) and shows an "Updated, reopen to apply" hint instead.
//
// Older cores send no `app_revs`; then nothing is ever stale, which is exactly
// the pre-phase-2 behaviour.

export function appRevOf(contributions, slug) {
  const rev = contributions?.app_revs?.[slug];
  return typeof rev === 'string' ? rev : undefined;
}

// A window spec is stale when it recorded a rev and the app's current rev is a
// different string. An app missing from `app_revs` (uninstalled) is NOT stale
// here: that is the tombstone case, a separate slice.
export function isStaleWindowSpec(spec, contributions) {
  if (!spec || typeof spec.rev !== 'string' || !spec.app) return false;
  const current = appRevOf(contributions, spec.app);
  return current !== undefined && current !== spec.rev;
}

export function staleAppWindowKeys(appWindowSpecs, contributions) {
  const out = new Set();
  for (const [key, spec] of Object.entries(appWindowSpecs || {})) {
    if (isStaleWindowSpec(spec, contributions)) out.add(key);
  }
  return out;
}

// Slugs whose component code must NOT be swapped on the next wiring because a
// window still runs the old generation.
export function retainedAppSlugs(appWindowSpecs, contributions) {
  const out = new Set();
  for (const spec of Object.values(appWindowSpecs || {})) {
    if (isStaleWindowSpec(spec, contributions)) out.add(spec.app);
  }
  return out;
}

// What an "open this window" request does to the spec map. A window already
// open on an older generation of its app keeps that snapshot (the new code only
// arrives on a fresh open, after close); anything else takes the new snapshot.
export function specForOpen(prevSpec, nextSpec) {
  if (prevSpec && typeof prevSpec.rev === 'string' && prevSpec.rev !== nextSpec.rev) return prevSpec;
  return nextSpec;
}

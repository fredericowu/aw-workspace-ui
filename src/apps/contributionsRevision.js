// The contributions revision this shell last APPLIED (set by
// usePluginContributions after it wired a fetched payload; NOT by arbitrary
// fetchContributions() callers such as the settings panel). Kept in its own
// tiny module so the writer and liveUiUpdates.js (reader) don't import each
// other.
let applied = null;
let listRevision = null;

export function setAppliedRevision(rev) { applied = rev; }
export function getAppliedRevision() { return applied; }

// Revision header of the most recent GET /api/apps (installed list).
export function setAppsListRevision(rev) { listRevision = rev; }
export function getAppsListRevision() { return listRevision; }

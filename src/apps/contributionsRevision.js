// The contributions revision this shell last applied (response of the last
// GET /api/apps/-/contributions). Kept in its own tiny module so appsApi.js
// (writer) and liveUiUpdates.js (reader) don't import each other.
let applied = null;

export function setAppliedRevision(rev) { applied = rev; }
export function getAppliedRevision() { return applied; }

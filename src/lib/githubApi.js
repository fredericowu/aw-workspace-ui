/**
 * Where the GitHub PR dashboard lives.
 *
 * It was a monolith feature (`/api/github/*` + `/ws/github`, served by
 * agentic-workspace / aw-backend). aw-workspace's core has no GitHub surface
 * at all, so every one of those calls 404'd on the workspace host on each
 * dashboard load — see asArray.js for the crash guard that had to exist
 * because of it.
 *
 * The feature was ported into the app that already owns `gh` (installs it,
 * holds its token, logs it in): aw-app-git. App routes are mounted at
 * `/api/apps/<slug>`, hence the prefix here. Requires the `git` app installed
 * and signed in; without it these 404 exactly like before, which the callers
 * already tolerate (they keep their empty state).
 */
export const GITHUB_PRS_PATH = '/api/apps/git/github/prs';
export const GITHUB_REFRESH_PATH = '/api/apps/git/github/refresh';
/** WebSocket: cached payload on connect, then live `github_update` frames. */
export const GITHUB_STREAM_PATH = '/api/apps/git/github/stream';

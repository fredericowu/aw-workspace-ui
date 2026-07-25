// Thin fetch wrapper for the aw-backend API.
//
// Backend target: aw-backend (`repos/aw-backend`, public at
// api.aw.tekflox.com) — NOT the legacy awserv at aw.tekflox.com:9123.
//
// Requests go through a RELATIVE path (`/api/...`), not an absolute
// `https://api.aw.tekflox.com/...` URL. Two different same-origin proxies
// make that resolve to aw-backend without the browser ever making a
// cross-origin request:
//   - dev: Vite's `server.proxy` (vite.config.js) forwards /api and /ws to
//     api.aw.tekflox.com server-to-server.
//   - prod (once wired): the Caddy vhost serving this app's static build
//     needs the same /api reverse-proxy — not yet done, see the Caddy
//     template work.
// Going relative on purpose: aw-backend's CORS allowlist
// (`_cors_allowed_origins()`) is deliberately short (aw.tekflox.com,
// next.aw.tekflox.com, the ux-proto wildcard) — adding every dev/preview
// origin this frontend might run on would turn that into an unbounded
// list. Same-origin sidesteps CORS entirely instead.
//
// `credentials: 'include'` is required on every call — auth is a same-site
// cookie, not a bearer token, matching the credentialed-CORS contract.
//
// NOTE: nothing here assumes any specific endpoint (e.g. /api/settings/aw,
// /api/components, /api/windows/registry — all used by the ux-proto
// prototype against the legacy backend) already exists on aw-backend.
// Callers should treat 404s as "not ported yet" rather than a bug in this
// client.

export const API_BASE_URL = "";

export class ApiError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
  }
}

/**
 * fetchJson(path, options) -> parsed JSON body.
 * `path` is joined onto API_BASE_URL (pass an absolute URL to override).
 * Always sends `credentials: 'include'` for the credentialed-CORS session
 * cookie; callers can still override any other fetch option.
 */
export async function fetchJson(path, options = {}) {
  const url = /^https?:\/\//.test(path) ? path : `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    throw new ApiError(`${options.method || "GET"} ${url} -> ${res.status}`, { status: res.status, url });
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

export function apiGet(path, options) {
  return fetchJson(path, { ...options, method: "GET" });
}

export function apiPost(path, body, options) {
  return fetchJson(path, {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    body: JSON.stringify(body),
  });
}

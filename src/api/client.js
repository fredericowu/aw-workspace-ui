// Thin fetch wrapper for the aw-backend API.
//
// Backend target: https://api.aw.tekflox.com — the new `repos/aw-backend`
// (already confirmed live), NOT the legacy awserv at aw.tekflox.com:9123
// and NOT repos/aw-backend on :9025 directly (that's local/replica-only).
// aw-backend ships the same credentialed-CORS + WS-Origin-check setup the
// legacy awserv has for this frontend's origin (see repos/aw-backend and
// the legacy src/api/app.py, commit 4248185, for the pattern this mirrors).
//
// `credentials: 'include'` is required on every call — auth is a same-site
// cookie, not a bearer token, matching the credentialed-CORS contract.
//
// NOTE: this is plumbing only. Nothing here assumes any specific endpoint
// (e.g. /api/settings/aw, /api/components, /api/windows/registry — all used
// by the ux-proto prototype against the legacy backend) already exists on
// the fresh aw-backend instance. Callers should treat 404s as "not ported
// yet" rather than a bug in this client.

export const API_BASE_URL = "https://api.aw.tekflox.com";

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

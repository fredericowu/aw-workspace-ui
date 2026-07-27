/**
 * Coerce a fetched value to an array.
 *
 * During the strangler migration to the BYOD aw-workspace, many endpoints
 * (/api/tasks, /api/github/prs, /api/vpn/status, …) are not yet migrated and
 * 404 on the workspace host. FastAPI's 404 body is an object
 * (`{ detail: "Not Found" }`), which is truthy — so the common
 * `(x || []).forEach(...)` guard does NOT protect against it and throws
 * `x.forEach is not a function`, blanking the React tree.
 *
 * `asArray` returns the value only when it is genuinely an array, otherwise
 * an empty array — so list consumers render their empty/"unavailable" state
 * instead of crashing.
 */
export function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Fetch a list endpoint and always resolve to an array.
 *
 * On any non-2xx response (e.g. a not-yet-migrated 404), a non-array body, a
 * `.json()` parse error, or a network failure, resolves to `[]`. When the
 * payload is an object wrapping the list under `key` (e.g. `{ repos: [...] }`),
 * pass `key` to pull it out.
 *
 * @param {(url: string, opts?: object) => Promise<Response>} fetcher apiFetch
 * @param {string} url
 * @param {string} [key] optional property holding the array in an object body
 * @returns {Promise<Array>}
 */
export async function fetchList(fetcher, url, key) {
  try {
    const res = await fetcher(url);
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    if (key) return asArray(data && data[key]);
    return asArray(data);
  } catch {
    return [];
  }
}

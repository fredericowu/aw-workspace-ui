/**
 * VPNs (Settings → General → VPNs) — a profile MANAGER, not a dialer.
 *
 * PLANE: every call here is a relative `/api/vpn/*` path through `apiFetch`.
 * That resolves against THIS WORKSPACE's own API (see `apiBase.js`'s
 * `apiUrl()` — a relative `/api/*` on a workspace SPA host is rewritten to
 * `api.<slug>.workspace.<apex>`, the BYOD workspace plane). That is
 * deliberate and the OPPOSITE of `networkingApi.js` in this same directory:
 * *this* feature's routes live on the workspace core (`aw-workspace`, this
 * repo's backend), never on the central `aw-backend` control plane — so
 * `centralApiUrl()` must never be used here. See
 * docs/architecture/vpn-profiles-in-general.md §2.1 for why the plane
 * differs from Networking's.
 *
 * Phase 1 stores and validates profiles; nothing dials. There is no
 * connect/disconnect/activate call in this file because no such route
 * exists yet — do not add UI that implies one does.
 */
import { apiFetch } from '../auth';

async function request(method, path, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await apiFetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A rejected profile (PostUp/PostDown/Table/FwMark/script-security) comes
    // back as a named error here — surface it verbatim, never a generic
    // "failed to save" (docs/architecture/vpn-profiles-in-general.md §2.4).
    throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export async function fetchConfigs() {
  const data = await request('GET', '/api/vpn/configs');
  return Array.isArray(data) ? data : (data.configs || []);
}

/** Metadata + a REDACTED body — never the private key. */
export async function fetchConfig(name) {
  return request('GET', `/api/vpn/configs/${encodeURIComponent(name)}`);
}

export async function saveConfig(name, { type, content }) {
  return request('PUT', `/api/vpn/configs/${encodeURIComponent(name)}`, { type, content });
}

export async function uploadConfig(file, { name, type } = {}) {
  const fd = new FormData();
  if (type) fd.append('type', type);
  if (name) fd.append('name', name);
  fd.append('file', file);
  const res = await apiFetch('/api/vpn/configs/upload', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || data?.error || `Upload failed (HTTP ${res.status})`);
  return data;
}

export async function deleteConfig(name) {
  return request('DELETE', `/api/vpn/configs/${encodeURIComponent(name)}`);
}

export async function fetchVpnStatus() {
  return request('GET', '/api/vpn/status');
}

/** Presence only — never returns the stored password. */
export async function fetchNordCredentials() {
  return request('GET', '/api/vpn/nord/credentials');
}

export async function saveNordCredentials({ username, password }) {
  return request('PUT', '/api/vpn/nord/credentials', { username, password });
}

export async function fetchNordCountries() {
  const data = await request('GET', '/api/vpn/nord/countries');
  return Array.isArray(data) ? data : (data.countries || []);
}

export async function fetchNordRecommendations(countryId) {
  const qs = countryId ? `?country_id=${encodeURIComponent(countryId)}` : '';
  const data = await request('GET', `/api/vpn/nord/recommendations${qs}`);
  return Array.isArray(data) ? data : (data.servers || []);
}

export async function importNordServer({ hostname, protocol }) {
  return request('POST', '/api/vpn/nord/import', { hostname, protocol });
}

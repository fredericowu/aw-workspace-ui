/**
 * VPNs (Settings → General → VPNs) — a profile manager AND the dialer
 * control: store/edit/delete profiles, plus connect/disconnect the tunnel
 * this workspace's own egress goes through.
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
 * connectVpn/disconnectVpn talk to a dialer built in a sibling task
 * (aw-remote-host's Go `vpn_external_up/down` behind this workspace's own
 * `/api/vpn/connect|disconnect`). Their outcome is one of three shapes that
 * must never collapse into a single generic "failed" toast — see
 * `VpnActionError` below:
 *
 *   - REFUSAL   `{refused: true, refusal: "<sentence>"}` — the host declined
 *     and changed NOTHING. The established pattern in this codebase (see
 *     `aw-remote-host/internal/ops/ops_vpn_bootstrap_test.go`) is that a
 *     refusal is a SUCCESSFUL response carrying its own sentence — render it
 *     verbatim, never paraphrase or generalize it.
 *   - FAILURE   a non-OK HTTP status — something was attempted and did not
 *     work.
 *   - TIMEOUT   the request never completed (network drop, or the server's
 *     own signal that the dial/confirm conversation didn't finish). This is
 *     NOT a verdict either way: the host arms a dead-man's switch that can
 *     revert an unconfirmed change on its own, so the honest UI message is
 *     "go look" — refresh status — never "connected" or "disconnected".
 *
 * GET /api/vpn/status's extended (post-phase-1) shape isn't pinned to one
 * exact field-naming convention here — it's built in that same sibling task.
 * `normalizeVpnStatus` reads it defensively, the same discipline
 * `NordSection` already applies to credential-presence responses, rather
 * than assume one exact key survives to production.
 */
import { apiFetch } from '../auth';

export class VpnActionError extends Error {
  constructor(message, { refused = false, refusal = null, timedOut = false, status } = {}) {
    super(message);
    this.name = 'VpnActionError';
    this.refused = refused;
    this.refusal = refusal;
    this.timedOut = timedOut;
    this.status = status;
  }
}

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

/**
 * Reads GET /api/vpn/status's extended shape defensively — see this file's
 * header for why. `raw` is kept so a caller that needs a field this doesn't
 * know about yet still has it.
 */
export function normalizeVpnStatus(data) {
  if (!data || typeof data !== 'object') return { connected: false, profile: null, raw: data ?? null };
  const connected = !!(data.connected ?? data.is_connected ?? data.up ?? data.state === 'connected');
  const profile = data.profile ?? data.active_profile ?? data.profile_name ?? data.name ?? null;
  return { connected, profile, raw: data };
}

async function vpnAction(path, body) {
  let res;
  try {
    res = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // The request never completed — a dropped connection, an aborted fetch.
    // We do not know whether the host went on to dial anyway. Never claim
    // a verdict here.
    throw new VpnActionError(
      e?.message || 'the connection to the workspace was lost before the request finished',
      { timedOut: true },
    );
  }
  const data = await res.json().catch(() => ({}));
  if (data?.refused) {
    throw new VpnActionError(data.refusal || 'refused', { refused: true, refusal: data.refusal });
  }
  if (res.status === 504 || data?.timeout === true || data?.timed_out === true || data?.status === 'timeout') {
    throw new VpnActionError(
      data?.detail ||
        'the request timed out — the host may still be applying or reverting this change, refresh status to see',
      { timedOut: true },
    );
  }
  if (!res.ok) {
    throw new VpnActionError(data?.detail || data?.error || `HTTP ${res.status}`, { status: res.status });
  }
  return data;
}

/** Connect is per-profile — one WireGuard/NordLynx (or, second-class, OpenVPN) profile at a time. */
export async function connectVpn(name) {
  return vpnAction('/api/vpn/connect', { name });
}

/** Disconnect is global — there is at most one active tunnel to tear down. */
export async function disconnectVpn() {
  return vpnAction('/api/vpn/disconnect', {});
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

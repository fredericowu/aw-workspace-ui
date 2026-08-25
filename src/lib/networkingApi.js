/**
 * Settings → Networking: where the tenant's mesh data comes from.
 *
 * TWO sources, deliberately kept apart because only one of them exists today.
 *
 * 1. The host list — REAL, already answering.
 *    `aw-backend`'s `GET /api/workspaces/{slug}/remote-hosts`
 *    (repos/aw-backend/src/api/routes/host_link.py:813 →
 *    `list_account_remote_hosts`), the same route `aw-workspace-cli
 *    remote-hosts hosts` calls through the remote-host-cli app's client.py.
 *    `{slug}` only picks WHICH ACCOUNT to resolve — the response covers every
 *    workspace that account owns, so any slug the caller is a member of gives
 *    the same answer. The route takes a human `Identity` as well as a host
 *    token, so the browser's apex `aw_id_jwt` cookie is enough; no new
 *    endpoint was invented for this screen.
 *
 * 2. The tailscale/mesh state — REAL since 2026-08-25.
 *    `aw-backend`'s `GET /api/workspaces/{slug}/mesh-status`
 *    (repos/aw-backend/src/api/routes/host_link.py → `mesh_status`), which
 *    asks each CONNECTED host for its tailscale state over the live /link
 *    tunnel and returns it keyed by remote-host id. Same account scoping and
 *    same plane as the host list above — it delegates to the very same
 *    resolver — so the two are always about the same set of hosts.
 *
 * The split matters for honesty: a host whose row we have but whose agent has
 * told us nothing is UNKNOWN, not offline. Rendering an invented
 * "disconnected", or a plausible-looking 100.64.x.x, would be exactly the
 * silent-degradation failure this workspace keeps getting bitten by.
 */
import { apiFetch } from '../auth';
import { centralApiUrl } from '../apiBase';

/**
 * Path of the mesh-status endpoint. Account-scoped like the host list, so it
 * is built from a slug rather than being a constant.
 *
 * This was `null` until 2026-08-25 — deliberately, rather than a guessed path:
 * pointing it at a route nobody had written would have made every open of this
 * screen fire a 404 and turn "not built yet" into what looks like a broken
 * deployment.
 */
export const MESH_STATUS_PATH = (slug) => `/api/workspaces/${encodeURIComponent(slug)}/mesh-status`;

/** Human-readable why-there-is-no-data, shown verbatim in the UI. Kept for the
 *  case that still exists: the endpoint itself failing to answer. */
export const MESH_UNAVAILABLE_REASON =
  'The mesh-status endpoint did not answer, so nothing is known about any '
  + "host's tailscale state. No agent data.";

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || body?.detail || `HTTP ${res.status}`);
  }
  return body;
}

/**
 * The workspace slug to address the host-list route with.
 *
 * `GET /api/identity/me` returns this identity's memberships; an `owner` one
 * is preferred because `list_account_remote_hosts` resolves the account from
 * the owner membership when the caller is a host token, and an owner is
 * guaranteed to pass its `is_member_of` check. Any membership works as a
 * fallback — the response is account-wide either way.
 *
 * This route lives on the CENTRAL aw-backend plane, not this workspace's own
 * BYOD API — `centralApiUrl` resolves the right origin on a workspace SPA
 * host (see apiBase.js) instead of letting it resolve same-origin, where it
 * 404s.
 */
export async function resolveAccountSlug() {
  const me = await apiFetch(centralApiUrl('/api/identity/me')).then(readJson);
  const memberships = Array.isArray(me?.memberships) ? me.memberships : [];
  const owner = memberships.find((m) => m.role === 'owner');
  const slug = (owner || memberships[0])?.workspace;
  if (!slug) throw new Error('this login owns no workspace');
  return slug;
}

/**
 * `{count, hosts:[{id, workspace_slug, hostname, os, arch, last_seen_at,
 * connected}]}` — every non-revoked link across the account, connected or not.
 *
 * Note for callers: the same `hostname` legitimately appears more than once
 * with different ids. A re-link leaves the previous row behind (the Surface
 * has four), and one machine can carry both a Windows and a WSL2 link. Rows
 * are per LINK, never per machine — don't dedupe them away.
 *
 * Also a CENTRAL aw-backend route (see resolveAccountSlug above) — same
 * `centralApiUrl` treatment applies.
 */
export async function fetchRemoteHosts(slug) {
  const s = slug || (await resolveAccountSlug());
  const data = await apiFetch(centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts`)).then(readJson);
  return Array.isArray(data?.hosts) ? data.hosts : [];
}

/**
 * Mesh state, keyed by remote-host id.
 *
 * ALWAYS resolves, never rejects — and that is load-bearing, not politeness.
 * NetworkingTab fetches this in a `Promise.all` with the host list, so a
 * throw here would blank the host list too and report a mesh problem as
 * "could not list the hosts". A failed request is data about the mesh, not
 * about the hosts:
 *
 *   { available: false, reason }                  ← the endpoint did not answer
 *   { available: true, controlPlaneUrl, nodes }   ← real data
 *
 * `nodes[hostId]` carries `{ reported, reason, up, meshIp, nodeName,
 * path: 'direct'|'relay', via, exitNode }`. `via` is the relay actually in the
 * path (e.g. `DERP(mad)`), which is what makes "works, but through Madrid"
 * visible at all.
 *
 * `reported: false` is the honest-unknown, and every field but `reason` is
 * then absent: a host that is offline, timed out, or runs an agent too old for
 * the verb told us NOTHING, which is not the same as telling us it is down.
 * The backend refuses to guess its address and so does this — see
 * MeshState in NetworkingTab for how the two cases render apart.
 *
 * `controlPlaneUrl` is PER TENANT and only ever comes from here. It is never
 * hardcoded: today's `https://headscale.aw.tekflox.com` is one tenant's value,
 * not the product's.
 *
 * The snake_case→camelCase mapping is done here rather than by the API: the
 * backend speaks snake_case on every other route, and one endpoint bending to
 * this file's convention would be a worse trade than eight lines of mapping.
 */
export async function fetchMeshStatus(slug) {
  try {
    const s = slug || (await resolveAccountSlug());
    const data = await apiFetch(centralApiUrl(MESH_STATUS_PATH(s))).then(readJson);
    const nodes = {};
    for (const [hostId, node] of Object.entries(data?.nodes || {})) {
      nodes[hostId] = {
        reported: node?.reported !== false,
        reason: node?.reason || '',
        up: !!node?.up,
        meshIp: node?.mesh_ip || null,
        nodeName: node?.node_name || null,
        path: node?.path || null,
        via: node?.via || null,
        exitNode: node?.exit_node || null,
      };
    }
    return {
      available: true,
      controlPlaneUrl: data?.control_plane_url || null,
      nodes,
    };
  } catch (e) {
    return { available: false, reason: `${MESH_UNAVAILABLE_REASON} (${e.message || e})` };
  }
}

/**
 * Can this host be bootstrapped into the mesh — and if not, WHY.
 *
 * Three states on purpose, and the middle one is the point. Full eligibility
 * is Linux + root + `/dev/net/tun` + a reachable endpoint, and of those only
 * the OS is in the host row; root and tun are things the agent has to report
 * and nothing reports them yet. So:
 *
 *   'no'      — provable right now from `os`. Written reason, always.
 *   'unknown' — passes the OS gate, the rest is genuinely not known here.
 *   'yes'     — reserved for when the agent actually says so. Never guessed.
 *
 * Claiming 'yes' off `os === 'linux'` alone would be inventing the two facts
 * that actually decide it. A greyed-out button with no sentence next to it
 * reads as a bug, which is why every 'no'/'unknown' carries `reason`.
 */
export function bootstrapEligibility(host) {
  const os = (host?.os || '').toLowerCase();

  if (os === 'darwin') {
    return {
      state: 'no',
      label: 'Not eligible',
      reason: 'macOS — automatic bootstrap is Linux-only. Here tailscaled needs a '
        + 'manual install (brew + install-system-daemon) and root, which this '
        + "host's agent does not have.",
    };
  }
  if (os && os !== 'linux') {
    return {
      state: 'no',
      label: 'Not eligible',
      reason: `Not Linux (${os}) — the bootstrap module only supports Linux.`,
    };
  }
  if (!os) {
    return {
      state: 'unknown',
      label: 'Eligibility unknown',
      reason: 'This host has not reported an operating system.',
    };
  }
  return {
    state: 'unknown',
    label: 'Eligibility unconfirmed',
    reason: 'Linux clears the first requirement, but root and /dev/net/tun are not '
      + 'reported by any API yet — no agent data.',
  };
}

/**
 * Install instructions per OS. macOS is a genuinely different path — the Linux
 * one-liner installer does not work there — so it is listed separately rather
 * than as a footnote.
 *
 * `controlPlane` is substituted in when known; when it isn't, the placeholder
 * stays visible so nobody copy-pastes another tenant's control plane.
 */
export const CONTROL_PLANE_PLACEHOLDER = '<tenant-control-plane>';

export function installInstructions(controlPlane) {
  const cp = controlPlane || CONTROL_PLANE_PLACEHOLDER;
  return [
    {
      id: 'linux',
      title: 'Linux / WSL2',
      commands: [
        'curl -fsSL https://tailscale.com/install.sh | sh',
        `sudo tailscale up --login-server=${cp} --authkey=<key> --hostname=<name>`,
      ],
    },
    {
      id: 'macos',
      title: 'macOS',
      note: 'A genuinely different path — the Linux installer script does NOT work here.',
      commands: [
        'brew install tailscale',
        'sudo tailscaled install-system-daemon',
        `sudo tailscale up --login-server=${cp} --authkey=<key> --hostname=<name>`,
      ],
    },
  ];
}

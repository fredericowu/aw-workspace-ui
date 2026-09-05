/**
 * Settings → Networking: host list and tailscale/mesh state, both from
 * `aw-backend` (`GET /api/workspaces/{slug}/remote-hosts` and
 * `GET /api/workspaces/{slug}/mesh-status`), account-scoped by `{slug}`.
 *
 * A host whose row we have but whose agent has told us nothing is UNKNOWN,
 * not offline. Rendering an invented "disconnected", or a plausible-looking
 * 100.64.x.x, would be exactly the silent-degradation failure this workspace
 * keeps getting bitten by.
 */
import { apiFetch } from '../auth';
import { centralApiUrl, workspaceSlug } from '../apiBase';

/** Path of the mesh-status endpoint. Account-scoped like the host list, so
 *  it is built from a slug rather than being a constant. */
export const MESH_STATUS_PATH = (slug) => `/api/workspaces/${encodeURIComponent(slug)}/mesh-status`;

/** Human-readable why-there-is-no-data, shown verbatim in the UI. Kept for the
 *  case that still exists: the endpoint itself failing to answer. */
export const MESH_UNAVAILABLE_REASON =
  'The mesh-status endpoint did not answer, so nothing is known about any '
  + "host's tailscale state. No agent data.";

/**
 * A host's display name — its per-link `friendly_name` when the owner has
 * set one, else the raw `hostname` its agent reported at hello, else
 * `fallback` (the link id, by default). `friendly_name` already comes back
 * on every row `fetchRemoteHosts` returns (aw-backend's
 * `list_account_remote_hosts`); this only fixes the PRIORITY callers read
 * it at, matching the order RemoteHostsTab already renames by — a Mac
 * dutifully renamed "aw-host" still showed its raw container id wherever a
 * call site skipped straight to `hostname || id`.
 *
 * Lives here rather than in NetworkingTab.jsx so `exitGateCandidates` below
 * — which builds labels the same host objects feed into, just for the
 * exit-gate picker instead of the host rows — can share the exact priority
 * instead of a second copy of it drifting.
 */
export function hostLabel(host, fallback = host?.id) {
  return host?.friendly_name || host?.hostname || fallback;
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || body?.detail || `HTTP ${res.status}`);
  }
  return body;
}

/**
 * The workspace slug to address the host-list route with, from this
 * identity's memberships (`GET /api/identity/me`) — an `owner` membership
 * preferred, any membership as fallback since the response is account-wide.
 *
 * `centralApiUrl` because this route lives on the CENTRAL aw-backend plane,
 * not this workspace's own BYOD API — resolving same-origin 404s on a
 * workspace SPA host.
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
 * The workspace this SCREEN is actually looking at — not "some workspace
 * this login owns", which is all `resolveAccountSlug()` above can answer.
 * On a `<slug>.workspace.<apex>` SPA host the URL itself names the
 * workspace; that is the one true source, read via `apiBase.js`'s
 * `workspaceSlug()` the same way the rest of this app already derives its
 * per-workspace URLs, and it is what every fetch this tab makes must be
 * scoped by (see `networking:public-ip-banner-wrong-workspace-and-per-host-ip`
 * — the top-of-screen Public IP banner used to default to the first
 * workspace this login happens to own, which silently measured a different
 * machine's egress than the one being viewed).
 *
 * Falls back to `resolveAccountSlug()` only where there is no URL to read
 * a slug from (dev, the single-tenant dashboard, previews) — there, "some
 * owned workspace" is the closest thing to an answer that exists.
 */
export async function currentWorkspaceSlug() {
  return workspaceSlug() || resolveAccountSlug();
}

/**
 * `{count, hosts:[{id, workspace_slug, hostname, friendly_name, os, arch,
 * last_seen_at, connected}]}` — every non-revoked link across the account,
 * connected or not.
 *
 * Rows are per LINK, never per machine — the same `hostname` legitimately
 * appears more than once with different ids (a re-link leaves the previous
 * row behind, and one machine can carry both a Windows and a WSL2 link), so
 * don't dedupe them away.
 *
 * `friendly_name` is a per-LINK rename set via `renameRemoteHost` below —
 * `null` until someone sets one. Any UI that names a host from this row must
 * prefer it over `hostname`, the same order `renameRemoteHost`'s own callers
 * already read it in — else a rename silently does nothing on that screen.
 */
export async function fetchRemoteHosts(slug) {
  const s = slug || (await resolveAccountSlug());
  const data = await apiFetch(centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts`)).then(readJson);
  return Array.isArray(data?.hosts) ? data.hosts : [];
}

/**
 * Mesh state, keyed by remote-host id. `nodes[hostId]` carries `{ reported,
 * reason, up, meshIp, nodeName, path: 'direct'|'relay', via, exitNode }`.
 *
 * ALWAYS resolves, never rejects — load-bearing, not politeness:
 * NetworkingTab fetches this in a `Promise.all` with the host list, so a
 * throw here would blank the host list too and blame the hosts for a mesh
 * outage.
 *
 *   { available: false, reason }                  ← the endpoint did not answer
 *   { available: true, controlPlaneUrl, nodes }   ← real data
 *
 * `reported: false` is the honest-unknown: a host that is offline, timed
 * out, or runs an agent too old for the verb told us NOTHING, which is not
 * the same as telling us it is down. See MeshState in NetworkingTab for how
 * the two cases render apart.
 */
/**
 * The host's own bootstrap-eligibility verdict, or `null` when its agent
 * sent none — a THIRD answer, not a falsy "no". `{canEnroll: false}` here
 * would report a refusal nobody ever made.
 */
function mapEligibility(raw) {
  if (!raw || typeof raw.can_enroll !== 'boolean') return null;
  return {
    canEnroll: raw.can_enroll,
    enrollRefusal: raw.enroll_refusal || '',
    canAdvertiseExit: !!raw.can_advertise_exit,
    exitRefusal: raw.exit_refusal || '',
    // A THIRD answer beside yes/no: this host may serve as a gate, but at a
    // cost worth showing before offering a plain button. Empty on agents
    // predating the field, which reads as "no warning" and is right — any
    // actual refusal still arrives in exitRefusal.
    exitWarning: raw.exit_warning || '',
    // The CLIENT-side verdict: can this host be pointed AT a gate — a
    // different question from canAdvertiseExit, and not implied by
    // canEnroll. `null` when the agent predates the field, kept distinct
    // from `false` for the same reason every other verdict here keeps it.
    canSelectExit: typeof raw.can_select_exit === 'boolean' ? raw.can_select_exit : null,
    selectExitRefusal: raw.select_exit_refusal || '',
    installer: raw.installer || null,
  };
}

/**
 * The non-mesh WireGuard tunnels a host terminates, as its own `wg show all
 * dump` reported them (`external_tunnels` on `vpn_status`, forwarded verbatim
 * by `mesh_status` — see external-vpns-in-networking.md §3.1/§3.2).
 *
 * THREE states, and the third is the whole reason this mapper exists rather
 * than a `|| []`:
 *
 *   null                        — nothing arrived. The host never answered, or
 *                                 its agent predates the field. NOT "none".
 *   {supported:false, reason}   — the host could not look: no `wg` binary, or
 *                                 the privileged shellout was refused. Its own
 *                                 sentence, and never rendered as "down".
 *   {supported:true, tunnels}   — it looked. An empty list here is a FACT.
 *
 * `handshakeNever` and `handshakeAgeSeconds` are kept apart for the same
 * reason: an age of `0` is a handshake one second ago, and a tunnel that never
 * handshaked has no age at all — computing one gives an age since the epoch.
 */
function mapExternalTunnels(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.supported !== true) {
    return { supported: false, reason: raw.reason || '', tunnels: [] };
  }
  const list = Array.isArray(raw.tunnels) ? raw.tunnels : [];
  return {
    supported: true,
    reason: raw.reason || '',
    tunnels: list.map((t) => ({
      interface: t?.interface || '',
      peerPublicKey: t?.peer_public_key || '',
      // wg's own "(none)" is already normalised to "" on the host.
      endpoint: t?.endpoint || '',
      allowedIps: Array.isArray(t?.allowed_ips) ? t.allowed_ips : [],
      rxBytes: typeof t?.transfer_rx_bytes === 'number' ? t.transfer_rx_bytes : null,
      txBytes: typeof t?.transfer_tx_bytes === 'number' ? t.transfer_tx_bytes : null,
      handshakeNever: t?.last_handshake_never === true,
      handshakeAgeSeconds: typeof t?.last_handshake_age_seconds === 'number'
        ? t.last_handshake_age_seconds
        : null,
    })),
  };
}

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
        // Tailscale's ExitNodeOption: advertised AND approved by headscale.
        // False while the route is unapproved, even if advertised —
        // selecting it would point a default route at a gate that will not
        // yet forward. This is the field exitGateCandidates filters on.
        offersExit: !!node?.offers_exit,
        // Advertised, whether or not approved. Paired with offersExit so the
        // UI can tell "waiting on control plane" apart from "never
        // advertised".
        advertisesExit: !!node?.advertises_exit,
        eligibility: mapEligibility(node?.eligibility),
        // Non-mesh WireGuard, independent of tailscale: a host with no mesh
        // membership at all can still terminate one, so this is read off
        // every node rather than only the ones that are up.
        externalTunnels: mapExternalTunnels(node?.external_tunnels),
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
 * Can this host be bootstrapped into the mesh — and if not, WHY. Three
 * states, and 'unknown' is the point: a host that never reported is not the
 * same as one that reported "no", and collapsing them is what these three
 * states exist to prevent.
 *
 *   'no'      — the agent said so, or it is provable from `os`. Written
 *               reason, always.
 *   'unknown' — passes the OS gate and no agent has answered.
 *   'yes'     — ONLY when the agent said so. Never guessed — not even from
 *               `os === 'linux'`.
 *
 * The agent's own verdict (`node.eligibility`), when present, WINS over any
 * OS-based guess here, sentence included. A greyed-out button with no
 * sentence next to it reads as a bug, which is why every verdict carries
 * `reason`.
 */
export function bootstrapEligibility(host, node) {
  const os = (host?.os || '').toLowerCase();

  // The agent's verdict first, whatever the OS: it measured this machine,
  // the OS rule below did not.
  const reported = node?.eligibility;
  if (reported) {
    if (reported.canEnroll) {
      return {
        state: 'yes',
        label: 'Eligible',
        reason: reported.installer
          ? `This host's agent reports it can join the mesh — tailscale would be installed with \`${reported.installer}\`.`
          : "This host's agent reports it can join the mesh.",
      };
    }
    return {
      state: 'no',
      label: 'Not eligible',
      // The agent's own sentence, verbatim. It is the only part of this that
      // says what to change on that machine.
      reason: reported.enrollRefusal
        || "This host's agent reports it cannot join the mesh, without saying why.",
    };
  }

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
  // Still 'unknown', but THIS host has not sent a verdict — offline, timed
  // out, or an agent older than the field.
  return {
    state: 'unknown',
    label: 'Eligibility unconfirmed',
    reason: 'Linux clears the first requirement, but root, /dev/net/tun and systemd '
      + "are only knowable from the host itself and this one's agent has not "
      + 'reported them — no agent data.',
  };
}

/**
 * Install instructions per OS. macOS is listed separately — the Linux
 * one-liner installer does not work there.
 *
 * THE JOIN LINE IS NOT IN HERE, deliberately: it carries a live mesh
 * credential, so it only exists once someone has asked for one
 * (`mintJoinKey`), built by `joinCommand` below.
 */
export const CONTROL_PLANE_PLACEHOLDER = '<tenant-control-plane>';

export function installInstructions() {
  return [
    {
      id: 'linux',
      title: 'Linux / WSL2',
      commands: ['curl -fsSL https://tailscale.com/install.sh | sh'],
    },
    {
      id: 'macos',
      title: 'macOS',
      note: 'A genuinely different path — the Linux installer script does NOT work here.',
      commands: [
        'brew install tailscale',
        'sudo tailscaled install-system-daemon',
      ],
    },
  ];
}

/**
 * The one command that puts a machine on this mesh, with a REAL key in it.
 *
 * `$(hostname -s)` rather than a `<name>` placeholder: evaluated by the
 * machine's own shell, so the command works as printed instead of needing a
 * value filled in first.
 *
 * Returns `null` without a key — deliberately no "show it with a
 * placeholder" mode: rendering a command that cannot work is the bug this
 * whole path replaces.
 */
export function joinCommand(controlPlane, key) {
  if (!key) return null;
  const cp = controlPlane || CONTROL_PLANE_PLACEHOLDER;
  return `sudo tailscale up --login-server=${cp} --authkey=${key} --hostname=$(hostname -s)`;
}

/**
 * Mint a join key for this tenant's mesh.
 *
 * REJECTS on failure, unlike the readers above: this only runs because
 * somebody pressed a button, so the failure belongs next to that button —
 * never folded into a screen-wide state. The backend's own sentence (e.g.
 * naming a missing admin credential) is the useful thing to show.
 *
 * The key comes back exactly once — headscale masks it on read afterwards —
 * so a caller that drops it mints a new one.
 */
export async function mintJoinKey(slug) {
  const s = slug || (await resolveAccountSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/mesh-join-key`);
  const data = await apiFetch(url, { method: 'POST' }).then(readJson);
  return {
    key: data?.key || '',
    // ISO-8601 from headscale itself, not from this browser's clock.
    expiresAt: data?.expires_at || null,
    reusable: !!data?.reusable,
    controlPlaneUrl: data?.control_plane_url || null,
  };
}

/**
 * Enrol an already-linked host in the mesh, remotely — no key ever reaches
 * this browser. The credential is minted, spent and (on failure) expired
 * inside aw-backend.
 *
 * A REFUSAL IS A NORMAL RESULT, not a rejection: `refused: true` with the
 * host's own sentence arrives as a 409 whose body carries it.
 */
export async function joinMesh(slug, hostId) {
  const s = slug || (await resolveAccountSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts/${encodeURIComponent(hostId)}/mesh-join`);
  const data = await apiFetch(url, { method: 'POST' }).then(readJson);
  return {
    enrolled: !!data?.enrolled,
    alreadyEnrolled: !!data?.already_enrolled,
    changed: !!data?.changed,
    refused: !!data?.refused,
    refusal: data?.refusal || '',
    nodeName: data?.node_name || null,
    meshIp: data?.mesh_ip || null,
    loginServer: data?.login_server || null,
    // Enrolling must not move this machine's egress. Reported, not assumed.
    usesExitNode: data?.uses_exit_node,
    reason: data?.reason || '',
    error: data?.error || '',
    detail: data?.detail || '',
  };
}

/**
 * Can this host be enrolled from this screen right now — and if not, WHY.
 *
 * Three refusals, in the order they stop mattering, each with a complete
 * sentence because a greyed control with nothing next to it reads as a bug:
 *
 *   - it is already on the mesh. Nothing to do, and the button must not
 *     pretend otherwise.
 *   - its link is offline. Remote enrolment drives the host's own agent down
 *     the /link tunnel; with no tunnel there is nothing to drive, and that is
 *     a different problem from the machine being unable to join.
 *   - the agent's own eligibility verdict says no, or has not answered. That
 *     sentence is the host's, verbatim — see `bootstrapEligibility`.
 *
 * `unknown` is refused along with `no`, deliberately. Sending an enrolment to
 * a host that never reported whether it can hold one mints a live mesh
 * credential on a guess.
 */
export function joinMeshAvailability(host, node, eligibility) {
  if (node?.reported && node.up) {
    return {
      can: false,
      reason: `This host is already on the mesh${node.nodeName ? ` as ${node.nodeName}` : ''}, so there is nothing to join.`,
    };
  }
  if (!host?.connected) {
    return {
      can: false,
      reason: 'This link is offline. Enrolling from here drives the host’s own agent over its '
        + 'live /link connection, and there is none — bring the machine online, or run '
        + '`aw-remote-host vpn` on it directly.',
    };
  }
  if (eligibility?.state !== 'yes') {
    return { can: false, reason: eligibility?.reason || '' };
  }
  return { can: true, reason: '' };
}

/**
 * The public IP this workspace's own host goes out through, right now.
 * Resolves to `{ip, via, hostId, hostName, error}` and NEVER rejects — same
 * bargain as fetchMeshStatus: fetched alongside the host list, so a throw
 * would report an egress problem as "could not list the hosts".
 *
 * `ip` is null unless a live measurement came back on THIS call — no cache,
 * no last-known fallback, because a remembered address rendered as current
 * would answer "did the route change" wrongly, with total confidence.
 *
 * `hostName` is not decoration: this is one machine's egress, not the
 * account's, and a public IP with no owner is worse than none.
 */
export async function fetchPublicIp(slug) {
  try {
    const s = slug || (await resolveAccountSlug());
    const data = await apiFetch(centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/public-ip`)).then(readJson);
    return {
      ip: data?.ip || null,
      via: data?.via || null,
      hostId: data?.host_id || null,
      hostName: data?.host_name || null,
      error: data?.error || null,
    };
  } catch (e) {
    return { ip: null, via: null, hostId: null, hostName: null, error: String(e.message || e) };
  }
}

/**
 * The public IP one named REMOTE HOST goes out through, right now — not
 * necessarily this workspace's own machine. Same `{ip, via, error}`
 * contract and the same no-cache bargain as `fetchPublicIp` above: `ip` is
 * null unless this call measured it live, and an offline or too-old-agent
 * host answers with its own written reason rather than a guess.
 *
 * `hostId` is resolved against the caller's whole ACCOUNT on the backend
 * (`_resolve_account_host` in aw-backend's `host_link.py`), the same way
 * `fetchRemoteHosts` already lists hosts across every workspace this
 * account owns — so any owned `slug` works here, this is not "that host's
 * own workspace".
 *
 * NEVER resolves for an offline host by calling this — the caller already
 * knows `host.connected` from the row it has, and asking anyway would cost
 * a network round trip only to be told what is already known. See the
 * per-host effect in NetworkingTab.
 */
export async function fetchHostPublicIp(slug, hostId) {
  try {
    const s = slug || (await currentWorkspaceSlug());
    const data = await apiFetch(centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts/${encodeURIComponent(hostId)}/public-ip`)).then(readJson);
    return { ip: data?.ip || null, via: data?.via || null, error: data?.error || null };
  } catch (e) {
    return { ip: null, via: null, error: String(e.message || e) };
  }
}

/**
 * What choosing this node as a gate would cost, as complete sentences.
 *
 * ELIGIBLE AND COSTLY ARE NOT OPPOSITES: a gate can genuinely forward and
 * still be a bad idea (e.g. relaying every byte through a third party), so
 * hiding it would remove a real capability, and offering it silently would
 * hide what it costs.
 *
 * Two independent sources, kept as separate sentences rather than merged:
 *   - the GATE's own verdict (`eligibility.exitWarning`), verbatim.
 *   - the measured PATH to it (`path`/`via`) — a property of the link, not
 *     knowable by the gate itself.
 *
 * Returns `[]` when there is nothing to say.
 */
export function gateWarnings(node) {
  const out = [];
  const own = node?.eligibility?.exitWarning;
  if (own) out.push(own);
  if (node?.path === 'relay') {
    out.push(
      `The measured path to this gate is a relay${node.via ? ` (${node.via})` : ''}, not a direct `
      + 'connection. Routing through it sends ALL of this host’s traffic through that public '
      + 'relay — a third party carries every byte, and every round trip takes the detour.',
    );
  }
  return out;
}

/**
 * Offer `hostId` as an exit gate for the rest of the mesh — advertise on the
 * host, approve on the control plane.
 *
 * BOTH HALVES OR NEITHER: the backend withdraws the advertisement again if the
 * approval fails, because a node that advertises a route nobody approved looks
 * armed and forwards nothing. `offering` in the result is the host's own
 * re-measured `offers_exit`, not "the calls returned".
 *
 * A host whose agent attaches a warning to its verdict is refused (409,
 * `needs_acknowledgement`) until `acknowledgeWarning` is passed — so the
 * sentence the user agrees to comes from the machine, not from this file.
 */
export async function offerExitGate(slug, hostId, { acknowledgeWarning = false } = {}) {
  const s = slug || (await resolveAccountSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts/${encodeURIComponent(hostId)}/exit-offer`);
  const data = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledge_warning: acknowledgeWarning }),
  }).then(readJson);
  return {
    offering: !!data?.offering,
    nodeName: data?.node_name || null,
    advertising: !!data?.advertising,
    approvedRoutes: Array.isArray(data?.approved_routes) ? data.approved_routes : [],
    servingRoutes: Array.isArray(data?.serving_routes) ? data.serving_routes : [],
    warning: data?.warning || '',
    // Offering is not using: the advertiser keeps its own egress. Reported
    // from a real measurement on the host, so a regression here is visible
    // rather than assumed away.
    defaultRouteUnchanged: data?.default_route_unchanged,
    defaultRouteBefore: data?.default_route_before || null,
    defaultRouteAfter: data?.default_route_after || null,
    reason: data?.reason || '',
  };
}

/** Stop offering `hostId` as a gate. Does NOT clear any selection pointing at
 *  it — that is the selecting host's decision, and its own dead-man's switch
 *  or Clear button. */
export async function withdrawExitGate(slug, hostId) {
  const s = slug || (await resolveAccountSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts/${encodeURIComponent(hostId)}/exit-offer`);
  const data = await apiFetch(url, { method: 'DELETE' }).then(readJson);
  return {
    offering: !!data?.offering,
    advertising: !!data?.advertising,
    approvalError: data?.approval_error || '',
  };
}

/**
 * Can this host be OFFERED as a gate — and if not, WHY.
 *
 * Same three-state shape as `bootstrapEligibility`, for the same reason: a
 * greyed control with no sentence next to it reads as a bug, not a decision.
 * The states here are:
 *
 *   'offering'  — already a gate (advertised AND approved). The action is to
 *                 withdraw.
 *   'pending'   — advertising, nobody approved. This is the half-done state
 *                 the offer route exists to remove, and it is worth naming:
 *                 it looks armed and forwards nothing.
 *   'yes'       — the agent says it may. `warning` may still be non-empty.
 *   'no'        — the agent says it may not, with its sentence.
 *   'unknown'   — no agent verdict. Never guessed from the OS: whether a
 *                 kernel can forward is not knowable from `os === 'linux'`.
 */
export function exitOfferState(node) {
  if (!node?.reported || !node.up) {
    return {
      state: 'unknown',
      label: 'Gate eligibility unknown',
      reason: 'This host is not up on the mesh, so it could not report whether it may serve as an '
        + 'exit gate.',
      warning: '',
    };
  }
  if (node.offersExit) {
    return {
      state: 'offering',
      label: 'Offering as exit gate',
      reason: 'This host advertises an exit route and the control plane has approved it, so other '
        + 'hosts on this mesh may select it.',
      warning: node.eligibility?.exitWarning || '',
    };
  }
  if (node.advertisesExit) {
    return {
      state: 'pending',
      label: 'Advertising, not approved',
      reason: 'This host advertises an exit route that nobody has approved on the control plane. '
        + 'It looks armed and forwards nothing — offer it again to approve the route, or withdraw '
        + 'the advertisement.',
      warning: node.eligibility?.exitWarning || '',
    };
  }
  const verdict = node.eligibility;
  if (!verdict) {
    return {
      state: 'unknown',
      label: 'Gate eligibility unknown',
      reason: "This host's agent has not reported whether it may serve as an exit gate — it is "
        + 'too old for that verdict. Update aw-remote-host.',
      warning: '',
    };
  }
  if (!verdict.canAdvertiseExit) {
    return {
      state: 'no',
      label: 'Cannot be an exit gate',
      // The agent's own sentence. It is the only part that says what to change.
      reason: verdict.exitRefusal
        || "This host's agent reports it cannot serve as an exit gate, without saying why.",
      warning: '',
    };
  }
  return {
    state: 'yes',
    label: 'Can be an exit gate',
    reason: "This host's agent reports it can advertise an exit route. Offering it also approves "
      + 'that route on the control plane — both halves, or neither.',
    warning: verdict.exitWarning || '',
  };
}

/**
 * What routing through a host's EXTERNAL tunnel costs, as complete sentences.
 * Same bargain as `gateWarnings`: usable and wise are not the same question,
 * and the parts that decide the second one are only knowable from the
 * tunnel's own counters.
 *
 * `tunnels` is one entry per (interface, peer) — a client tunnel has one, a
 * hub has one per client — so the health read here is the health of the
 * interface as a whole.
 */
export const STALE_HANDSHAKE_SECONDS = 300;

export function externalGateWarnings(tunnels) {
  const out = [];
  const list = tunnels || [];
  if (list.length && list.every((t) => t.handshakeNever)) {
    out.push(
      'No peer on this tunnel has EVER completed a handshake. WireGuard is configured and the '
      + 'interface is up, but nothing has come through it — routing a container into it would '
      + 'black-hole that container until the handshake closes.',
    );
    return out;
  }
  const ages = list.map((t) => t.handshakeAgeSeconds).filter((a) => typeof a === 'number');
  if (ages.length && Math.min(...ages) > STALE_HANDSHAKE_SECONDS) {
    out.push(
      `The most recent handshake on this tunnel was ${Math.round(Math.min(...ages) / 60)} minutes `
      + 'ago. WireGuard rekeys a carrying tunnel every couple of minutes, so this one is idle at '
      + 'best — check it before pointing traffic at it.',
    );
  }
  return out;
}

/**
 * The gates `hostId` may be pointed at. TWO KINDS, in one list because the
 * user is answering one question — "where does this host's traffic leave
 * from" — and two pickers is how somebody stops knowing which one is in
 * force (external-vpns-in-networking.md §3.3).
 *
 * `kind: 'mesh'` — a tailscale node on this tenant's own mesh. Three filters,
 * none of them cosmetic:
 *
 *   - `offersExit` — advertised AND approved by headscale. Offering a node
 *     that only advertises would put a default route onto a gate that cannot
 *     forward, which is the exact way a machine ends up stranded.
 *   - `up` — a gate that is not on the mesh right now cannot carry anything.
 *   - not itself — a host cannot be its own exit.
 *
 * The host refuses all three again on its side (`vpn.ResolveExitPeer`), so
 * this is defence in depth. It is here as well because a control the user
 * cannot press is a better answer than an error after they press it.
 *
 * `kind: 'external'` — a non-mesh WireGuard tunnel another host already
 * TERMINATES, one candidate per interface. Its filters are different because
 * the mechanism is: nothing is advertised or approved anywhere, the apply
 * runs on the machine that owns the tunnel rather than on the host that
 * moves, and so what it needs is a LIVE LINK to that machine — `connected`,
 * not `up` on the mesh. A host with no tailscale at all can still be routed
 * this way, which is exactly the case that made the verb exist.
 *
 * `value` is what the picker puts in the `<option>` and what the caller
 * dispatches on. A mesh candidate's value is the node name the API takes
 * verbatim; an external one is synthetic, because the API takes the ACTING
 * host's id and there is no name that means the same thing.
 */
export function exitGateCandidates(hosts, mesh, hostId) {
  if (!mesh?.available) return [];
  const out = [];
  const external = [];
  for (const host of hosts || []) {
    if (host.id === hostId) continue;
    const node = mesh.nodes?.[host.id];
    if (node?.reported && node.up && node.offersExit) {
      // `value` has to stay the identifier tailscale itself resolves — see
      // the doc comment above, "the node name the API takes verbatim" — so
      // it is never `friendly_name`, which is an aw-backend label the mesh
      // has never heard of and `vpn.ResolveExitPeer` would reject. Only the
      // DISPLAY name gets the friendly_name-first priority.
      const gateName = node.nodeName || host.hostname;
      if (gateName) {
        out.push({
          kind: 'mesh',
          value: gateName,
          hostId: host.id,
          name: host.friendly_name || gateName,
          meshIp: node.meshIp || null,
          // Eligible AND costly are not opposites. `gateWarnings` is what
          // turns a silent "sure, pick it" into a sentence the user agrees
          // to first.
          warnings: gateWarnings(node),
        });
      }
    }
    // The external half. Deliberately NOT gated on the mesh state above: the
    // two have nothing to do with each other, and the machine that terminates
    // the GL.iNet tunnel today reports `can_enroll: false`.
    if (!host.connected) continue;
    for (const entry of externalInterfaces(node?.externalTunnels)) {
      external.push({
        kind: 'external',
        value: `external:${host.id}:${entry.interface}`,
        viaHostId: host.id,
        viaHostName: hostLabel(host, node?.nodeName || host.id),
        interface: entry.interface,
        name: `${entry.interface} on ${hostLabel(host)}`,
        // The PEER COUNT, not an endpoint. A hub carries one interface and
        // many peers, so "the endpoint" is not a thing it has — labelling the
        // option with the first peer's would name whichever one `wg show`
        // happened to print first, which on the production hub is a container
        // address belonging to something else entirely.
        peers: entry.tunnels.length,
        endpoints: entry.endpoints,
        warnings: externalGateWarnings(entry.tunnels),
      });
    }
  }
  // Stable order, and by the name the user picks by — the host list's own
  // order is by link age, which is meaningless in a gate picker. The mesh
  // gates stay ahead of the external ones: they are the ones this screen has
  // always offered, and reordering them under a new feature would move a
  // control users already know where to find.
  out.sort((a, b) => a.name.localeCompare(b.name));
  external.sort((a, b) => a.name.localeCompare(b.name));
  return out.concat(external);
}

/**
 * A host's external tunnels grouped by INTERFACE — `wg show all dump` emits
 * one line per (interface, peer), so the production hub arrives as nine rows
 * of `wg0` and rendering nine "VPNs" would invent eight.
 *
 * Returns `[]` for every state that is not "the host looked and found some":
 * the caller that needs to tell unknown from empty reads
 * `node.externalTunnels` directly.
 */
export function externalInterfaces(externalTunnels) {
  if (!externalTunnels?.supported) return [];
  const byName = new Map();
  for (const t of externalTunnels.tunnels || []) {
    const name = t.interface;
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, { interface: name, tunnels: [], endpoints: [] });
    const entry = byName.get(name);
    entry.tunnels.push(t);
    if (t.endpoint && !entry.endpoints.includes(t.endpoint)) entry.endpoints.push(t.endpoint);
  }
  return [...byName.values()].sort((a, b) => a.interface.localeCompare(b.interface));
}

/**
 * Point `hostId`'s egress at an external tunnel `viaHost` terminates — or
 * preview it.
 *
 * TWO HOSTS IN ONE CALL, which is the surprising part and is not an
 * accident: `hostId` names who MOVES, `viaHost` names who ACTS. The host that
 * needs this is a container with no `ip`, no `wg` and no runtime of its own,
 * so it cannot write a rule for itself; the machine hosting it can, and
 * already terminates the tunnel. See `set_external_route` in aw-backend's
 * `host_link.py`, which resolves both against the caller's account
 * separately.
 *
 * Rejects like `applyExitGate` and for the same reason — a button pressed it,
 * so a failure belongs next to that button. A 409 refusal rejects too, and
 * nothing on either machine was touched.
 */
export async function applyExternalRoute(slug, hostId, { viaHost, plan = false } = {}) {
  const s = slug || (await resolveAccountSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts/${encodeURIComponent(hostId)}/external-route`);
  const data = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ via_host: viaHost, plan }),
  }).then(readJson);
  return mapExternalRouteResult(data);
}

/** Take `hostId`'s egress back off the external tunnel. `viaHost` is still
 *  required — the rule lives on that machine and only it can remove one — but
 *  nothing else is: an undo that can refuse is one that fails exactly when it
 *  is most needed. */
export async function clearExternalRoute(slug, hostId, viaHost) {
  const s = slug || (await resolveAccountSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts/${encodeURIComponent(hostId)}/external-route`);
  const data = await apiFetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ via_host: viaHost }),
  }).then(readJson);
  return mapExternalRouteResult(data);
}

/**
 * The verb's reply, in the same vocabulary the mesh gate's already uses so
 * one renderer can show either — `EgressPairs` reads `egressBefore`/
 * `hostHeld`/`hostMoved` and must not learn a second set of names.
 *
 * The container pair is at the TOP LEVEL here rather than inside a
 * `container_egress` object, because the external verb measures the moved
 * container's address directly (it shares the container's netns) instead of
 * probing the network. Same meaning, different measurement, so it is mapped
 * onto the same fields with `via`/`runtime` left null rather than invented.
 */
function mapExternalRouteResult(data) {
  const plan = data?.plan || {};
  return {
    kind: 'external',
    plan: !!data?.planned,
    // No `applied` on the wire: an external route is applied exactly when it
    // was confirmed, because the host reverts anything it could not confirm.
    applied: !!data?.confirmed,
    confirmed: !!data?.confirmed,
    reverted: !!data?.reverted,
    refused: !!data?.refused,
    refusal: data?.refusal || '',
    reason: data?.reason || '',
    error: data?.error || '',
    gate: plan.tunnel_dev || data?.tunnel_dev || '',
    gateIp: plan.tunnel_via || null,
    container: plan.container || data?.container || '',
    sourceIp: plan.source_ip || data?.source_ip || null,
    table: plan.table ?? data?.table ?? null,
    priority: plan.priority ?? data?.priority ?? null,
    egressBefore: data?.host_before || null,
    egressAfter: data?.host_after || null,
    hostHeld: !!data?.host_held,
    hostMoved: !!data?.host_moved,
    containerEgressBefore: data?.container_before ? { ip: data.container_before } : null,
    containerEgressAfter: data?.container_after ? { ip: data.container_after } : null,
    runtime: plan.runtime || null,
    containerRoutes: [],
    exclusions: (plan.exclusions || data?.exclusions || []).map((prefix) => ({
      prefix,
      reason: 'held outside the tunnel so this machine stays manageable',
    })),
    deadmanStillArmed: !!data?.deadman_still_armed,
  };
}

/** The aw-remote-host release whose exit gate routes the CONTAINER networks
 *  (commit `8b2fbb3`) instead of the machine. Kept in step with
 *  EXIT_GATE_MIN_AGENT_LABEL in aw-backend's `src/api/routes/host_link.py`,
 *  which is the copy that BINDS — this one only decides what the screen
 *  offers. */
export const CONTAINER_SCOPED_GATE_VERSION = 'v0.1.58';

/**
 * `"v0.1.58"` → `[0, 1, 58]`, or `null` when the string is not a release tag.
 *
 * `null` for `dev` (a locally built agent) and for a host that reported no
 * version at all, both of which the caller treats as too old — a version
 * nobody can compare proves nothing about what is in the binary. A `git
 * describe` suffix truncates to its TAG rather than rounding up: a build after
 * v0.1.57 is not v0.1.58.
 */
export function parseAgentVersion(raw) {
  if (!raw) return null;
  const text = String(raw).trim().replace(/^v/i, '').split(/[-+]/)[0];
  const parts = text.split('.');
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

/**
 * Why selecting an exit gate is refused for THIS host — or `null` when it
 * may be offered one.
 *
 * Returns `{ kind, badge, detail }` rather than a bare string, because a
 * refusal has to be readable as STATE before it is readable as prose. With
 * every host refused, a screen that only knows how to say the paragraph
 * renders as an essay and the controls disappear into it. `badge` is the
 * answer in four words; `detail` is the same paragraph, unchanged, for a
 * reader who asks. Nothing here rewrites what was already written — only
 * when it arrives.
 *
 * `kind` is the vocabulary aw-backend already emits (`refusal_kind` in
 * `_exit_gate_scope_refusal`, `src/api/routes/host_link.py`): `platform`
 * for the permanent one, `agent_too_old` for the one an update fixes.
 * Same two values on purpose — a third refusal invented on the server has
 * to be given a badge here deliberately, not silently inherit one.
 *
 * Two refusals, neither a leftover. The PERMANENT one is checked first —
 * telling a Mac to update its agent would promise a fix it is never going
 * to get:
 *
 *   - macOS, permanently. Its containers live inside a Linux VM that NATs
 *     them to its own address before macOS sees them, and macOS has no
 *     source-prefix routing to key a rule with — the only scope left is the
 *     whole machine.
 *   - an agent BELOW v0.1.58, including one that reported no version. It
 *     still carries the host-scoped code and would move the machine's
 *     route; it cannot refuse that on its own behalf, because the refusal
 *     ships with the update.
 *
 * Not the enforcement — aw-backend's 409 is, from the same two columns —
 * this is here so the screen does not offer a button that would be
 * refused, which reads as broken rather than a decision.
 *
 * CLEARING is never refused — a host already on a gate has to be able to
 * get off one.
 */
const CONTAINER_SCOPED_GATE_MIN = [0, 1, 58];

/** `a < b` over `[major, minor, patch]`. */
function versionBelow(a, b) {
  for (let i = 0; i < b.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

export function exitGateSelectRefusal(host) {
  if ((host?.os || '').toLowerCase() === 'darwin') {
    return {
      kind: 'platform',
      badge: 'macOS cannot select',
      detail: 'macOS cannot route its containers without routing the Mac itself, and that is '
        + 'architecture rather than a feature nobody has written yet. Docker Desktop and '
        + '`podman machine` run containers inside a Linux VM which NATs their traffic to its own '
        + 'address before macOS ever sees it, so there is no container CIDR left out here to key a '
        + 'rule on — and macOS has no `ip rule` to key one with either, only destination routes. To '
        + 'route a Mac’s containers through a gate, run aw-remote-host INSIDE the VM and select the '
        + 'gate there, the same way a Windows host selects one from its WSL2 distro.',
    };
  }
  const version = parseAgentVersion(host?.cli_version);
  if (!version || versionBelow(version, CONTAINER_SCOPED_GATE_MIN)) {
    const seen = host?.cli_version ? `reports ${host.cli_version}` : 'has not reported a version';
    return {
      kind: 'agent_too_old',
      badge: `needs agent ${CONTAINER_SCOPED_GATE_VERSION}`,
      detail: `This host’s agent ${seen}, and the exit gate only routes CONTAINER networks from `
        + `aw-remote-host ${CONTAINER_SCOPED_GATE_VERSION} onwards. An older binary still carries `
        + 'the host-scoped code: it would move the MACHINE’s default route, and every container '
        + 'with it, when the only egress that should move is the containers’. Update aw-remote-host '
        + `to ${CONTAINER_SCOPED_GATE_VERSION} or later. Clearing a gate is never refused, so a host `
        + 'already on one can still be taken off it.',
    };
  }
  return null;
}

/**
 * **A host that ADVERTISES a gate cannot SELECT one.** tailscale will not
 * do both at once, so an apply from this host fails at `tailscale set` and
 * reverts — cleanly, but only after the user has committed to it.
 *
 * Read from this host's OWN advertise state (`advertises_exit`) so it can
 * be said BEFORE the attempt instead of discovered halfway through a
 * mutation.
 *
 * A warning and not a refusal: it is a live tailscale pref, changeable from
 * the row right above this one, and the host's own sequence already fails
 * safely if somebody proceeds anyway.
 */
export function advertiseConflictWarning(node) {
  if (!node?.advertisesExit) return '';
  return 'This host currently ADVERTISES itself as an exit gate, and tailscale refuses to '
    + 'advertise one and select one at the same time. Applying a gate here will fail at '
    + '`tailscale set` and revert. Stop offering this host as a gate first, then select one.';
}

/**
 * Route the CONTAINERS on `hostId` out through `node`, or preview what that
 * would do.
 *
 * `plan: true` resolves the gate, the exclusions and the container networks
 * and changes NOTHING — that is what the confirmation dialog shows, so the
 * sentence a user agrees to is generated from the real machine rather than
 * written here.
 *
 * Unlike the two readers above this DOES reject, and deliberately: it is a
 * deliberate action with a button behind it, so a failure belongs next to
 * that button rather than folded into a screen-wide state. A REFUSAL rejects
 * too — the API answers 409 whether it or the host decided, and nothing on
 * the machine was touched either way.
 *
 * A gate that could not be confirmed is NOT a rejection. It comes back as a
 * normal result with `applied: false` and the addresses that say why — the
 * host reverted itself before answering, so nothing is wrong with it and
 * those addresses are what the user needs to see.
 */
export async function applyExitGate(slug, hostId, { node, plan = false } = {}) {
  // No scope refusal re-checked here — the refusals that BIND are
  // aw-backend's 409 and the host's own. See exitGateSelectRefusal.
  const s = slug || (await resolveAccountSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts/${encodeURIComponent(hostId)}/exit-gate`);
  const data = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node, plan }),
  }).then(readJson);
  return mapExitGateResult(data);
}

/** Put `hostId`'s default route back. No body, no preconditions — an undo
 *  that can refuse is one that fails exactly when it is most needed. */
export async function clearExitGate(slug, hostId) {
  const s = slug || (await resolveAccountSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts/${encodeURIComponent(hostId)}/exit-gate`);
  const data = await apiFetch(url, { method: 'DELETE' }).then(readJson);
  return {
    cleared: data?.cleared !== false,
    egress: data?.egress || null,
    egressError: data?.egress_error || null,
    exclusionsRemoved: data?.exclusions_removed || 0,
  };
}

function mapExitGateResult(data) {
  return {
    // Which of the two gate kinds produced this, so one renderer can show
    // either without inferring it from which fields happen to be populated.
    kind: 'mesh',
    plan: !!data?.plan,
    applied: !!data?.applied,
    confirmed: !!data?.confirmed,
    reverted: !!data?.reverted,
    refused: !!data?.refused,
    refusal: data?.refusal || '',
    reason: data?.reason || '',
    error: data?.error || '',
    gate: data?.gate || null,
    gateIp: data?.gate_ip || null,
    gatePath: data?.gate_path || null,
    // FOUR addresses, read as TWO PAIRS. The host pair should be IDENTICAL —
    // `hostHeld` is the machine's own assertion, `hostMoved` is the failure
    // that damages the box. The container pair should DIFFER, from each
    // other and from the host's.
    //
    // Empty means NOT MEASURED, never "unchanged" — the renderer must show
    // an absent address as unknown, not a repeat of the other one.
    egressBefore: data?.egress_before || null,
    egressAfter: data?.egress_after || null,
    hostHeld: !!data?.host_held,
    hostMoved: !!data?.host_moved,
    containerEgressBefore: mapContainerEgress(data?.container_egress_before),
    containerEgressAfter: mapContainerEgress(data?.container_egress_after),
    // What would actually move, so a confirmation can name the networks
    // rather than promise "your containers" and hope.
    runtime: data?.runtime || null,
    containerRoutes: Array.isArray(data?.container_routes)
      ? data.container_routes.map((r) => ({
        prefix: r?.prefix || '',
        networks: Array.isArray(r?.networks) ? r.networks : [],
      }))
      : [],
    exclusions: Array.isArray(data?.exclusions)
      ? data.exclusions.map((e) => ({ prefix: e?.prefix || '', reason: e?.reason || '' }))
      : [],
    deadmanStillArmed: !!data?.deadman_still_armed,
  };
}

/** `{ip, via, runtime, network, error}` as the host measured it from inside a
 *  container, or `null` when it sent nothing. `null` is NOT "no address" — the
 *  renderer has to keep "not measured" apart from "measured and unchanged". */
function mapContainerEgress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    ip: raw.ip || null,
    via: raw.via || null,
    runtime: raw.runtime || null,
    network: raw.network || null,
    error: raw.error || '',
  };
}

/**
 * The `tekflox/aw-remote-host` repo, in ONE place — it may go private
 * (`security:home-ip-and-wg-port-in-public-repo-test-fixtures`), and every
 * install/link URL below derives from this constant so that stays a
 * one-line change instead of a grep-and-replace across the UI.
 */
export const REMOTE_HOST_REPO = 'tekflox/aw-remote-host';

/**
 * How to install aw-remote-host on a machine that isn't linked yet —
 * verified against `repos/aw-remote-host/install.sh` (all 88 lines) and
 * `README.md` on 2026-09-03, not copied from memory.
 *
 * The installer only downloads and installs a binary — on EVERY platform it
 * restarts nothing, and installing is not linking (see `linkCommand`
 * below). `install.sh` itself refuses anything but linux/darwin; Windows is
 * a genuinely different script (`install.ps1`), unverified against a real
 * machine unlike the other two, and labelled as such.
 */
export function remoteHostInstallInstructions() {
  const shUrl = `https://raw.githubusercontent.com/${REMOTE_HOST_REPO}/main/install.sh`;
  return [
    {
      id: 'linux',
      title: 'Linux',
      commands: [`curl -fsSL ${shUrl} | sh`],
      persistence: 'Persists as a systemd user unit. Also run `loginctl enable-linger $USER` — '
        + 'without it the agent dies the moment you log out.',
    },
    {
      id: 'macos',
      title: 'macOS',
      commands: [`curl -fsSL ${shUrl} | sh`],
      persistence: 'Persists as a LaunchAgent — starts at login on its own, no linger step needed.',
    },
    {
      id: 'windows',
      title: 'Windows',
      unverified: true,
      commands: [`irm https://raw.githubusercontent.com/${REMOTE_HOST_REPO}/main/install.ps1 | iex`],
      persistence: 'Persists as a Scheduled Task triggered at logon, not boot — lean link only. '
        + 'Unverified against a real machine.',
    },
  ];
}

/**
 * The one command that links an already-installed host to THIS workspace —
 * a separate, second step from installing the binary, and the part people
 * get wrong (see `mintBootstrapToken` below for where the token comes from).
 *
 * `null` without a token — same no-placeholder rule `joinCommand` already
 * keeps: a command that cannot work is the bug this whole path replaces.
 */
export function linkCommand(token) {
  if (!token) return null;
  return `aw-remote-host link --token ${token} --background`;
}

/**
 * Mint a one-time bootstrap token for THIS workspace — the credential
 * `linkCommand` needs. `POST /api/workspaces/{slug}/bootstrap-token`
 * already exists (owner-only, single-use, plaintext returned exactly once —
 * aw-backend masks it on every later read), so this needed no new endpoint.
 *
 * MINT ON A PRESS, NEVER ON A RENDER — same discipline `mintJoinKey` already
 * keeps and for the same reason: a token sitting in a component after the
 * tab was merely opened is a credential nobody is watching. The workspace
 * API key is a different, long-lived credential and must never reach this
 * path.
 *
 * Rejects on failure, like `mintJoinKey` — a button press owns its own
 * error.
 */
export async function mintBootstrapToken(slug) {
  const s = slug || (await currentWorkspaceSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/bootstrap-token`);
  const data = await apiFetch(url, { method: 'POST' }).then(readJson);
  return { token: data?.token || '', expiresAt: data?.expires_at || null };
}

/**
 * Rename a linked host — sets its per-LINK `friendly_name`. A LINK, not a
 * machine: the same hostname legitimately appears on more than one row
 * (host_link.py:428-429), which is exactly why the name being renamed here
 * is per-link too. `''`/`null` clears it back to showing the raw hostname.
 *
 * REJECTS on failure, following `applyExitGate`'s convention — a button
 * press (here, Save) owns its own error, and the caller treats a reject as
 * "this row failed, the others may still have succeeded."
 */
export async function renameRemoteHost(slug, hostId, friendlyName) {
  const s = slug || (await currentWorkspaceSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts/${encodeURIComponent(hostId)}`);
  const data = await apiFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friendly_name: friendlyName || null }),
  }).then(readJson);
  return { id: data?.id || hostId, friendlyName: data?.friendly_name || null };
}

/**
 * Unlink a host from this account — irreversible: the credential is revoked
 * immediately, with no grace period, and getting the machine back means
 * re-running install + link on it from scratch. 404s if `hostId` isn't the
 * caller's or is already revoked.
 *
 * REJECTS on failure, following `renameRemoteHost`'s convention — the
 * button press owns its own error.
 */
export async function deleteRemoteHost(slug, hostId) {
  const s = slug || (await currentWorkspaceSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-hosts/${encodeURIComponent(hostId)}`);
  return apiFetch(url, { method: 'DELETE' }).then(readJson);
}

/**
 * The single global "latest aw-remote-host release" value — NOT the
 * `remote_host.current`/`.outdated` fields this same endpoint also returns,
 * which resolve ONE workspace's active host row (`_active_remote_host_row`)
 * and are meaningless against an account-wide table of many hosts. Per-row
 * current is `host.cli_version`, already in the table payload; only
 * `latest` is safe to reuse here.
 *
 * Resolves to `null` on any failure, never rejects — same bargain
 * `fetchMeshStatus` makes, so a version-lookup hiccup can't blank the host
 * table.
 */
export async function fetchRemoteHostLatestVersion(slug) {
  try {
    const s = slug || (await currentWorkspaceSlug());
    const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/versions`);
    const data = await apiFetch(url).then(readJson);
    return data?.remote_host?.latest || null;
  } catch {
    return null;
  }
}

/**
 * Dispatch a binary self-update to the remote host backing `slug`'s
 * workspace — the same `remote-host-update` action aw-console's BYOD panel
 * already triggers. Blocks for minutes, not seconds: the driver dispatches
 * with `SELF_UPDATE_TIMEOUT_S` (120s) and then waits out the host's
 * reconnect on the new binary, up to `SELF_UPDATE_RECONNECT_TIMEOUT_S`
 * (default 300s), before returning. The response is a serialized Workspace
 * row — it carries no `cli_version` — so the caller must refetch the host
 * list to see the new version, not relabel from this response.
 *
 * REJECTS on failure, following `renameRemoteHost`'s convention — the
 * button press owns its own error.
 */
export async function updateRemoteHostBinary(slug) {
  const s = slug || (await currentWorkspaceSlug());
  const url = centralApiUrl(`/api/workspaces/${encodeURIComponent(s)}/remote-host/update`);
  return apiFetch(url, { method: 'POST' }).then(readJson);
}

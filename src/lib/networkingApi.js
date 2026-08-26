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
/**
 * The host's own bootstrap-eligibility verdict, or `null` when its agent sent
 * none.
 *
 * `null` is a THIRD answer, not a falsy "no". An agent too old for the field
 * said nothing about root, /dev/net/tun or systemd, and
 * `bootstrapEligibility` keeps its honest-unknown for exactly that host. A
 * `{canEnroll: false}` here would report a refusal nobody ever made.
 */
function mapEligibility(raw) {
  if (!raw || typeof raw.can_enroll !== 'boolean') return null;
  return {
    canEnroll: raw.can_enroll,
    enrollRefusal: raw.enroll_refusal || '',
    canAdvertiseExit: !!raw.can_advertise_exit,
    exitRefusal: raw.exit_refusal || '',
    // A THIRD answer beside yes and no: this host may serve as a gate, and
    // here is what choosing it costs. The Surface is the case — a WSL2 distro
    // forwards through another layer of Windows NAT it does not control — and
    // it is why `canAdvertiseExit: true` is not on its own enough to render a
    // plain button. Empty on agents predating the field, which reads as "no
    // warning" and is right: any actual refusal still arrives in exitRefusal.
    exitWarning: raw.exit_warning || '',
    // The CLIENT-side verdict: can this host be pointed AT a gate. A different
    // question from canAdvertiseExit, and not implied by canEnroll either —
    // `b614f41828c8`, the aw workspace's own container, has neither tailscale
    // nor systemd nor `ip`, so it can host a workspace and can never select a
    // gate. `null` when the agent predates the field, kept distinct from
    // `false` for the same reason every other verdict here keeps it.
    canSelectExit: typeof raw.can_select_exit === 'boolean' ? raw.can_select_exit : null,
    selectExitRefusal: raw.select_exit_refusal || '',
    installer: raw.installer || null,
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
        // A node that advertises 0.0.0.0/0 but is still waiting on an admin
        // reads false, which is the answer that matters — until the route is
        // approved, selecting it moves a default route onto a gate that will
        // not forward. exitGateCandidates below is the only consumer, and
        // this is the field it filters on.
        offersExit: !!node?.offers_exit,
        // Advertised, whether or not anybody approved it. The PAIR is what
        // tells the two halves apart on screen: advertising with offersExit
        // false is "waiting on the control plane", which is a different
        // problem, for a different person, than "never advertised".
        advertisesExit: !!node?.advertises_exit,
        eligibility: mapEligibility(node?.eligibility),
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
 * Three states on purpose, and the middle one is the point:
 *
 *   'no'      — the agent said so, or it is provable from `os`. Written
 *               reason, always.
 *   'unknown' — passes the OS gate and no agent has answered. Genuinely not
 *               known here.
 *   'yes'     — ONLY when the agent said so. Never guessed.
 *
 * `node` is this host's mesh-status entry (see `fetchMeshStatus`), and its
 * `eligibility` is the agent's own verdict: root, `/dev/net/tun`, systemd and
 * the OS, probed on the machine itself, with a complete sentence attached.
 * When it is there it WINS — including its sentence, which names the thing to
 * fix, where a reason composed here can only restate the boolean.
 *
 * When it is absent nothing below changes. A host that never reported is not
 * a host that reported "no", and collapsing the two is what this function's
 * three states exist to prevent. In particular 'yes' is still never inferred
 * from `os === 'linux'` — that would invent the very facts that decide it.
 *
 * A greyed-out button with no sentence next to it reads as a bug, which is
 * why every verdict carries `reason`.
 */
export function bootstrapEligibility(host, node) {
  const os = (host?.os || '').toLowerCase();

  // The agent's verdict first, whatever the OS: it measured this machine and
  // nothing here did. A macOS host that reports itself enrollable is right
  // and the OS rule below is out of date, not the other way round.
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
  // Still 'unknown', still the honest answer — but the blame moved. The
  // verdict IS reported now; THIS host has not sent one, because it is
  // offline, timed out, or runs an agent older than the field.
  return {
    state: 'unknown',
    label: 'Eligibility unconfirmed',
    reason: 'Linux clears the first requirement, but root, /dev/net/tun and systemd '
      + "are only knowable from the host itself and this one's agent has not "
      + 'reported them — no agent data.',
  };
}

/**
 * Install instructions per OS. macOS is a genuinely different path — the Linux
 * one-liner installer does not work there — so it is listed separately rather
 * than as a footnote.
 *
 * `controlPlane` is substituted in when known; when it isn't, the placeholder
 * stays visible so nobody copy-pastes another tenant's control plane.
 *
 * THE JOIN LINE IS NOT IN HERE, and that is the point of the split. Installing
 * tailscale is a command anyone can be shown at any time; joining is a command
 * that carries a live mesh credential, so it only exists once someone has
 * asked for one (`mintJoinKey`) and it is built by `joinCommand` below. The
 * previous version of this function ended each block with
 * `--authkey=<key> --hostname=<name>` — two placeholders a reader has no way
 * to fill, on a command that reads as if it would work.
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
 * `$(hostname -s)` rather than a `<name>` placeholder: it is a default that is
 * both sensible and correct on the machine running it — the short hostname,
 * evaluated by that machine's own shell, on Linux and macOS alike — where a
 * placeholder is a hole the reader has to know to fill. Anyone who wants a
 * different node name edits one word of a command that already works, instead
 * of being unable to run it at all.
 *
 * Returns `null` without a key. There is deliberately no "show it with a
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
 * REJECTS on failure, unlike the readers above, and for the same reason
 * `applyExitGate` does: this only ever runs because somebody pressed a button,
 * so a failure belongs next to that button. It must never be folded into a
 * screen-wide state, and it must never be swallowed into a placeholder — the
 * backend answers a missing admin credential with a sentence naming the config
 * key to add, and that sentence is the useful thing to show.
 *
 * The key comes back exactly once and is not readable again afterwards
 * (headscale masks it on read), so a caller that drops it mints a new one.
 * Single-use and minutes-long expiry are fixed on the backend, not asked for
 * here.
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
 * this browser.
 *
 * The distinction from `mintJoinKey` is the whole shape of this feature: a
 * machine that has an agent on the other end of a live link does not need a
 * human at a keyboard in front of it, so it gets driven rather than
 * instructed. The credential is minted, spent and (on failure) expired inside
 * aw-backend.
 *
 * A REFUSAL IS A NORMAL RESULT, not a rejection: `refused: true` with the
 * host's own sentence is the machine answering "I cannot do this, here is
 * why", and it arrives as a 409 whose body carries that sentence.
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
 *
 * Resolves to `{ip, via, hostId, hostName, error}` and NEVER rejects — same
 * bargain as fetchMeshStatus, for the same reason: it is fetched alongside
 * the host list, and a throw would report an egress problem as "could not
 * list the hosts".
 *
 * `ip` is null unless a live measurement came back on THIS call. There is no
 * cache and no last-known value to fall back on, and that is the whole point:
 * somebody flips a route and reads this number to find out whether it worked.
 * A remembered address rendered as the current one would answer that question
 * wrongly, with total confidence. `error` always carries a sentence when `ip`
 * is null, because "offline", "agent too old" and "up but no internet" need
 * three different things done about them.
 *
 * `hostName` is not decoration either. This is one machine's egress, not the
 * account's, and a public IP with no owner is worse than none — see
 * aw-backend's `public_ip` docstring for why the workspace's own host is the
 * one worth measuring.
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
 * What choosing this node as a gate would cost, as complete sentences.
 *
 * ELIGIBLE AND COSTLY ARE NOT OPPOSITES, and conflating them is how this
 * screen would go wrong in both directions at once. `aw-surface-wsl` is the
 * case that forced this: it CAN forward, so hiding it would remove a real
 * capability — and routing through it means egress via WSL2 → the Windows
 * host's NAT → a home connection, over a path that cannot hole-punch and
 * therefore relays through a public DERP. Offering that silently would push
 * every byte the workspace sends through a third-party relay without anybody
 * being told.
 *
 * Two independent sources, deliberately not merged into one string:
 *
 *   - the GATE's own verdict (`eligibility.exitWarning`) — measured on that
 *     machine, about what it is. Verbatim, like every other agent sentence
 *     on this screen.
 *   - the measured PATH to it (`path`/`via`) — a property of the link, which
 *     the gate cannot know about itself. `_mesh_observation` on the backend
 *     takes it from whichever other host measured it, so it is "the measured
 *     path to this gate", not necessarily the path from the host about to
 *     select it. Worded to claim only that.
 *
 * Returns `[]` when there is nothing to say, so a caller can render the
 * ordinary case with no special-casing.
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
 * The hosts that may be OFFERED as an exit gate for `hostId`.
 *
 * Three filters, and none of them is cosmetic:
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
 */
export function exitGateCandidates(hosts, mesh, hostId) {
  if (!mesh?.available) return [];
  const out = [];
  for (const host of hosts || []) {
    if (host.id === hostId) continue;
    const node = mesh.nodes?.[host.id];
    if (!node?.reported || !node.up || !node.offersExit) continue;
    const name = node.nodeName || host.hostname;
    if (!name) continue;
    out.push({
      hostId: host.id,
      name,
      meshIp: node.meshIp || null,
      // Eligible AND costly are not opposites. `gateWarnings` is what turns a
      // silent "sure, pick it" into a sentence the user agrees to first.
      warnings: gateWarnings(node),
    });
  }
  // Stable order, and by the name the user picks by — the host list's own
  // order is by link age, which is meaningless in a gate picker.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Why selecting an exit gate is refused, in the words the screen shows.
 *
 * Applying a gate moves the whole MACHINE's default route — the host and every
 * container on it — out through the gate. Only the containers' egress was ever
 * meant to move: the host's own public IP is the thing that must NOT change.
 * The first real apply took a Mac off the internet, and the same action is
 * reachable against a bare metal running production.
 *
 * Kept in step with EXIT_GATE_HOST_SCOPE_REFUSAL in aw-backend's
 * `src/api/routes/host_link.py` and vpn.HostRouteScopeRefusal in
 * aw-remote-host. Three copies of a sentence is a cost worth paying here: each
 * layer refuses independently, because the ones below it reach hosts only once
 * their binaries are updated.
 *
 * CLEARING is never refused — a host already on a gate has to be able to get
 * off one, and this screen is where people would go to do it.
 */
export const HOST_SCOPED_GATE_REFUSAL =
  'Applying an exit gate moves the whole machine’s default route, and every container on it, '
  + 'out through the gate — but the only egress that should move is the containers’. The '
  + 'host’s own public IP must not change. Until container-scoped routing exists this is '
  + 'refused, rather than keep offering a change that can take a production machine off the '
  + 'internet.';

/** Flips to false when the gate routes container networks instead of the
 *  machine. Not readable from anything a caller controls: a bypass someone can
 *  set is not a refusal. */
export const HOST_SCOPED_GATES_REFUSED = true;

/**
 * Route `hostId`'s traffic out through `node`, or preview what that would do.
 *
 * `plan: true` resolves the gate and the exclusions and changes NOTHING —
 * that is what the confirmation dialog shows, so the sentence a user agrees
 * to is generated from the real machine rather than written here.
 *
 * Unlike the two readers above this DOES reject, and deliberately: it is a
 * deliberate action with a button behind it, so a failure belongs next to
 * that button rather than folded into a screen-wide state.
 *
 * A gate that could not be confirmed is NOT a rejection. It comes back as a
 * normal result with `applied: false` and the before/after addresses that
 * say why — the host reverted itself before answering, so nothing is wrong
 * with it and the two addresses are what the user needs to see.
 */
export async function applyExitGate(slug, hostId, { node, plan = false } = {}) {
  // No scope refusal here on purpose. It would sit inside the same bundle as
  // the caller that already declines to render the control, so it enforces
  // nothing the component has not enforced — the refusals that BIND are
  // aw-backend's 409 and the host's own, both outside this trust boundary.
  // See HOST_SCOPED_GATE_REFUSAL.
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
    // Empty means NOT MEASURED, never "unchanged". The renderer must show an
    // absent address as unknown rather than repeating the other one.
    egressBefore: data?.egress_before || null,
    egressAfter: data?.egress_after || null,
    exclusions: Array.isArray(data?.exclusions)
      ? data.exclusions.map((e) => ({ prefix: e?.prefix || '', reason: e?.reason || '' }))
      : [],
    deadmanStillArmed: !!data?.deadman_still_armed,
  };
}

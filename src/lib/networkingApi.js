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
import { centralApiUrl } from '../apiBase';

/** Path of the mesh-status endpoint. Account-scoped like the host list, so
 *  it is built from a slug rather than being a constant. */
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
 * `{count, hosts:[{id, workspace_slug, hostname, os, arch, last_seen_at,
 * connected}]}` — every non-revoked link across the account, connected or not.
 *
 * Rows are per LINK, never per machine — the same `hostname` legitimately
 * appears more than once with different ids (a re-link leaves the previous
 * row behind, and one machine can carry both a Windows and a WSL2 link), so
 * don't dedupe them away.
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
 * Why selecting an exit gate is refused for THIS host, in the words the
 * screen shows — or `''` when it may be offered one.
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
    return 'macOS cannot route its containers without routing the Mac itself, and that is '
      + 'architecture rather than a feature nobody has written yet. Docker Desktop and '
      + '`podman machine` run containers inside a Linux VM which NATs their traffic to its own '
      + 'address before macOS ever sees it, so there is no container CIDR left out here to key a '
      + 'rule on — and macOS has no `ip rule` to key one with either, only destination routes. To '
      + 'route a Mac’s containers through a gate, run aw-remote-host INSIDE the VM and select the '
      + 'gate there, the same way a Windows host selects one from its WSL2 distro.';
  }
  const version = parseAgentVersion(host?.cli_version);
  if (!version || versionBelow(version, CONTAINER_SCOPED_GATE_MIN)) {
    const seen = host?.cli_version ? `reports ${host.cli_version}` : 'has not reported a version';
    return `This host’s agent ${seen}, and the exit gate only routes CONTAINER networks from `
      + `aw-remote-host ${CONTAINER_SCOPED_GATE_VERSION} onwards. An older binary still carries `
      + 'the host-scoped code: it would move the MACHINE’s default route, and every container '
      + 'with it, when the only egress that should move is the containers’. Update aw-remote-host '
      + `to ${CONTAINER_SCOPED_GATE_VERSION} or later. Clearing a gate is never refused, so a host `
      + 'already on one can still be taken off it.';
  }
  return '';
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

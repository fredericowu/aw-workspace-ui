import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  currentWorkspaceSlug,
  deleteRemoteHost,
  exitOfferState,
  fetchHostPublicIp,
  fetchMeshStatus,
  fetchRemoteHostLatestVersion,
  fetchRemoteHosts,
  linkCommand,
  mintBootstrapToken,
  remoteHostInstallInstructions,
  renameRemoteHost,
  updateRemoteHostBinary,
} from '../lib/networkingApi';

// Settings → General → Remote Hosts
//
// Every aw-remote-host LINK on this account — one row per link, never per
// machine (the same rule Networking's Links section keeps: a re-link leaves
// the old row behind, and one machine can hold more than one link, so
// `hostname` is not a key to group by) — plus how to add one that isn't
// linked yet.
//
// Read-only except the friendly name. Every exit-gate/routing CONTROL stays
// in Networking (Settings → General → Networking); this screen only shows
// its read-only verdict and links out. Two screens owning one control is
// how they drift apart.

function Pill({ tone = 'muted', children, title }) {
  const tones = {
    muted: 'bg-white/5 text-[var(--color-text-muted)]',
    ok: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    err: 'bg-red-500/15 text-red-300',
    info: 'bg-sky-500/15 text-sky-300',
  };
  return (
    <span title={title} className={`inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Section({ title, description, action, children }) {
  return (
    <div className="mb-4 border border-[var(--color-border)] rounded overflow-hidden">
      <div className="px-4 py-2.5 bg-[var(--color-bg-header)] flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</div>
          {description && (
            <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{description}</div>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="border-t border-[var(--color-border)] p-4 bg-[var(--color-bg-primary)]">{children}</div>
    </div>
  );
}

function relativeSeen(ts) {
  if (!ts) return 'never';
  const secs = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (secs < 90) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 90) return `${mins}min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// How long the host has been in its CURRENT state, as HH:MM — zero-padded,
// days prefixed past 24h (`3d 04:12`) rather than letting hours run past 24
// (`76:12`), which reads as a broken clock. Deliberately not prose — that's
// `relativeSeen`'s job for the Linked column; this cell stays a duration.
function sinceHhMm(ts) {
  if (typeof ts !== 'number') return null;
  const totalMins = Math.floor(Math.max(0, Date.now() / 1000 - ts) / 60);
  const days = Math.floor(totalMins / 1440);
  const hh = String(Math.floor((totalMins % 1440) / 60)).padStart(2, '0');
  const mm = String(totalMins % 60).padStart(2, '0');
  return days > 0 ? `${days}d ${hh}:${mm}` : `${hh}:${mm}`;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — the command is still selectable text.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CommandBlock({ command }) {
  return (
    <div className="mt-1 flex items-start gap-2">
      <pre className="flex-1 min-w-0 p-2 rounded bg-black/30 text-[11px] font-mono text-[var(--color-text-secondary)] overflow-x-auto whitespace-pre">
        {command}
      </pre>
      <CopyButton text={command} />
    </div>
  );
}

/**
 * This host's public IP — the per-host THREE-state rule Networking's
 * `HostPublicIp` already keeps: loading / offline (never asked) / measured
 * (which may itself carry an error and no address). Wording matched to that
 * cell verbatim rather than re-authored, per the card's "ceiling on prose"
 * rule.
 */
function HostPublicIp({ state }) {
  if (!state || state.status === 'loading') {
    return <span className="text-[11px] text-[var(--color-text-muted)]">measuring…</span>;
  }
  if (state.status === 'offline') {
    return (
      <span className="text-[11px] text-[var(--color-text-muted)]" title="This link is offline, so this host could not be asked.">
        —
      </span>
    );
  }
  if (!state.ip) {
    return (
      <Pill tone="warn" title={state.error || 'This host’s public IP could not be measured.'}>
        not known
      </Pill>
    );
  }
  return <code className="text-[11px] font-mono text-[var(--color-text-primary)] break-all">{state.ip}</code>;
}

// Column is compact by design (one of nine), so the badge is a short word —
// `exitOfferState`'s own full sentence (`verdict.label` + `verdict.reason`)
// goes in the `title` tooltip instead of on the badge itself, same "short
// label, full sentence one hover away" split MeshState/HostPublicIp already
// use elsewhere in Networking.
const EXIT_GATE_BADGE = {
  offering: 'Offering', pending: 'Pending approval', yes: 'Eligible', no: 'Not eligible', unknown: 'Unknown',
};

/**
 * "Can be an exit gate" — read-only, via `exitOfferState` (the OFFER
 * verdict — can this host BE a gate — never `exitGateSelectRefusal`, which
 * answers a different question: can it route THROUGH one). Degrades to
 * 'unknown' on a mesh outage rather than blanking the cell — the same
 * bargain `fetchMeshStatus` already makes for every other reader of it.
 */
function ExitGateCell({ mesh, hostId }) {
  const verdict = mesh?.available
    ? exitOfferState(mesh.nodes?.[hostId])
    : {
      state: 'unknown',
      reason: mesh?.reason || 'Mesh status is unavailable, so this could not be measured.',
    };
  const tone = { offering: 'ok', pending: 'warn', yes: 'info', no: 'err', unknown: 'muted' }[verdict.state] || 'muted';
  const title = [verdict.label, verdict.reason].filter(Boolean).join(' — ');
  return <Pill tone={tone} title={title}>{EXIT_GATE_BADGE[verdict.state] || 'Unknown'}</Pill>;
}

/** One row per `{slug, status, placement_driver}` — same-account only, one
 *  row per WORKSPACE PLACED on this link (Workspace.remote_host_id), not a
 *  process count. Usually renders one; an empty list is a fact, not a gap. */
function WorkspacesCell({ workspaces }) {
  const list = workspaces || [];
  if (list.length === 0) {
    return <span className="text-[11px] text-[var(--color-text-muted)]">—</span>;
  }
  return (
    <div className="grid gap-0.5">
      {list.map((w) => (
        <div key={w.slug} className="flex items-center gap-1.5 flex-wrap">
          <code className="text-[11px] font-mono text-[var(--color-text-primary)]">{w.slug}</code>
          <Pill tone={w.status === 'running' ? 'ok' : 'muted'}>{w.status || 'unknown'}</Pill>
        </div>
      ))}
    </div>
  );
}

/**
 * Online/offline pill plus how long the host has been in that CURRENT
 * state. The two halves use different timestamps and must not be swapped:
 * offline duration is `now - last_seen_at` (stops updating the moment the
 * link drops, so it is already correct); online duration is
 * `now - connected_since`, never `last_seen_at` — that field is rewritten
 * on every heartbeat while connected, so substituting it here would always
 * read ~0 and be a confident lie. `connected_since` may be null even while
 * connected (backend couldn't determine it): render the pill alone then,
 * same "no duration is better than a wrong one" rule `LinkedAt` below
 * already keeps for `created_at`.
 */
function StateCell({ host }) {
  const duration = host.connected ? sinceHhMm(host.connected_since) : sinceHhMm(host.last_seen_at);
  return (
    <>
      <Pill tone={host.connected ? 'ok' : 'muted'}>{host.connected ? 'online' : 'offline'}</Pill>
      {duration && <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">{duration}</div>}
    </>
  );
}

/**
 * When it was linked. `RemoteHost.created_at` exists in the backend model
 * but `GET .../remote-hosts` does not serialize it yet — a real gap, not an
 * oversight here. Rendered as an honest "not reported" rather than
 * substituting `last_seen_at` (a different fact) or inventing a value; see
 * this card's delivery comment for the exact ask to close it.
 */
function LinkedAt({ host }) {
  if (typeof host.created_at !== 'number') {
    return (
      <span className="text-[11px] text-[var(--color-text-muted)]" title="This endpoint does not report when this link was created yet.">
        not reported
      </span>
    );
  }
  return <span className="text-[11px] text-[var(--color-text-secondary)]">{relativeSeen(host.created_at)}</span>;
}

/** The first workspace on this link the self-update path can actually
 *  dispatch through. `workspaces.py:531-532` 400s any workspace whose
 *  `placement_driver` isn't `remote-host` — gating on mere workspace
 *  presence would put a button on screen that always fails. */
function updateTargetWorkspace(host) {
  return (host.workspaces || []).find((w) => w.placement_driver === 'remote-host') || null;
}

/**
 * The per-row Update affordance, rendered under the version string in the
 * existing Agent cell — never a new column. Four states, and states 1 and 4
 * deliberately render no button: a verdict is never fabricated, and a
 * button that would always 400 is worse than no button.
 */
function AgentUpdateButton({ host, latest, updating, onUpdate }) {
  const current = host.cli_version || null;
  if (!latest || !current) return null;

  if (current === latest) {
    return (
      <button
        type="button"
        disabled
        className="mt-1 px-2 py-1 text-[11px] rounded bg-white/5 text-[var(--color-text-muted)] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        Up to date
      </button>
    );
  }

  const target = updateTargetWorkspace(host);
  if (!target) {
    return (
      <span
        className="mt-1 inline-block text-[10px] text-[var(--color-text-muted)]"
        title="This host has no BYOD workspace to dispatch the update through, so it cannot be updated from here."
      >
        outdated
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onUpdate(host, target.slug)}
      disabled={updating}
      title={updating ? 'This can take several minutes while the host installs the new binary and reconnects.' : undefined}
      className="mt-1 px-2 py-1 text-[11px] rounded bg-sky-500/20 hover:bg-sky-500/35 text-sky-200 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {updating ? 'Updating…' : `Update to ${latest}`}
    </button>
  );
}

const GRID_COLS = 'lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_4.5rem_minmax(0,1.1fr)_minmax(0,1.2fr)_6.5rem_5.5rem_5.5rem_5.5rem_4.5rem]';

function TableHeader() {
  return (
    <div className={`hidden lg:grid ${GRID_COLS} gap-x-3 px-0.5 pb-1.5 mb-1 border-b border-[var(--color-border)] text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]`}>
      <div>Friendly name</div>
      <div>Hostname</div>
      <div>OS</div>
      <div>Public IP</div>
      <div>Workspaces</div>
      <div>Exit gate</div>
      <div>State</div>
      <div>Agent</div>
      <div>Linked</div>
      <div />
    </div>
  );
}

function FieldLabel({ children }) {
  return <div className="lg:hidden text-[9px] uppercase tracking-wide text-[var(--color-text-muted)]">{children}</div>;
}

function HostRow({
  host, mesh, publicIp, draftName, dirty, error, onNameChange, onDelete, deleting,
  latest, updating, onUpdate,
}) {
  return (
    <div className={`grid grid-cols-1 ${GRID_COLS} gap-x-3 gap-y-2 lg:gap-y-1 items-start py-3 border-b border-[var(--color-border)] last:border-b-0`}>
      <div className="min-w-0">
        <FieldLabel>Friendly name</FieldLabel>
        <input
          type="text"
          value={draftName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={host.hostname || host.id}
          maxLength={64}
          aria-label={`Friendly name for ${host.hostname || host.id}`}
          className={`w-full bg-[var(--color-bg-secondary)] text-[12px] text-[var(--color-text-primary)] border rounded px-2 py-1 outline-none focus:border-[var(--color-accent)] ${
            dirty ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
          }`}
        />
        {error && <div className="text-[10px] text-[var(--color-danger)] mt-0.5 break-all">{error}</div>}
      </div>

      <div className="min-w-0">
        <FieldLabel>Hostname</FieldLabel>
        <div className="text-[12px] text-[var(--color-text-primary)] break-all">{host.hostname || '(no hostname)'}</div>
        <div className="text-[10px] text-[var(--color-text-muted)] break-all">link <code className="font-mono">{host.id}</code></div>
      </div>

      <div className="min-w-0">
        <FieldLabel>OS</FieldLabel>
        <div className="text-[12px] text-[var(--color-text-secondary)] break-all">
          {host.os || '?'}{host.arch ? `/${host.arch}` : ''}
        </div>
        {host.elevated === true && (
          <Pill tone="warn" title="aw-remote-host is running as root on this host">
            [{host.os === 'windows' ? 'admin' : 'root'}]
          </Pill>
        )}
      </div>

      <div className="min-w-0">
        <FieldLabel>Public IP</FieldLabel>
        <HostPublicIp state={publicIp} />
      </div>

      <div className="min-w-0">
        <FieldLabel>Workspaces</FieldLabel>
        <WorkspacesCell workspaces={host.workspaces} />
      </div>

      <div className="min-w-0">
        <FieldLabel>Exit gate</FieldLabel>
        <ExitGateCell mesh={mesh} hostId={host.id} />
      </div>

      <div className="min-w-0">
        <FieldLabel>State</FieldLabel>
        <StateCell host={host} />
      </div>

      <div className="min-w-0">
        <FieldLabel>Agent</FieldLabel>
        <span className="text-[11px] text-[var(--color-text-secondary)] font-mono">{host.cli_version || '—'}</span>
        <div>
          <AgentUpdateButton host={host} latest={latest} updating={updating} onUpdate={onUpdate} />
        </div>
      </div>

      <div className="min-w-0">
        <FieldLabel>Linked</FieldLabel>
        <LinkedAt host={host} />
      </div>

      <div className="min-w-0">
        <FieldLabel>Delete</FieldLabel>
        {/* window.confirm() depends on this component being a plain React
            mount, never an iframe — see the Architect's decision on card
            feature:remote-hosts-delete-single-link. If Settings NEW is ever
            embedded, this goes silently dead. */}
        <button
          type="button"
          onClick={() => onDelete(host)}
          disabled={deleting}
          aria-label={`Delete link to ${host.hostname || host.id}`}
          className="px-2 py-1 text-[11px] rounded bg-red-500/15 hover:bg-red-500/25 text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

function InstallBlock({ entry }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-medium text-[var(--color-text-primary)]">{entry.title}</span>
        {entry.unverified && <Pill tone="warn">unverified</Pill>}
      </div>
      {entry.commands.map((cmd) => <CommandBlock key={cmd} command={cmd} />)}
      <div className="text-[11px] text-[var(--color-text-muted)] mt-1">{entry.persistence}</div>
    </div>
  );
}

/**
 * The linking step — the part people get wrong, made the loudest thing on
 * the screen (a whole labelled block below install, not folded into it).
 * MINTED ON A PRESS, NEVER ON A RENDER: no token exists until this button is
 * pressed, same discipline Networking's `JoinCommandSection` keeps.
 */
function LinkStep({ slug }) {
  const [minted, setMinted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setMinted(await mintBootstrapToken(slug));
    } catch (e) {
      setMinted(null);
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }, [slug]);

  const command = linkCommand(minted?.token);

  return (
    <div className="rounded border-2 border-amber-500/40 bg-amber-500/[0.06] p-3">
      <div className="text-[12px] font-semibold text-amber-300">Step 2 — link it to this workspace</div>
      <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
        Installing the binary is not linking it. Run this after install, on the same machine.
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="px-2 py-1 text-[11px] rounded bg-sky-500/20 hover:bg-sky-500/35 text-sky-200 disabled:opacity-40"
        >
          {busy ? 'Generating…' : minted ? 'Regenerate link command' : 'Generate link command'}
        </button>
        {minted && <Pill tone="warn">single use</Pill>}
      </div>
      {command ? (
        <CommandBlock command={command} />
      ) : (
        <div className="text-[11px] text-[var(--color-text-muted)] mt-2">
          The link command carries a live token, so it is minted only when you ask for it.
        </div>
      )}
      {error && <div className="text-[11px] text-[var(--color-danger)] break-all mt-1">{error}</div>}
    </div>
  );
}

export default function RemoteHostsTab({ onNavigateToNetworking }) {
  const [slug, setSlug] = useState(null);
  const [hosts, setHosts] = useState(null);
  const [mesh, setMesh] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [hostIps, setHostIps] = useState({});

  // Last-fetched server state, keyed by host id — the baseline `dirty` is
  // computed against. `draft` holds only what the user has actually
  // changed; a value equal to the server's is not dirty even if the field
  // was touched.
  const [serverRows, setServerRows] = useState({});
  const [draft, setDraft] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deletingIds, setDeletingIds] = useState({});
  const [latestVersion, setLatestVersion] = useState(null);
  const [updatingIds, setUpdatingIds] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  useEffect(() => {
    let alive = true;
    currentWorkspaceSlug()
      .then((s) => {
        if (alive) setSlug(s);
        return Promise.all([fetchRemoteHosts(s), fetchMeshStatus(s), fetchRemoteHostLatestVersion(s)]);
      })
      .then(([h, m, latest]) => {
        if (!alive) return;
        setHosts(h);
        setMesh(m);
        setLatestVersion(latest);
        setServerRows(Object.fromEntries(h.map((row) => [row.id, { friendlyName: row.friendly_name || null }])));
      })
      .catch((e) => { if (alive) setError(String(e.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadToken]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadToken((t) => t + 1);
  }, []);

  /**
   * Manual refresh — deliberately NOT routed through `retry`/`reloadToken`:
   * those flip `loading` back to true, which hides the whole table while
   * the mount effect re-runs. A press here must re-fetch without blanking
   * what's already on screen or the honesty bar this screen holds
   * everywhere else ("don't show stale data with no indication it might be
   * stale") would be failed by the refresh button itself. Calls the exact
   * same three fetches the mount effect calls, in the same order; setting
   * `hosts` to a new array reference also re-fires the per-host public-IP
   * effect below, so that data refreshes as part of the same press.
   */
  const refresh = useCallback(async () => {
    if (!slug || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const [h, m, latest] = await Promise.all([
        fetchRemoteHosts(slug),
        fetchMeshStatus(slug),
        fetchRemoteHostLatestVersion(slug),
      ]);
      setHosts(h);
      setMesh(m);
      setLatestVersion(latest);
      setServerRows(Object.fromEntries(h.map((row) => [row.id, { friendlyName: row.friendly_name || null }])));
    } catch (e) {
      setRefreshError(String(e.message || e));
    } finally {
      setRefreshing(false);
    }
  }, [slug, refreshing]);

  // Per-host public IP, one measurement per CONNECTED host — mirrors
  // Networking's own effect verbatim: offline hosts are never asked (their
  // state is already known), and each host resolves independently so one
  // slow host never holds up the row next to it.
  useEffect(() => {
    if (!slug || !hosts) return undefined;
    let alive = true;
    for (const h of hosts) {
      if (!h.connected) continue;
      fetchHostPublicIp(slug, h.id).then((res) => {
        if (!alive) return;
        setHostIps((prev) => ({ ...prev, [h.id]: { status: 'measured', ...res } }));
      });
    }
    return () => { alive = false; };
  }, [hosts, slug]);

  const hostPublicIpState = useCallback(
    (host) => (host.connected ? (hostIps[host.id] || { status: 'loading' }) : { status: 'offline' }),
    [hostIps],
  );

  const setDraftName = useCallback((hostId, value) => {
    setDraft((prev) => ({ ...prev, [hostId]: { ...prev[hostId], friendlyName: value } }));
  }, []);

  const rowDirty = useCallback(
    (hostId) => {
      const d = draft[hostId];
      if (!d) return false;
      const server = serverRows[hostId] || {};
      return Object.entries(d).some(([key, val]) => (val || null) !== (server[key] || null));
    },
    [draft, serverRows],
  );

  const dirtyHostIds = useMemo(() => Object.keys(draft).filter(rowDirty), [draft, rowDirty]);
  const isDirty = dirtyHostIds.length > 0;

  const save = useCallback(async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    const failures = {};
    const succeeded = [];
    for (const hostId of dirtyHostIds) {
      try {
        // Sequential, not Promise.all: a refetch right after must not race
        // a PATCH that is still writing.
        await renameRemoteHost(slug, hostId, draft[hostId].friendlyName);
        succeeded.push(hostId);
      } catch (e) {
        failures[hostId] = String(e.message || e);
      }
    }
    setRowErrors(failures);
    try {
      const fresh = await fetchRemoteHosts(slug);
      setHosts(fresh);
      setServerRows(Object.fromEntries(fresh.map((row) => [row.id, { friendlyName: row.friendly_name || null }])));
    } catch {
      // The saves themselves already ran; a refetch failure here just means
      // the table won't reflect them until Retry — not a lost edit.
    }
    // Only drop drafts that actually saved — a failed row keeps its edit and
    // stays dirty so Save can be pressed again without retyping it.
    setDraft((prev) => {
      const next = { ...prev };
      for (const id of succeeded) delete next[id];
      return next;
    });
    setSaving(false);
  }, [isDirty, saving, dirtyHostIds, draft, slug]);

  // Not part of the dirty/Save batch above — a delete has no draft state,
  // and batching it in would let a Save press destroy a link staged
  // minutes earlier. It fires immediately once confirmed. Disabled while
  // in flight: a repeat delete 404s ("not found") for a delete that
  // actually already worked.
  const handleDelete = useCallback(async (host) => {
    if (deletingIds[host.id]) return;
    const label = host.friendly_name || host.hostname || host.id;
    const confirmed = window.confirm(
      `Delete the link to "${label}"? It will stop being linked to this account immediately. `
      + 'To use it again, you will need to re-run install and link on that machine.',
    );
    if (!confirmed) return;

    setDeletingIds((prev) => ({ ...prev, [host.id]: true }));
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[host.id];
      return next;
    });
    try {
      await deleteRemoteHost(slug, host.id);
      // No optimistic splice — the server-filtered list is the only source
      // of truth for what still exists.
      setReloadToken((t) => t + 1);
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [host.id]: String(e.message || e) }));
      setDeletingIds((prev) => {
        const next = { ...prev };
        delete next[host.id];
        return next;
      });
    }
  }, [deletingIds, slug]);

  // Per-row busy state keyed by host id, like `deletingIds` — never a single
  // shared flag, since one row's ~7-minute wait must not disable every other
  // row's Update button. The endpoint's own response carries no
  // `cli_version` (it returns the Workspace row, not the RemoteHost row), so
  // a successful update refetches the table exactly like `save()` does
  // rather than optimistically relabeling — the precise bug fixed on
  // 2026-07-30 (aw-console-update-finished-version-refresh).
  const handleUpdate = useCallback(async (host, targetSlug) => {
    if (updatingIds[host.id]) return;
    setUpdatingIds((prev) => ({ ...prev, [host.id]: true }));
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[host.id];
      return next;
    });
    try {
      await updateRemoteHostBinary(targetSlug);
      const fresh = await fetchRemoteHosts(slug);
      setHosts(fresh);
      setServerRows(Object.fromEntries(fresh.map((row) => [row.id, { friendlyName: row.friendly_name || null }])));
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [host.id]: String(e.message || e) }));
    } finally {
      setUpdatingIds((prev) => {
        const next = { ...prev };
        delete next[host.id];
        return next;
      });
    }
  }, [updatingIds, slug]);

  const installEntries = useMemo(() => remoteHostInstallInstructions(), []);

  return (
    // No max-w cap: GRID_COLS' `fr` columns are built to fill the pane, and
    // a leftover prose-width cap here left ~40% of a maximized window black
    // (measured live: 1024px used of 1694px available) while cramming this
    // 10-column table into it.
    <div>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Remote Hosts</h3>
      </div>

      <Section
        title="Linked hosts"
        action={(
          <div className="flex items-center gap-2">
            {refreshError && (
              <span
                className="text-[11px] text-[var(--color-danger)]"
                title={refreshError}
              >
                Refresh failed
              </span>
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={loading || !!error || refreshing}
              className="shrink-0 px-3 py-1 text-[12px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!isDirty || saving}
              className="px-3 py-1 text-[12px] rounded bg-[var(--color-accent)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      >
        {loading && <div className="text-[12px] text-[var(--color-text-muted)]">Loading hosts…</div>}

        {error && (
          <div className="px-3 py-2 rounded bg-[var(--color-danger)]/10 text-[12px] text-[var(--color-danger)]">
            <div className="font-medium">Could not list the hosts.</div>
            <div className="mt-0.5 text-[11px] opacity-80 break-all">{error}</div>
            <button
              type="button"
              onClick={retry}
              className="mt-2 px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)]"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {!mesh?.available && (
              <div className="mb-3 px-3 py-2 rounded bg-amber-500/10 text-[11px] text-amber-300">
                <span className="font-medium">Mesh status unavailable. </span>
                {mesh?.reason} The exit-gate column below reads as unknown until it recovers.
              </div>
            )}

            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {(hosts || []).length} link{(hosts || []).length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={onNavigateToNetworking}
                className="text-[11px] text-[var(--color-accent)] hover:underline"
              >
                Manage exit gates in Networking →
              </button>
            </div>

            {(hosts || []).length === 0 ? (
              <div className="text-[12px] text-[var(--color-text-muted)]">
                No host is linked to this account yet — install and link one below.
              </div>
            ) : (
              <>
                <TableHeader />
                {hosts.map((h) => (
                  <HostRow
                    key={h.id}
                    host={h}
                    mesh={mesh}
                    publicIp={hostPublicIpState(h)}
                    draftName={draft[h.id]?.friendlyName ?? serverRows[h.id]?.friendlyName ?? ''}
                    dirty={rowDirty(h.id)}
                    error={rowErrors[h.id]}
                    onNameChange={(v) => setDraftName(h.id, v)}
                    onDelete={handleDelete}
                    deleting={!!deletingIds[h.id]}
                    latest={latestVersion}
                    updating={!!updatingIds[h.id]}
                    onUpdate={handleUpdate}
                  />
                ))}
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Add a new host" description="Two steps — installing the binary is not the same as linking it.">
        <div className="text-[12px] font-medium text-[var(--color-text-primary)] mb-1">Step 1 — install</div>
        {installEntries.map((entry) => <InstallBlock key={entry.id} entry={entry} />)}
        <div className="mt-3">
          <LinkStep slug={slug} />
        </div>
      </Section>
    </div>
  );
}

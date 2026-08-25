import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  bootstrapEligibility,
  fetchMeshStatus,
  fetchRemoteHosts,
  installInstructions,
  resolveAccountSlug,
  CONTROL_PLANE_PLACEHOLDER,
} from '../lib/networkingApi';

// ─────────────────────────────────────────────────────────────────────────────
// Settings → General → Networking
//
// The tenant's private mesh: every aw-remote-host linked to this account,
// whether each one is on the mesh, at which IP, and whether the path to it is
// direct or relayed — the last of which is measured by a `tailscale ping` on
// the host, because `tailscale status` cannot tell an idle direct peer from a
// relayed one.
//
// Two rules this screen exists to keep, both from the same doctrine — a screen
// that quietly shows less than the truth is worse than one that shows nothing:
//
//   1. Every disabled bootstrap button carries a WRITTEN reason. A greyed
//      control with no sentence next to it reads as a bug, not as a decision.
//   2. Nothing is invented. A host that reported nothing says "no agent data"
//      and carries the reason — never a made-up "disconnected", never a
//      plausible-looking 100.64.x.x. See MeshState: the three cases it keeps
//      apart are the whole point of the cell.
//
// The host rows are per LINK, not per machine: a re-link leaves the old row
// behind (the Surface carries four, two offline) and one machine can hold both
// a Windows and a WSL2 link. Offline links are folded into a collapsed group so
// they neither disappear nor drown the live ones.
// ─────────────────────────────────────────────────────────────────────────────

function Pill({ tone = 'muted', children, title }) {
  const tones = {
    muted: 'bg-white/5 text-[var(--color-text-muted)]',
    ok: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    err: 'bg-red-500/15 text-red-300',
    info: 'bg-sky-500/15 text-sky-300',
  };
  return (
    <span title={title} className={`inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Section({ title, description, children }) {
  return (
    <div className="mb-4 border border-[var(--color-border)] rounded overflow-hidden">
      <div className="px-4 py-2.5 bg-[var(--color-bg-header)]">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</div>
        {description && (
          <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{description}</div>
        )}
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

/** Mesh cell — the honest-unknown lives here, and it has THREE cases that a
 *  careless reading would collapse into two:
 *
 *    1. nothing was learned about this host — it is offline, it timed out, or
 *       its agent is too old for the verb. UNKNOWN. Never "disconnected", and
 *       never an address: the backend refuses to guess one (it often could,
 *       from another host's peer list) and so must this.
 *    2. the host ANSWERED, and said it is not on the mesh. That is a fact,
 *       with the agent's own reason attached.
 *    3. the host is on the mesh, with a measured path.
 *
 *  `mesh.available === false` is case 1 for every host at once: the endpoint
 *  itself did not answer. */
function MeshState({ mesh, hostId }) {
  const node = mesh?.available ? mesh.nodes?.[hostId] : null;
  const unknownReason = !mesh?.available
    ? mesh?.reason
    : (!node ? 'this host is not in the mesh-status response' : node.reason);

  if (!node || node.reported === false) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone="muted" title={unknownReason}>no agent data</Pill>
        <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
          {unknownReason || 'mesh state unknown'}
        </span>
      </div>
    );
  }

  if (!node.up) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone="warn">not on the mesh</Pill>
        <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
          {node.reason || 'this host reported that it is not up on the mesh'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Pill tone="ok">on the mesh</Pill>
      {node.meshIp && (
        <code className="text-[11px] font-mono text-[var(--color-text-secondary)]">{node.meshIp}</code>
      )}
      {node.nodeName && (
        <span className="text-[11px] text-[var(--color-text-muted)]">as {node.nodeName}</span>
      )}
      {node.path ? (
        <Pill
          tone={node.path === 'direct' ? 'ok' : 'info'}
          title={node.path === 'relay'
            ? 'Traffic goes through a DERP relay instead of a direct connection — it works, but with a hop in between.'
            : 'Direct connection between the two hosts, no relay.'}
        >
          {node.path}
        </Pill>
      ) : (
        // On the mesh, but nobody else measured the path to it — a one-node
        // mesh, or the only other reporter is this host itself. Saying
        // "direct" here would be a coin flip presented as a fact.
        <Pill tone="muted" title="No other host reported a path to this one, so it was never measured.">
          path unmeasured
        </Pill>
      )}
      {node.via && (
        <span className="text-[11px] text-[var(--color-text-muted)]">via {node.via}</span>
      )}
      {node.exitNode && (
        <Pill tone="warn" title="This host's default route goes out through another node on the mesh.">
          exits via {node.exitNode}
        </Pill>
      )}
    </div>
  );
}

function HostRow({ host, mesh }) {
  const eligibility = bootstrapEligibility(host);
  const tone = { yes: 'ok', no: 'err', unknown: 'warn' }[eligibility.state] || 'muted';

  return (
    <div className="py-3 border-b border-[var(--color-border)] last:border-b-0">
      {/* Identity line — wraps on a narrow viewport instead of overflowing. */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-[var(--color-text-primary)] break-all">
              {host.hostname || '(no hostname)'}
            </span>
            <Pill tone={host.connected ? 'ok' : 'muted'}>
              {host.connected ? 'connected' : 'offline'}
            </Pill>
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5 break-all">
            {host.workspace_slug} · {host.os || 'os?'}/{host.arch || 'arch?'} · link{' '}
            <code className="font-mono">{host.id}</code> · seen {relativeSeen(host.last_seen_at)}
          </div>
        </div>

        {/* Remote bootstrap — still a PLACEHOLDER. The enrolment module itself
            shipped, but driving it remotely from here is a separate card and
            nothing behind this button exists. Disabled for every host, and the
            label says "not built yet" rather than naming an action, so a
            disabled control is never read as one that merely failed. */}
        <button
          type="button"
          disabled
          title={eligibility.state === 'no'
            ? `Unavailable: ${eligibility.reason}`
            : 'Enrolling a host from this screen is not implemented yet — today it is `aw-remote-host vpn` run on the machine itself.'}
          className="shrink-0 px-3 py-1 text-[12px] rounded bg-white/5 text-[var(--color-text-muted)] opacity-50 cursor-not-allowed"
        >
          Join mesh — not built yet
        </button>
      </div>

      <div className="mt-2 grid gap-1.5">
        <MeshState mesh={mesh} hostId={host.id} />
        {/* The ineligibility reason as TEXT, always — not only in the button's
            title, which is invisible on touch. */}
        <div className="flex items-start gap-2 flex-wrap">
          <Pill tone={tone}>{eligibility.label}</Pill>
          <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
            {eligibility.reason}
          </span>
        </div>
      </div>
    </div>
  );
}

function CommandBlock({ commands }) {
  return (
    <pre className="mt-1 p-2 rounded bg-black/30 text-[11px] font-mono text-[var(--color-text-secondary)] overflow-x-auto whitespace-pre">
      {commands.join('\n')}
    </pre>
  );
}

export default function NetworkingTab() {
  const [hosts, setHosts] = useState(null);
  const [mesh, setMesh] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOffline, setShowOffline] = useState(false);
  // Bumped by Retry. The reset to loading/no-error happens in the handler, not
  // in the effect body — a synchronous setState there cascades a second render
  // on every mount (react-hooks/set-state-in-effect).
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    // The slug is resolved once and handed to both calls: each would otherwise
    // look it up itself, doubling the identity round-trip for one screen.
    resolveAccountSlug()
      .then((slug) => Promise.all([fetchRemoteHosts(slug), fetchMeshStatus(slug)]))
      .then(([h, m]) => { if (alive) { setHosts(h); setMesh(m); } })
      .catch((e) => { if (alive) setError(String(e.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadToken]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadToken((t) => t + 1);
  }, []);

  const { online, offline } = useMemo(() => {
    const rows = hosts || [];
    return {
      online: rows.filter((h) => h.connected),
      offline: rows.filter((h) => !h.connected),
    };
  }, [hosts]);

  const controlPlane = mesh?.available ? mesh.controlPlaneUrl : null;

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Networking</h3>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
          This tenant&apos;s private mesh: the account&apos;s workspaces and aw-remote-hosts,
          their tailscale state, and the path to each peer.
        </p>
      </div>

      <Section
        title="Control plane"
        description="This tenant's headscale. It is per-tenant — two tenants never share a control plane, which is why it is never hardcoded."
      >
        {controlPlane ? (
          <code className="text-[12px] font-mono text-[var(--color-text-secondary)] break-all">{controlPlane}</code>
        ) : (
          <div className="flex items-start gap-2 flex-wrap">
            <Pill tone="warn">unpublished</Pill>
            <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
              No API publishes this tenant&apos;s control plane yet. The commands below show{' '}
              <code className="font-mono">{CONTROL_PLANE_PLACEHOLDER}</code> instead of a URL —
              copying another tenant&apos;s would not work.
            </span>
          </div>
        )}
      </Section>

      <Section
        title="Account hosts"
        description="One row per LINK, not per machine: re-linking leaves the previous one behind, and the same machine can hold more than one link."
      >
        {loading && (
          <div className="text-[12px] text-[var(--color-text-muted)]">Loading hosts…</div>
        )}

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
            {/* Mesh state once, at the top — repeating it on every row would be
                noise; each row only says what it knows about that host. */}
            {!mesh?.available && (
              <div className="mb-3 px-3 py-2 rounded bg-amber-500/10 text-[11px] text-amber-300">
                <span className="font-medium">Tailscale state unavailable. </span>
                {mesh?.reason}
              </div>
            )}

            {online.length === 0 && (
              <div className="text-[12px] text-[var(--color-text-muted)]">
                No host is connected right now.
              </div>
            )}

            {online.map((h) => <HostRow key={h.id} host={h} mesh={mesh} />)}

            {offline.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                <button
                  type="button"
                  onClick={() => setShowOffline((v) => !v)}
                  className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  {showOffline ? '▼' : '▶'} Offline links ({offline.length})
                </button>
                {showOffline && (
                  <div className="mt-1 opacity-70">
                    {offline.map((h) => <HostRow key={h.id} host={h} mesh={mesh} />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Section>

      <Section
        title="direct vs relay"
        description="Why this column exists."
      >
        <p className="text-[11px] text-[var(--color-text-muted)]">
          A relay is not a rare fallback: two machines on the same home network can still
          talk through a DERP when one of them sits behind another layer of NAT. Without
          this written down, &quot;it works, but it goes through Madrid&quot; is invisible.
        </p>
      </Section>

      <Section
        title="Install tailscale"
        description="Per operating system. The macOS path is genuinely different — the Linux installer does not work there."
      >
        {installInstructions(controlPlane).map((entry) => (
          <div key={entry.id} className="mb-3 last:mb-0">
            <div className="text-[12px] font-medium text-[var(--color-text-primary)]">{entry.title}</div>
            {entry.note && (
              <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{entry.note}</div>
            )}
            <CommandBlock commands={entry.commands} />
          </div>
        ))}
      </Section>
    </div>
  );
}

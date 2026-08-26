import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyExitGate,
  bootstrapEligibility,
  clearExitGate,
  exitGateCandidates,
  exitOfferState,
  fetchMeshStatus,
  fetchPublicIp,
  fetchRemoteHosts,
  installInstructions,
  offerExitGate,
  resolveAccountSlug,
  withdrawExitGate,
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

/**
 * The public egress IP, at the top of the screen.
 *
 * WHOSE address it is, is rendered next to it and is not optional. This is one
 * machine's egress — the workspace's own host — and an unlabelled number would
 * repeat, in the most prominent place on the screen, the exact mistake the
 * rest of it is built to avoid. The backend names the host for precisely this.
 *
 * A measurement that failed shows "not known" and the reason, never a
 * remembered address. Somebody reads this number right after flipping a route
 * to find out whether it worked; a stale one would answer that wrongly and
 * confidently.
 */
function PublicIpBanner({ egress, loading, onRefresh }) {
  return (
    <Section
      title="Public IP"
      description="The address this workspace's own host leaves the internet from. Measured live on every load — never cached, because the whole point is to watch it change."
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {loading ? (
            <div className="text-[12px] text-[var(--color-text-muted)]">Measuring…</div>
          ) : egress?.ip ? (
            <>
              <code className="text-[18px] font-mono text-[var(--color-text-primary)] break-all">
                {egress.ip}
              </code>
              {/* The label. Never a bare number.
                  The host name is a TEXT NODE here, deliberately not its own
                  <span>: a bare element whose whole content is a hostname
                  would collide with the host row that legitimately renders
                  the same string, and every getByText for that row would
                  start matching two elements. */}
              <div className="text-[11px] text-[var(--color-text-muted)] mt-1 break-all">
                measured on {egress.hostName || 'this workspace’s host'}
                {egress.via && <> · via <code className="font-mono">{egress.via}</code></>}
              </div>
            </>
          ) : (
            <div className="flex items-start gap-2 flex-wrap">
              <Pill tone="warn">not known</Pill>
              <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
                {egress?.error || 'This host’s public IP could not be measured.'}
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="shrink-0 px-3 py-1 text-[12px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Measuring…' : 'Re-measure'}
        </button>
      </div>
    </Section>
  );
}

/**
 * Before/after, which is the entire value of the feature: the point is to
 * WATCH the address change.
 *
 * A missing address renders as "not measured", never as a repeat of the other
 * one. `applyExitGate` deliberately leaves those fields null when nothing came
 * back, and filling the gap here with the value we do have would manufacture
 * the very evidence the user is reading this to check.
 */
function EgressAddr({ value }) {
  return value
    ? <code className="font-mono text-[var(--color-text-primary)]">{value}</code>
    : <span className="text-[var(--color-text-muted)] italic">not measured</span>;
}

function EgressDelta({ before, after }) {
  return (
    <div className="text-[11px] flex items-center gap-2 flex-wrap">
      <span className="text-[var(--color-text-muted)]">before</span>
      <EgressAddr value={before} />
      <span className="text-[var(--color-text-muted)]">→ after</span>
      <EgressAddr value={after} />
    </div>
  );
}

/**
 * The exit-gate control for one host.
 *
 * The confirmation step is not ceremony. Moving a default route can take a
 * machine off the internet, and although the host arms a dead-man's switch
 * before it touches anything (aw-remote-host `internal/vpn/usexit.go`), a user
 * who did not know that was going to happen is the one failure mode none of
 * those layers can cover. So: pick a gate, see what it would actually do
 * — the exclusions come back from a real `plan` call against the machine
 * itself, not from a sentence written here — then confirm.
 *
 * Only gates that ADVERTISE AND ARE APPROVED are ever listed; see
 * `exitGateCandidates`.
 */
/**
 * Offering THIS host as a gate — the other end of picking one.
 *
 * Until this existed the mesh had exactly one gate, because it was the only
 * node a human had ever approved by hand with `headscale nodes approve-routes`
 * on the metal. The picker below was right to list nothing else; what was
 * missing was any way to create a second one.
 *
 * Two halves live behind the single button — the host advertises, the control
 * plane approves — and the backend withdraws the first if the second fails,
 * because a node that advertises a route nobody approved looks armed and
 * forwards nothing. The `pending` state names that condition when something
 * else leaves it behind.
 *
 * Ineligibility is never a bare greyed control: `exitOfferState` always
 * carries the host's own sentence. Windows link `c76c606b…` is the example
 * that matters — the same physical machine as the WSL2 one, with no tailscale
 * at all, which is a legitimate "no" with a real reason rather than a bug.
 */
function ExitOfferControl({ host, mesh, slug, onChanged }) {
  const node = mesh?.available ? mesh.nodes?.[host.id] : null;
  const verdict = exitOfferState(node);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ack, setAck] = useState(false);
  const [result, setResult] = useState(null);

  const offer = useCallback(async () => {
    setError(''); setResult(null); setBusy('offer');
    try {
      setResult(await offerExitGate(slug, host.id, { acknowledgeWarning: true }));
      onChanged?.();
    } catch (e) {
      setError(String(e.message || e));
    } finally { setBusy(''); }
  }, [slug, host.id, onChanged]);

  const withdraw = useCallback(async () => {
    setError(''); setResult(null); setBusy('withdraw'); setAck(false);
    try {
      const res = await withdrawExitGate(slug, host.id);
      setResult({ offering: false, reason: res.approvalError || '' });
      onChanged?.();
    } catch (e) {
      setError(String(e.message || e));
    } finally { setBusy(''); }
  }, [slug, host.id, onChanged]);

  if (verdict.state === 'unknown' && !node?.up) return null;

  const tone = { offering: 'ok', pending: 'warn', yes: 'info', no: 'err', unknown: 'muted' }[verdict.state];
  // A warning has to be READ before it can be agreed to, so the button that
  // acts is gated behind the one that shows it. Nothing on this screen may
  // change a route — or offer somebody else's — on a single click.
  const needsAck = !!verdict.warning && verdict.state !== 'offering' && !ack;

  return (
    <div className="mt-1 p-2 rounded bg-white/[0.03] grid gap-2">
      <div className="flex items-start gap-2 flex-wrap">
        <Pill tone={tone}>{verdict.label}</Pill>
        <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
          {verdict.reason}
        </span>
        {verdict.state === 'offering' ? (
          <button
            type="button"
            disabled={!!busy}
            onClick={withdraw}
            className="px-2 py-1 text-[11px] rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === 'withdraw' ? 'Withdrawing…' : 'Stop offering'}
          </button>
        ) : (verdict.state === 'yes' || verdict.state === 'pending') && (
          <button
            type="button"
            disabled={!!busy}
            onClick={needsAck ? () => setAck(true) : offer}
            className="px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === 'offer' ? 'Offering…' : needsAck ? 'Offer as exit gate…' : 'Offer as exit gate'}
          </button>
        )}
      </div>

      {/* The consequence, in the host's own words, before anything is done. */}
      {verdict.warning && ack && verdict.state !== 'offering' && (
        <div className="p-2 rounded bg-amber-500/10 grid gap-1.5">
          <div className="text-[11px] text-amber-300 font-medium">
            This host can forward, but choosing it has a cost:
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)]">{verdict.warning}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={offer}
              className="px-2 py-1 text-[11px] rounded bg-amber-500/25 hover:bg-amber-500/40 text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'offer' ? 'Offering…' : 'Offer anyway'}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setAck(false)}
              className="px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="grid gap-1">
          <Pill tone={result.offering ? 'ok' : 'warn'}>
            {result.offering ? 'now offering as an exit gate' : 'not offering'}
          </Pill>
          {result.reason && (
            <span className="text-[11px] text-[var(--color-text-muted)]">{result.reason}</span>
          )}
          {/* Offering is not using. Reported from the host's own measurement,
              because the invariant is worth catching if it ever breaks. */}
          {result.defaultRouteUnchanged === false && (
            <span className="text-[11px] text-[var(--color-danger)]">
              This host&apos;s own default route CHANGED while it was only being asked to advertise
              ({result.defaultRouteBefore} → {result.defaultRouteAfter}). Advertising must never do
              that — treat this as a bug.
            </span>
          )}
        </div>
      )}

      {error && <div className="text-[11px] text-[var(--color-danger)] break-all">{error}</div>}
    </div>
  );
}

function ExitGateControl({ host, mesh, hosts, slug, onChanged }) {
  const node = mesh?.available ? mesh.nodes?.[host.id] : null;
  const candidates = useMemo(
    () => exitGateCandidates(hosts, mesh, host.id),
    [hosts, mesh, host.id],
  );
  const [choice, setChoice] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const inForce = node?.exitNode || null;
  // The warnings belong to the gate being CHOSEN, not to this host, so they
  // are read off the selected candidate rather than off `node`.
  const chosenWarnings = useMemo(
    () => candidates.find((c) => c.name === choice)?.warnings || [],
    [candidates, choice],
  );

  const preview = useCallback(async () => {
    setError(''); setResult(null); setBusy('plan');
    try {
      setPlan(await applyExitGate(slug, host.id, { node: choice, plan: true }));
    } catch (e) {
      setError(String(e.message || e));
    } finally { setBusy(''); }
  }, [slug, host.id, choice]);

  const confirm = useCallback(async () => {
    setError(''); setBusy('apply');
    try {
      const res = await applyExitGate(slug, host.id, { node: choice });
      setResult(res); setPlan(null);
      onChanged?.();
    } catch (e) {
      setError(String(e.message || e));
    } finally { setBusy(''); }
  }, [slug, host.id, choice, onChanged]);

  const clear = useCallback(async () => {
    setError(''); setBusy('clear'); setPlan(null);
    try {
      const res = await clearExitGate(slug, host.id);
      setResult({ cleared: true, egressAfter: res.egress, egressError: res.egressError });
      onChanged?.();
    } catch (e) {
      setError(String(e.message || e));
    } finally { setBusy(''); }
  }, [slug, host.id, onChanged]);

  // Nothing to offer, and the reason is worth saying: a silent absence here
  // reads as a screen that forgot to render, and the fix ("approve the route
  // in headscale") lives somewhere the user would never think to look.
  if (!node?.reported || !node.up) return null;
  if (candidates.length === 0 && !inForce) {
    return (
      <div className="flex items-start gap-2 flex-wrap">
        <Pill tone="muted">no exit gate available</Pill>
        <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
          No other host on this mesh both advertises an exit route and has it approved in
          headscale, so there is nothing this host could route through. Use “Offer as exit gate”
          on the host you want to route through — that does both halves.
        </span>
      </div>
    );
  }

  return (
    <div className="mt-1 p-2 rounded bg-white/[0.03] grid gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-[var(--color-text-muted)]">Exit gate</span>
        <select
          aria-label={`Exit gate for ${host.hostname || host.id}`}
          value={choice}
          onChange={(e) => { setChoice(e.target.value); setPlan(null); setResult(null); setError(''); }}
          className="text-[12px] px-2 py-1 rounded bg-[var(--color-bg-header)] border border-[var(--color-border)] text-[var(--color-text-primary)]"
        >
          <option value="">— none —</option>
          {candidates.map((c) => (
            <option key={c.hostId} value={c.name}>
              {c.name}{c.meshIp ? ` (${c.meshIp})` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!choice || !!busy}
          onClick={preview}
          className="px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === 'plan' ? 'Checking…' : 'Review change'}
        </button>
        {inForce && (
          <button
            type="button"
            disabled={!!busy}
            onClick={clear}
            className="px-2 py-1 text-[11px] rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === 'clear' ? 'Clearing…' : `Clear (${inForce})`}
          </button>
        )}
      </div>

      {/* The confirmation. Everything in it was measured on the host by the
          plan call — the gate, the path to it, and every prefix that stays
          outside the tunnel. */}
      {plan && (
        <div className="p-2 rounded bg-amber-500/10 grid gap-1.5">
          <div className="text-[11px] text-amber-300 font-medium">
            This moves {host.hostname || 'this host'}&apos;s DEFAULT ROUTE — and every container on
            it — out through {plan.gate}{plan.gateIp ? ` (${plan.gateIp})` : ''}.
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)]">
            If the gate does not forward, the host reverts itself: a dead-man&apos;s switch is armed
            before anything changes, and the switch is only stood down once the real public IP has
            been re-measured through the new route.
          </div>
          {/* What choosing THIS gate costs, as opposed to whether it works.
              A gate can be perfectly functional and still a bad idea: the
              Surface forwards through a second layer of Windows NAT and
              cannot hole-punch, so everything would relay through a public
              DERP. The dead-man's switch above cannot catch that — it only
              knows whether traffic flows, not who it flows through — so this
              is the only place a user finds out, and it has to be before
              they confirm rather than after. */}
          {chosenWarnings.length > 0 && (
            <div className="pt-1 border-t border-amber-500/20">
              <div className="text-[11px] text-amber-300 font-medium">
                This gate works, and it costs you something:
              </div>
              <ul className="mt-0.5 grid gap-0.5">
                {chosenWarnings.map((w) => (
                  <li key={w} className="text-[11px] text-[var(--color-text-muted)]">{w}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.exclusions.length > 0 && (
            <div>
              <div className="text-[11px] text-[var(--color-text-muted)]">
                These stay OUTSIDE the tunnel, so the host stays manageable:
              </div>
              <ul className="mt-0.5">
                {plan.exclusions.map((e) => (
                  <li key={e.prefix} className="text-[11px] text-[var(--color-text-muted)]">
                    <code className="font-mono text-[var(--color-text-secondary)]">{e.prefix}</code> — {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!!busy}
              onClick={confirm}
              className="px-2 py-1 text-[11px] rounded bg-amber-500/25 hover:bg-amber-500/40 text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy === 'apply' ? 'Applying…' : `Apply ${plan.gate}`}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setPlan(null)}
              className="px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* The outcome. An unconfirmed gate is NOT an error — the host reverted
          itself and is fine — so it renders as its own state, with the two
          addresses that explain it. */}
      {result && (
        <div className="grid gap-1">
          {result.cleared ? (
            <>
              <Pill tone="ok">exit gate cleared</Pill>
              <EgressDelta before={null} after={result.egressAfter} />
              {result.egressError && (
                <span className="text-[11px] text-[var(--color-danger)]">{result.egressError}</span>
              )}
            </>
          ) : result.applied ? (
            <>
              <Pill tone="ok">exit gate in force — {result.gate}</Pill>
              <EgressDelta before={result.egressBefore} after={result.egressAfter} />
            </>
          ) : (
            <>
              <Pill tone="warn">{result.reverted ? 'not confirmed — reverted' : 'not applied'}</Pill>
              <EgressDelta before={result.egressBefore} after={result.egressAfter} />
              <span className="text-[11px] text-[var(--color-text-muted)]">
                {result.refusal || result.reason || result.error
                  || 'The host did not confirm the switch, so it put the route back.'}
              </span>
              {result.deadmanStillArmed && (
                <span className="text-[11px] text-amber-300">
                  A revert is still pending on the host — its dead-man&apos;s switch is armed and
                  will finish the job.
                </span>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="text-[11px] text-[var(--color-danger)] break-all">{error}</div>
      )}
    </div>
  );
}

function HostRow({ host, mesh, hosts, slug, onChanged }) {
  // The same mesh-status entry MeshState renders below: the agent reports
  // "am I on the mesh" and "could I be" in one payload, and the second half
  // is what keeps this row from saying "unconfirmed" about a fact the host
  // already answered.
  const node = mesh?.available ? mesh.nodes?.[host.id] : null;
  const eligibility = bootstrapEligibility(host, node);
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
        <ExitOfferControl host={host} mesh={mesh} slug={slug} onChanged={onChanged} />
        <ExitGateControl host={host} mesh={mesh} hosts={hosts} slug={slug} onChanged={onChanged} />
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
  const [slug, setSlug] = useState(null);
  const [egress, setEgress] = useState(null);
  const [egressLoading, setEgressLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOffline, setShowOffline] = useState(false);
  // Bumped by Retry. The reset to loading/no-error happens in the handler, not
  // in the effect body — a synchronous setState there cascades a second render
  // on every mount (react-hooks/set-state-in-effect).
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    // The slug is resolved once and handed to all three calls: each would
    // otherwise look it up itself, tripling the identity round-trip for one
    // screen.
    resolveAccountSlug()
      .then((s) => {
        if (alive) setSlug(s);
        return Promise.all([fetchRemoteHosts(s), fetchMeshStatus(s), fetchPublicIp(s)]);
      })
      .then(([h, m, e]) => { if (alive) { setHosts(h); setMesh(m); setEgress(e); } })
      .catch((e) => { if (alive) setError(String(e.message || e)); })
      .finally(() => { if (alive) { setLoading(false); setEgressLoading(false); } });
    return () => { alive = false; };
  }, [reloadToken]);

  const retry = useCallback(() => {
    setLoading(true);
    setEgressLoading(true);
    setError(null);
    setReloadToken((t) => t + 1);
  }, []);

  /** Re-measure the egress alone, without reloading the whole screen.
   *
   *  `setEgress(null)` FIRST is the load-bearing line: while a new
   *  measurement is in flight the old address must not stay on screen, or the
   *  moment right after a route change — the one moment anybody is looking —
   *  would show the pre-change IP as if it were the new one. Blank is honest;
   *  stale is not. */
  const remeasure = useCallback(async () => {
    setEgressLoading(true);
    setEgress(null);
    try {
      setEgress(await fetchPublicIp(slug));
    } finally {
      setEgressLoading(false);
    }
  }, [slug]);

  /** After a gate is applied or cleared: the egress is the whole point, and
   *  the mesh's `exit_node` needs re-reading so the Clear button appears (or
   *  goes away) without a manual reload. */
  const afterGateChange = useCallback(async () => {
    await remeasure();
    if (slug) setMesh(await fetchMeshStatus(slug));
  }, [remeasure, slug]);

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

      <PublicIpBanner egress={egress} loading={egressLoading} onRefresh={remeasure} />

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

            {online.map((h) => (
              <HostRow key={h.id} host={h} mesh={mesh} hosts={hosts} slug={slug} onChanged={afterGateChange} />
            ))}

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
                    {offline.map((h) => (
                      <HostRow key={h.id} host={h} mesh={mesh} hosts={hosts} slug={slug} onChanged={afterGateChange} />
                    ))}
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

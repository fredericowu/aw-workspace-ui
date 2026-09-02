import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  advertiseConflictWarning,
  applyExitGate,
  applyExternalRoute,
  bootstrapEligibility,
  clearExitGate,
  clearExternalRoute,
  exitGateCandidates,
  exitGateSelectRefusal,
  exitOfferState,
  externalTunnelCapableHosts,
  externalVpnEntries,
  externalVpnSetupCommands,
  currentWorkspaceSlug,
  fetchHostPublicIp,
  fetchMeshStatus,
  fetchPublicIp,
  fetchRemoteHosts,
  installInstructions,
  joinCommand,
  joinMesh,
  joinMeshAvailability,
  mintJoinKey,
  offerExitGate,
  withdrawExitGate,
  CONTROL_PLANE_PLACEHOLDER,
} from '../lib/networkingApi';

// Settings → General → Networking
//
// The tenant's private mesh: every aw-remote-host linked to this account,
// whether each one is on the mesh, at which IP, and whether the path to it
// is direct or relayed.
//
// Two rules this screen exists to keep, both from the same doctrine — a
// screen that quietly shows less than the truth is worse than one that
// shows nothing:
//
//   1. Every disabled bootstrap button carries a WRITTEN reason.
//   2. Nothing is invented. A host that reported nothing says "no agent
//      data" and carries the reason — never a made-up "disconnected", never
//      a plausible-looking 100.64.x.x. See MeshState for the three cases.
//
// Host rows are per LINK, not per machine — a re-link leaves the old row
// behind, and one machine can hold more than one link. Offline links are
// folded into a collapsed group so they neither disappear nor drown the
// live ones.

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

/**
 * A refusal or a warning, said as STATE first and prose second.
 *
 * Every sentence this screen refuses with is worth reading, and none of
 * them is worth reading all at once: with every host refused, the tab
 * rendered as an essay and the controls vanished inside it. So the words do
 * not change — only WHEN they arrive. The badge is the answer; "why?" is the
 * paragraph that was already written, one click away.
 *
 * One component rather than a toggle per call site: four ad-hoc `useState`s
 * drift apart in wording and in keyboard behaviour, and the rest of this tab
 * still has prose that should follow this pattern.
 *
 * `action` sits on the badge row, not below the paragraph — a control that
 * is still available while refused (Clear, above all) must not be something
 * the reader has to expand the explanation to find.
 */
function Disclosure({ tone = 'warn', badge, detail, action }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone={tone}>{badge}</Pill>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] underline decoration-dotted underline-offset-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          {open ? 'hide' : 'why?'}
        </button>
        {action}
      </div>
      {open && (
        <div className="text-[11px] text-[var(--color-text-muted)]">{detail}</div>
      )}
    </div>
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

/** Mesh cell — the honest-unknown lives here, and it has THREE cases a
 *  careless reading would collapse into two:
 *
 *    1. nothing was learned about this host — offline, timed out, or an
 *       agent too old for the verb. UNKNOWN. Never "disconnected", and
 *       never an address: the backend refuses to guess one and so must this.
 *    2. the host ANSWERED, and said it is not on the mesh — a fact, with
 *       the agent's own reason attached.
 *    3. the host is on the mesh, with a measured path.
 *
 *  `mesh.available === false` is case 1 for every host at once: the
 *  endpoint itself did not answer. */
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
 * WHOSE address it is renders next to it and is not optional — an
 * unlabelled number would repeat, in the most prominent place on the
 * screen, the exact mistake this screen is built to avoid.
 *
 * A measurement that failed shows "not known" and the reason, never a
 * remembered address — a stale one would answer "did it work" wrongly and
 * confidently.
 */
function PublicIpBanner({ egress, loading, onRefresh }) {
  return (
    <Section title="Public IP">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {loading ? (
            <div className="text-[12px] text-[var(--color-text-muted)]">Measuring…</div>
          ) : egress?.ip ? (
            <>
              <code className="text-[18px] font-mono text-[var(--color-text-primary)] break-all">
                {egress.ip}
              </code>
              {/* TEXT NODE, deliberately not its own <span>: an element whose
                  whole content is a hostname would collide with the host
                  row rendering the same string, and getByText would then
                  match two elements. */}
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
 * One host row's own public IP — the per-host counterpart to
 * `PublicIpBanner` above, same honesty contract, same THREE states this
 * screen already keeps apart everywhere else:
 *
 *   'loading' — a measurement is in flight for this row.
 *   'offline' — this host's link is down, so it was never even asked.
 *   'measured' — it answered, whether or not that answer carries an `ip`
 *                (a written `error` and no address is still a real result,
 *                never rendered as if nothing had been tried).
 *
 * `state` is `undefined` for one render before the effect above has seeded
 * it — treated the same as 'loading' rather than rendering nothing.
 */
function HostPublicIp({ state }) {
  if (!state || state.status === 'loading') {
    return (
      <div className="text-[11px] text-[var(--color-text-muted)]">public IP: measuring…</div>
    );
  }
  if (state.status === 'offline') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone="muted">public IP unknown</Pill>
        <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
          This link is offline, so this host could not be asked.
        </span>
      </div>
    );
  }
  if (!state.ip) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone="warn">public IP not known</Pill>
        <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
          {state.error || 'This host’s public IP could not be measured.'}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-[var(--color-text-muted)]">public IP</span>
      <code className="text-[12px] font-mono text-[var(--color-text-primary)] break-all">{state.ip}</code>
      {state.via && (
        <span className="text-[11px] text-[var(--color-text-muted)]">
          via <code className="font-mono">{state.via}</code>
        </span>
      )}
    </div>
  );
}

/**
 * Before/after — the point is to WATCH the address change. A missing
 * address renders as "not measured", never as a repeat of the other one:
 * `applyExitGate` leaves those fields null when nothing came back, and
 * filling the gap here would manufacture the evidence the user is reading
 * this to check.
 */
function EgressAddr({ value }) {
  return value
    ? <code className="font-mono text-[var(--color-text-primary)]">{value}</code>
    : <span className="text-[var(--color-text-muted)] italic">not measured</span>;
}

function EgressDelta({ before, after, label }) {
  return (
    <div className="text-[11px] flex items-center gap-2 flex-wrap">
      {label && <span className="text-[var(--color-text-secondary)] w-[5.5rem]">{label}</span>}
      <span className="text-[var(--color-text-muted)]">before</span>
      <EgressAddr value={before} />
      <span className="text-[var(--color-text-muted)]">→ after</span>
      <EgressAddr value={after} />
    </div>
  );
}

/**
 * The four addresses an apply comes back with, read as the two pairs they
 * are. CONTAINERS is the feature — those two should DIFFER. HOST is the
 * assertion — those two should be IDENTICAL, and a host whose address
 * moved is a failed apply regardless of how healthy the container egress
 * looks. The verdict line is the host's own `host_held`/`host_moved`, not
 * inferred here: an absent address means NOT MEASURED, and inferring
 * "unchanged" from two blanks is the false all-clear this screen must never
 * print.
 */
function EgressPairs({ result }) {
  const containers = result.containerEgressAfter || result.containerEgressBefore;
  return (
    <div className="grid gap-0.5">
      <EgressDelta
        label="containers"
        before={result.containerEgressBefore?.ip || null}
        after={result.containerEgressAfter?.ip || null}
      />
      <EgressDelta label="host" before={result.egressBefore} after={result.egressAfter} />
      {result.hostMoved && (
        <span className="text-[11px] text-[var(--color-danger)]">
          The HOST&apos;s own address moved. That is the failure this must never produce, so the
          apply was reverted — the machine, not just its containers, had been routed through the
          gate.
        </span>
      )}
      {result.hostHeld && !result.hostMoved && (
        <span className="text-[11px] text-[var(--color-text-muted)]">
          The host held its own address — only the containers moved.
        </span>
      )}
      {containers?.error && (
        <span className="text-[11px] text-[var(--color-danger)]">{containers.error}</span>
      )}
    </div>
  );
}

/**
 * Offering THIS host as a gate — the other end of picking one.
 *
 * Two halves live behind the single button — the host advertises, the
 * control plane approves — and the backend withdraws the first if the
 * second fails, since a node that advertises a route nobody approved looks
 * armed and forwards nothing. The `pending` state names that condition.
 *
 * Ineligibility is never a bare greyed control: `exitOfferState` always
 * carries the host's own sentence.
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

      {/* A gate that is ALREADY offering still costs what it costs. The
          confirmation dialog says so at selection time, but a row that
          only reads "Offering as exit gate" invites picking it from the
          list above without ever meeting that sentence. */}
      {verdict.warning && verdict.state === 'offering' && (
        <div className="text-[11px] text-amber-300">
          Costly gate: {verdict.warning}
        </div>
      )}

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

/**
 * The exit-gate control for one host.
 *
 * The confirmation step is not ceremony: moving a default route can take a
 * machine off the internet. The host arms a dead-man's switch before it
 * touches anything, but a user who did not expect that is a failure mode
 * those layers can't cover — so: pick a gate, see what it would actually do
 * (a real `plan` call against the machine), then confirm.
 *
 * Only gates that ADVERTISE AND ARE APPROVED are ever listed; see
 * `exitGateCandidates` — which also lists the OTHER kind of gate, an external
 * WireGuard tunnel another host terminates. Both kinds share this one picker
 * on purpose: they answer the same question, and two controls that both look
 * like "turn the VPN on" is how a user stops knowing which one is in force
 * (external-vpns-in-networking.md §3.3).
 */
function ExitGateControl({
  host, mesh, hosts, slug, onChanged, hostIps, onExternalRouteApplied, onExternalRouteCleared,
}) {
  const node = mesh?.available ? mesh.nodes?.[host.id] : null;
  const candidates = useMemo(
    () => exitGateCandidates(hosts, mesh, host.id),
    [hosts, mesh, host.id],
  );
  /**
   * `<remote host name> — <external IP>`, for a MESH candidate only — the
   * exact source `HostPublicIp` already uses (`hostIps`/`fetchHostPublicIp`),
   * never a second fetch path. Offline and could-not-measure both fall back
   * to the host's own name alone: never a fake IP, never "unknown" dressed
   * up as one. External candidates keep their existing peer-count label —
   * they name a TUNNEL, not a host, and there is no single IP that answers
   * "the tunnel's own address".
   */
  const meshCandidateLabel = useCallback((c) => {
    const h = (hosts || []).find((x) => x.id === c.hostId);
    if (h?.connected) {
      const ip = hostIps?.[c.hostId]?.ip;
      if (ip) return `${c.name} — ${ip}`;
    }
    return c.name;
  }, [hosts, hostIps]);
  const [choice, setChoice] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const inForce = node?.exitNode || null;
  // The warnings belong to the gate being CHOSEN, not to this host, so they
  // are read off the selected candidate rather than off `node`.
  const chosen = useMemo(
    () => candidates.find((c) => c.value === choice) || null,
    [candidates, choice],
  );
  const chosenWarnings = chosen?.warnings || [];
  const viaHost = chosen?.kind === 'external' ? chosen.viaHostId : null;
  // THIS host's own state, not the gate's: tailscale will not advertise a gate
  // and select one at the same time, so a host that is offering itself cannot
  // take a selection. Read here, before anything is attempted — the measured
  // failure was a user finding out halfway through a mutation.
  const advertiseConflict = advertiseConflictWarning(node);

  // Which of the two APIs a press reaches is decided by the CHOSEN
  // candidate's kind, in one place, rather than by a second set of controls:
  // the two verbs take different arguments (a node name vs. the acting host's
  // id) and move different things, and the only thing that knows which is
  // meant is the option the user picked.
  const preview = useCallback(async () => {
    setError(''); setResult(null); setBusy('plan');
    try {
      setPlan(viaHost
        ? await applyExternalRoute(slug, host.id, { viaHost, plan: true })
        : await applyExitGate(slug, host.id, { node: choice, plan: true }));
    } catch (e) {
      setError(String(e.message || e));
    } finally { setBusy(''); }
  }, [slug, host.id, choice, viaHost]);

  const confirm = useCallback(async () => {
    setError(''); setBusy('apply');
    try {
      const res = viaHost
        ? await applyExternalRoute(slug, host.id, { viaHost })
        : await applyExitGate(slug, host.id, { node: choice });
      setResult(res); setPlan(null);
      // Tracked so the global "Disable VPN" switch can find it — an external
      // route lives in the acting host's own state.json and no status verb
      // publishes it yet (see the External VPNs section's own note), so this
      // session's own memory of what it just applied is the only record the
      // screen has.
      if (viaHost && res.confirmed) onExternalRouteApplied?.(host.id, viaHost, chosen?.viaHostName || viaHost);
      onChanged?.();
    } catch (e) {
      setError(String(e.message || e));
    } finally { setBusy(''); }
  }, [slug, host.id, choice, viaHost, onChanged, onExternalRouteApplied, chosen]);

  const clear = useCallback(async () => {
    setError(''); setBusy('clear'); setPlan(null);
    try {
      if (viaHost) {
        const res = await clearExternalRoute(slug, host.id, viaHost);
        setResult({ cleared: true, egressAfter: res.containerEgressAfter?.ip || null, egressError: res.reason });
        onExternalRouteCleared?.(host.id);
      } else {
        const res = await clearExitGate(slug, host.id);
        setResult({ cleared: true, egressAfter: res.egress, egressError: res.egressError });
      }
      onChanged?.();
    } catch (e) {
      setError(String(e.message || e));
    } finally { setBusy(''); }
  }, [slug, host.id, viaHost, onChanged, onExternalRouteCleared]);

  // THE SCOPE REFUSAL. See exitGateSelectRefusal for what still doesn't fit
  // v0.1.58's container-scoped gate and why.
  //
  // CLEAR SURVIVES, deliberately: a host that took a selection before this
  // landed is stuck on it, and this screen is the only place most people
  // would go to get it off.
  const scopeRefusal = exitGateSelectRefusal(host);

  // EVERY refusal below is about the MESH path, and none of them is about the
  // external one. An external route is written by the machine that terminates
  // the tunnel, not by this host: whether this host is on the mesh, whether
  // its agent is old enough to scope a rule, and whether it can write one for
  // itself are all beside the point — the host that most needs this can do
  // none of the three, which is why the verb exists at all. So the mesh
  // refusal is downgraded from "render nothing" to a badge beside a picker
  // that still has something in it.
  const external = candidates.filter((c) => c.kind === 'external');
  const meshRefusal = (!node?.reported || !node.up)
    ? {
      tone: 'muted',
      badge: 'not on the mesh',
      detail: 'This host is not up on this tenant’s tailscale mesh, so no mesh node can carry its '
        + 'traffic. An external tunnel is a different mechanism and does not need one — the '
        + 'machine that terminates the tunnel writes the rule.',
    }
    : scopeRefusal
      ? {
        tone: scopeRefusal.kind === 'platform' ? 'muted' : 'warn',
        badge: scopeRefusal.badge,
        detail: scopeRefusal.detail,
      }
      : node.eligibility?.canSelectExit === false
        ? {
          tone: 'err',
          badge: 'cannot use an exit gate',
          detail: node.eligibility.selectExitRefusal
            || "This host's agent reports it cannot be pointed at an exit gate, without saying why.",
        }
        : null;
  // What this row may actually offer. With the mesh path refused that is the
  // external candidates alone; with nothing left, the untouched refusals
  // below render exactly as they did before this feature existed.
  const offered = meshRefusal ? external : candidates;

  if (offered.length === 0) {
    // Nothing to offer, and the reason is worth saying: a silent absence here
    // reads as a screen that forgot to render, and the fix ("approve the route
    // in headscale") lives somewhere the user would never think to look.
    if (!node?.reported || !node.up) return null;
    if (scopeRefusal) {
      return (
        <div className="mt-1 p-2 rounded bg-white/[0.03] grid gap-2">
          {/* The badge names WHICH refusal, so two hosts refused for different
              reasons no longer read as the same row. `kind` decides the tone:
              an agent that can be updated is amber, an architecture that never
              changes is not a call to action. */}
          <Disclosure
            tone={scopeRefusal.kind === 'platform' ? 'muted' : 'warn'}
            badge={scopeRefusal.badge}
            detail={scopeRefusal.detail}
          />
          {inForce && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-amber-300">
                This host is currently routed through <code className="font-mono">{inForce}</code>.
              </span>
              <button
                type="button"
                disabled={!!busy}
                onClick={clear}
                className="px-2 py-1 text-[11px] rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === 'clear' ? 'Clearing…' : `Clear (${inForce})`}
              </button>
            </div>
          )}
          {result?.cleared && (
            <div className="grid gap-1">
              <Pill tone="ok">exit gate cleared</Pill>
              <EgressDelta before={null} after={result.egressAfter} />
              {result.egressError && (
                <span className="text-[11px] text-[var(--color-danger)]">{result.egressError}</span>
              )}
            </div>
          )}
          {error && <div className="text-[11px] text-[var(--color-danger)] break-all">{error}</div>}
        </div>
      );
    }
    // A host that says it cannot be pointed at a gate gets the sentence, not a
    // picker that would 409 after the click. `false` only; `null` means the
    // agent is too old to have answered, which is not a no.
    if (node.eligibility?.canSelectExit === false && !inForce) {
      return (
        <Disclosure
          tone="err"
          badge="cannot use an exit gate"
          detail={node.eligibility.selectExitRefusal
            || "This host's agent reports it cannot be pointed at an exit gate, without saying why."}
        />
      );
    }
    if (!inForce) {
      return (
        <Disclosure
          tone="muted"
          badge="no exit gate available"
          detail={(
            <>
              No other host on this mesh both advertises an exit route and has it approved in
              headscale, and no host reports an external tunnel this one could be routed into, so
              there is nothing to route through. Use “Offer as exit gate” on the host you want to
              route through — that does both halves.
            </>
          )}
        />
      );
    }
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
          {/* Grouped, because the two kinds are not interchangeable and the
              difference is not visible in a name: one is a peer this tenant's
              own control plane approved, the other is a tunnel somebody else
              terminates. Rendered only when both kinds are present, so a mesh
              -only account sees the list it has always seen. */}
          {offered.some((c) => c.kind === 'external') && offered.some((c) => c.kind === 'mesh') ? (
            <>
              <optgroup label="Mesh exit nodes">
                {offered.filter((c) => c.kind === 'mesh').map((c) => (
                  <option key={c.value} value={c.value}>
                    {meshCandidateLabel(c)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="External VPN tunnels">
                {offered.filter((c) => c.kind === 'external').map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.name} ({c.peers} peer{c.peers === 1 ? '' : 's'})
                  </option>
                ))}
              </optgroup>
            </>
          ) : offered.map((c) => (
            <option key={c.value} value={c.value}>
              {c.kind === 'mesh'
                ? meshCandidateLabel(c)
                : `${c.name} (${c.peers} peer${c.peers === 1 ? '' : 's'})`}
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
        {/* The external undo, and it is NOT behind an "in force" check the way
            the mesh one is — there is nothing to check it against. `exit_node`
            comes back on every mesh-status read; an external route lives in
            the acting machine's own state.json and no verb publishes it yet,
            so this screen genuinely does not know whether one is installed.
            An undo that only appears once the screen is sure would be missing
            exactly when it is needed, and the verb removes what was RECORDED,
            so pressing it with nothing recorded is a no-op. */}
        {viaHost && (
          <button
            type="button"
            disabled={!!busy}
            onClick={clear}
            className="px-2 py-1 text-[11px] rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === 'clear' ? 'Clearing…' : `Clear route via ${chosen.viaHostName}`}
          </button>
        )}
      </div>

      {/* Why the mesh nodes are not in the list above. The refusal was always
          written; before external candidates existed it was the whole render,
          and it stays readable rather than disappearing behind a picker that
          now has something in it. */}
      {meshRefusal && (
        <Disclosure tone={meshRefusal.tone} badge={meshRefusal.badge} detail={meshRefusal.detail} />
      )}

      {/* What an external candidate actually requires, said BEFORE the press.
          This screen cannot know it: the only thing that can resolve a
          container is the runtime on the machine that would route it, so
          Review change is the answer and it changes nothing. */}
      {viaHost && (
        <Disclosure
          tone="info"
          badge="routed by another machine"
          detail={(
            <>
              This route is written on <code className="font-mono">{chosen.viaHostName}</code>, not
              here: it is that machine that terminates the tunnel and owns the routing table. It
              works only if <code className="font-mono">{host.hostname || host.id}</code> runs as a
              container on it — the rule’s source comes out of that runtime, so a host it cannot
              resolve is refused rather than guessed at. “Review change” asks it and changes
              nothing.
            </>
          )}
        />
      )}

      {/* BEFORE the attempt, not halfway through it — sits beside the picker
          as well as inside the confirmation, because somebody who never
          presses Review still needs to see why this row will not work. The
          badge is what carries that beside a picker that stays usable; the
          sentence is still one click away, and repeated in full inside the
          confirmation for anyone who gets that far. */}
      {advertiseConflict && (
        <Disclosure tone="warn" badge="advertising a gate" detail={advertiseConflict} />
      )}

      {/* The confirmation. Everything in it was measured on the host by the
          plan call — the gate, the path to it, the container networks that
          would move, and every prefix that stays outside the tunnel. */}
      {plan && (
        <div className="p-2 rounded bg-amber-500/10 grid gap-1.5">
          <div className="text-[11px] text-amber-300 font-medium">
            {plan.kind === 'external' ? (
              <>
                This moves ONE container — <code className="font-mono">{plan.container}</code>
                {plan.sourceIp ? <> at <code className="font-mono">{plan.sourceIp}</code></> : null} —
                out through <code className="font-mono">{plan.gate}</code>
                {plan.gateIp ? ` (via ${plan.gateIp})` : ''} on {chosen?.viaHostName}. That
                machine&apos;s own public IP must NOT change, and it checks that it did not.
              </>
            ) : (
              <>
                This moves the CONTAINERS on {host.hostname || 'this host'} out through {plan.gate}
                {plan.gateIp ? ` (${plan.gateIp})` : ''}. The machine&apos;s own public IP must NOT
                change, and the host checks that it did not.
              </>
            )}
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)]">
            If the gate does not forward — or if the host&apos;s own address moves — the host
            reverts itself: a dead-man&apos;s switch is armed before anything changes, and it is
            only stood down once both addresses have been re-measured.
          </div>
          {/* The exact rule, for an external route. `from <ip>/32` is the
              safety property this whole verb is built on — a single address
              that came out of the runtime, never a network — so it belongs in
              front of the person confirming it, not only in a log. */}
          {plan.kind === 'external' && plan.sourceIp && (
            <div className="text-[11px] text-[var(--color-text-muted)]">
              The rule it installs:{' '}
              <code className="font-mono text-[var(--color-text-secondary)]">
                ip rule add from {plan.sourceIp}/32 lookup {plan.table} priority {plan.priority}
              </code>{' '}
              — one address, so nothing else on that machine moves.
            </div>
          )}
          {/* Which networks, named, rather than a promise about "your
              containers". Straight off the plan the host just computed. */}
          {plan.containerRoutes.length > 0 && (
            <div>
              <div className="text-[11px] text-[var(--color-text-muted)]">
                These {plan.runtime ? `${plan.runtime} ` : ''}container networks would leave through
                the gate:
              </div>
              <ul className="mt-0.5">
                {plan.containerRoutes.map((r) => (
                  <li key={r.prefix} className="text-[11px] text-[var(--color-text-muted)]">
                    <code className="font-mono text-[var(--color-text-secondary)]">{r.prefix}</code>
                    {r.networks.length > 0 ? ` — ${r.networks.join(', ')}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {advertiseConflict && (
            <div className="pt-1 border-t border-amber-500/20 text-[11px] text-amber-300">
              {advertiseConflict}
            </div>
          )}
          {/* What choosing THIS gate costs, as opposed to whether it works —
              a gate can be perfectly functional and still a bad idea. The
              dead-man's switch above only knows whether traffic flows, not
              who it flows through, so this is the only place a user finds
              out, and it has to be before they confirm. */}
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

      {/* The outcome. An unconfirmed gate is NOT an error — the host
          reverted itself and is fine — so it renders as its own state,
          with the addresses that explain it (see EgressPairs). */}
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
              <EgressPairs result={result} />
            </>
          ) : (
            <>
              <Pill tone="warn">{result.reverted ? 'not confirmed — reverted' : 'not applied'}</Pill>
              <EgressPairs result={result} />
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

/**
 * The grid every host row aligns to, and the header that names it — declared
 * once so the two can never drift apart. `md:` only: a viewport too narrow
 * for five columns falls back to the same stacked block the row already
 * used before this refactor, rather than clipping.
 */
const HOST_GRID_COLS = 'md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_auto]';

function HostGridHeader() {
  return (
    <div
      className={`hidden md:grid ${HOST_GRID_COLS} gap-x-3 px-0.5 pb-1.5 mb-1 border-b border-[var(--color-border)] text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]`}
    >
      <div>Host</div>
      <div>State</div>
      <div>Public IP</div>
      <div>Gate in force</div>
      <div>Actions</div>
    </div>
  );
}

function HostRow({
  host, mesh, hosts, slug, onChanged, publicIp, hostIps,
  onExternalRouteApplied, onExternalRouteCleared,
}) {
  // The same mesh-status entry MeshState renders below: the agent reports
  // "am I on the mesh" and "could I be" in one payload, and the second half
  // is what keeps this row from saying "unconfirmed" about a fact the host
  // already answered.
  const node = mesh?.available ? mesh.nodes?.[host.id] : null;
  const eligibility = bootstrapEligibility(host, node);
  const tone = { yes: 'ok', no: 'err', unknown: 'warn' }[eligibility.state] || 'muted';
  // Whether THIS row gets the button or the written refusal. Same verdict the
  // rest of the row renders, read through one function so the button and the
  // sentence under it can never disagree.
  const join = joinMeshAvailability(host, node, eligibility);

  const [joining, setJoining] = useState(false);
  const [joinResult, setJoinResult] = useState(null);
  const [joinError, setJoinError] = useState(null);
  // Open by default: the eligibility line, the join outcome and the two gate
  // controls are what the compact columns above summarise, and hiding them
  // behind a second click the first time a reader lands on this screen would
  // cost more than the density buys. The toggle exists for a row a reader
  // already understands and wants to fold away, not as the resting state.
  const [detailsOpen, setDetailsOpen] = useState(true);

  const runJoin = useCallback(async () => {
    setJoining(true);
    setJoinError(null);
    setJoinResult(null);
    try {
      const res = await joinMesh(slug, host.id);
      setJoinResult(res);
      // Re-read the mesh so the row stops offering a join it just completed —
      // and so the address it now has appears without a manual reload.
      if (res.enrolled && onChanged) await onChanged();
    } catch (e) {
      setJoinError(String(e.message || e));
    } finally {
      setJoining(false);
    }
  }, [slug, host.id, onChanged]);

  return (
    <div className="py-3 border-b border-[var(--color-border)] last:border-b-0">
      {/* The scannable summary — one line per host, aligned to HostGridHeader.
          Stacks on a narrow viewport instead of overflowing (grid-cols-1
          below md), the same protection the old flex-wrap gave. */}
      <div className={`grid grid-cols-1 ${HOST_GRID_COLS} gap-x-3 gap-y-1 items-start`}>
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

        <MeshState mesh={mesh} hostId={host.id} />
        <HostPublicIp state={publicIp} />

        {/* "Gate in force" — this host's OWN exit_node, verbatim off the mesh
            status, or a dash. Nothing else: an external route lives in the
            acting host's own state.json and no verb publishes it yet (see
            the External VPNs section's own note and card E4), so this cell
            would be lying if it tried to show more than the mesh says. */}
        <div className="text-[12px] text-[var(--color-text-secondary)] break-all">
          {node?.exitNode
            ? <code className="font-mono">{node.exitNode}</code>
            : <span className="text-[var(--color-text-muted)]">—</span>}
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Remote bootstrap, for real: the key is minted inside aw-backend
              and handed straight to the host's agent, so pressing this never
              puts a mesh credential in front of anybody. A host that cannot
              take it stays disabled AND carries its sentence as text below —
              the title alone would be invisible on touch. */}
          <button
            type="button"
            disabled={!join.can || joining}
            onClick={runJoin}
            title={join.can
              ? 'Install tailscale on this host and enrol it in this tenant’s mesh, over its own link.'
              : `Unavailable: ${join.reason}`}
            className={`shrink-0 px-3 py-1 text-[12px] rounded ${join.can
              ? 'bg-sky-500/20 hover:bg-sky-500/35 text-sky-200 disabled:opacity-40'
              : 'bg-white/5 text-[var(--color-text-muted)] opacity-50 cursor-not-allowed'}`}
          >
            {joining ? 'Joining…' : 'Join mesh'}
          </button>
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((v) => !v)}
            className="shrink-0 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            {detailsOpen ? '▼' : '▶'} details
          </button>
        </div>
      </div>

      {detailsOpen && (
        <div className="mt-2 grid gap-1.5">
          {/* The ineligibility reason as TEXT, always — not only in the
              button's title, which is invisible on touch. */}
          <div className="flex items-start gap-2 flex-wrap">
            <Pill tone={tone}>{eligibility.label}</Pill>
            <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
              {eligibility.reason}
            </span>
          </div>
          {/* Only when the button is refused for a reason the eligibility line
              does not already give — offline, or already enrolled. Repeating
              the same sentence twice on a row would be noise; omitting a
              different one would be a greyed control with no explanation. */}
          {!join.can && join.reason && join.reason !== eligibility.reason && (
            <div className="text-[11px] text-[var(--color-text-muted)]">{join.reason}</div>
          )}
          {joinResult && (
            <div className="flex items-start gap-2 flex-wrap">
              <Pill tone={joinResult.enrolled ? 'ok' : 'warn'}>
                {joinResult.alreadyEnrolled
                  ? 'already on the mesh'
                  : joinResult.enrolled
                    ? `enrolled${joinResult.nodeName ? ` — ${joinResult.nodeName}` : ''}`
                    : 'not enrolled'}
              </Pill>
              <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
                {joinResult.refusal || joinResult.reason || joinResult.error
                  || (joinResult.enrolled
                    ? `This host is on the mesh${joinResult.meshIp ? ` at ${joinResult.meshIp}` : ''}.`
                    : 'The host did not enrol, and did not say why.')}
              </span>
            </div>
          )}
          {joinError && (
            <div className="text-[11px] text-[var(--color-danger)] break-all">{joinError}</div>
          )}
          <ExitOfferControl host={host} mesh={mesh} slug={slug} onChanged={onChanged} />
          <ExitGateControl
            host={host}
            mesh={mesh}
            hosts={hosts}
            slug={slug}
            onChanged={onChanged}
            hostIps={hostIps}
            onExternalRouteApplied={onExternalRouteApplied}
            onExternalRouteCleared={onExternalRouteCleared}
          />
        </div>
      )}
    </div>
  );
}

/** Bytes as a human reads them. `null` is NOT zero — a counter that never
 *  arrived and a counter that says nothing has moved are different facts, and
 *  0/0 next to "never" is the whole diagnostic for a tunnel that is up and
 *  carrying nothing. */
function bytes(n) {
  if (typeof n !== 'number') return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

/** A handshake age, in THREE states. `never` is not a large age and an absent
 *  age is not `never` — an agent that reported neither has told us nothing,
 *  and rendering that as "never" would accuse a working tunnel. */
function handshake(tunnel) {
  if (typeof tunnel.handshakeAgeSeconds === 'number') {
    const s = tunnel.handshakeAgeSeconds;
    if (s < 90) return `${s}s ago`;
    const mins = Math.round(s / 60);
    if (mins < 90) return `${mins}min ago`;
    const hours = Math.round(mins / 60);
    return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
  }
  return tunnel.handshakeNever ? 'never' : 'unknown';
}

/**
 * One host's external VPN interfaces, and the upstream health of each peer on
 * them.
 *
 * `wg show all dump` emits one line per (interface, peer), so a hub arrives as
 * nine rows of the same interface — grouped here, because nine rows would
 * render as nine VPNs and there is one.
 *
 * TRANSFER COUNTERS AND HANDSHAKE AGE ARE THE DIAGNOSTIC, and 0/0 next to
 * "never" is the most useful thing this section can say: it is exactly what a
 * configured-but-not-connecting tunnel looks like, and smoothing it into
 * "connected" is how that state stayed invisible for a day.
 */
function ExternalVpnEntry({ entry }) {
  const { host, state, reason, interfaces } = entry;
  const tone = { tunnels: 'ok', none: 'muted', unknown: 'warn', silent: 'muted' }[state];
  const label = {
    tunnels: `${interfaces.length} tunnel${interfaces.length === 1 ? '' : 's'}`,
    none: 'none found',
    unknown: 'could not look',
    silent: 'no answer',
  }[state];

  return (
    <div className="py-3 border-b border-[var(--color-border)] last:border-b-0">
      {/* Hostname and link id in ONE element, deliberately: the host rows
          above already render the hostname on its own, and a second element
          whose whole content is that same string makes every by-text lookup
          on this screen ambiguous — the same trap PublicIpBanner names. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-medium text-[var(--color-text-primary)] break-all">
          {host.hostname || '(no hostname)'} · link {host.id}
        </span>
        <Pill tone={tone}>{label}</Pill>
      </div>

      {/* The host's own sentence for both not-a-tunnel states. "Could not
          look" is never rendered as "no external VPN" — that is a claim
          nobody made. */}
      {reason && (
        <div className="text-[11px] text-[var(--color-text-muted)] mt-1">{reason}</div>
      )}

      {interfaces.map((iface) => (
        <div key={iface.interface} className="mt-2 p-2 rounded bg-white/[0.03] grid gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[12px] font-mono text-[var(--color-text-primary)]">
              {iface.interface}
            </code>
            <Pill tone="info">wireguard</Pill>
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {iface.tunnels.length} peer{iface.tunnels.length === 1 ? '' : 's'}
            </span>
          </div>
          {iface.tunnels.map((t) => (
            <div key={t.peerPublicKey} className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-2 flex-wrap">
              {/* The PEER's public key. The interface's own private key never
                  leaves the host that holds it — the agent skips that line of
                  the dump outright. */}
              <code className="font-mono text-[var(--color-text-secondary)]">
                {t.peerPublicKey.slice(0, 12)}…
              </code>
              <span>{t.endpoint || 'no endpoint'}</span>
              <Pill tone={t.handshakeNever ? 'warn' : 'muted'}>
                handshake {handshake(t)}
              </Pill>
              <span>
                rx {bytes(t.rxBytes)} · tx {bytes(t.txBytes)}
              </span>
              {t.allowedIps.length > 0 && (
                <span>
                  allows <code className="font-mono">{t.allowedIps.join(', ')}</code>
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * External VPNs — the tunnels this account's hosts terminate that are NOT
 * this tenant's mesh.
 *
 * DISCOVERED, NOT AUTHORED. There is no form here and no "connect" button, and
 * both absences are decisions: the config and its private key stay on the
 * machine that dials (external-vpns-in-networking.md §3.2, and §3.6 of
 * vpn-concentrator.md, which rules out anything that could read a config
 * back), and routing is chosen in the gate picker one section up, because two
 * controls that both look like "turn the VPN on" is how somebody stops knowing
 * which one is in force.
 */
function ExternalVpnsSection({ hosts, mesh }) {
  const entries = useMemo(() => externalVpnEntries(hosts, mesh), [hosts, mesh]);
  return (
    <Section
      title="External VPNs"
      description="WireGuard tunnels the account's hosts terminate themselves — read back from each host, never stored here. Registering one is done on the machine that dials; routing a host into one is the exit gate picker above."
    >
      {entries.length === 0 ? (
        <div className="text-[12px] text-[var(--color-text-muted)]">
          No host has a live link right now, so nothing could be asked. This section reports what
          hosts measure; it holds no state of its own.
        </div>
      ) : (
        entries.map((entry) => <ExternalVpnEntry key={entry.host.id} entry={entry} />)
      )}
      <div className="text-[11px] text-[var(--color-text-muted)] mt-3 pt-3 border-t border-[var(--color-border)]">
        Whether a host is currently ROUTED through one of these is not shown: an external route
        lives in the acting machine&apos;s own state and no status verb publishes it yet. The gate
        picker above still applies and clears one — it just cannot tell you, on a fresh load,
        that it did.
      </div>
    </Section>
  );
}

function CommandBlock({ commands }) {
  return (
    <pre className="mt-1 p-2 rounded bg-black/30 text-[11px] font-mono text-[var(--color-text-secondary)] overflow-x-auto whitespace-pre">
      {commands.join('\n')}
    </pre>
  );
}

/** Minutes left on a minted key, as a sentence rather than a timestamp: what a
 *  reader needs from it is "do I still have time to paste this", and a
 *  wall-clock time in some timezone answers that question badly. */
function minutesLeft(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(1, Math.round(ms / 60000));
}

/**
 * The join command, with a real key in it — for machines NOT linked to this
 * account. Everything linked gets the Join mesh button instead, which never
 * shows a key to anybody.
 *
 * MINTED ON A PRESS, NEVER ON A RENDER: this component holds no key until
 * someone asks for one, and drops it again the moment it expires — a key
 * sitting in a component after a tab was merely opened is a credential
 * nobody is watching.
 *
 * A failure shows the backend's sentence and NEVER falls back to a `<key>`
 * placeholder — that placeholder is the bug this whole path replaces.
 */
function JoinCommandSection({ slug, controlPlane }) {
  const [minted, setMinted] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Drop the key when it dies. The command block would otherwise keep offering
  // a credential that has stopped working, which sends the reader debugging
  // their machine instead of pressing Regenerate.
  useEffect(() => {
    if (!minted?.expiresAt) return undefined;
    const ms = new Date(minted.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms)) return undefined;
    const timer = setTimeout(() => setMinted(null), Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [minted]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setMinted(await mintJoinKey(slug));
    } catch (e) {
      setMinted(null);
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }, [slug]);

  const command = joinCommand(minted?.controlPlaneUrl || controlPlane, minted?.key);
  const left = minted?.expiresAt ? minutesLeft(minted.expiresAt) : null;

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="px-2 py-1 text-[11px] rounded bg-sky-500/20 hover:bg-sky-500/35 text-sky-200 disabled:opacity-40"
        >
          {busy ? 'Generating…' : minted ? 'Regenerate join command' : 'Generate join command'}
        </button>
        {minted && (
          <Pill tone="warn">
            single use{left ? ` · expires in ${left} min` : ' · expiring'}
          </Pill>
        )}
      </div>

      {command ? (
        <>
          <CommandBlock commands={[command]} />
          <div className="text-[11px] text-[var(--color-text-muted)] mt-1">
            Run it after the install step for that machine&apos;s OS. The key works once and then
            it is spent — a second machine needs a second command.
          </div>
        </>
      ) : (
        <div className="text-[11px] text-[var(--color-text-muted)] mt-1">
          The join command carries a live key to this tenant&apos;s private mesh, so it is minted
          only when you ask for it — never just because this screen was opened. It is single-use
          and expires in minutes.
        </div>
      )}

      {error && (
        <div className="text-[11px] text-[var(--color-danger)] break-all mt-1">{error}</div>
      )}
    </div>
  );
}

export default function NetworkingTab() {
  const [hosts, setHosts] = useState(null);
  const [mesh, setMesh] = useState(null);
  const [slug, setSlug] = useState(null);
  const [egress, setEgress] = useState(null);
  // Per-host public IP, keyed by host id — see the effect below.
  const [hostIps, setHostIps] = useState({});
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
    // screen. `currentWorkspaceSlug()` — not `resolveAccountSlug()` — because
    // this screen has to be scoped to the workspace being VIEWED, and
    // identity/me has no idea which one that is when the login owns more
    // than one (see networking:public-ip-banner-wrong-workspace-and-per-host-ip).
    currentWorkspaceSlug()
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

  /**
   * One public-IP measurement per CONNECTED host, keyed by host id — only
   * ever holds a LIVE result that has actually come back. 'offline' and
   * 'loading' are not seeded here: they are derived straight from `hosts`
   * in `hostPublicIpState` below, so there is nothing to set synchronously
   * in this effect's body (react-hooks/set-state-in-effect) — every
   * `setHostIps` call here happens inside a promise callback, once a real
   * answer exists.
   *
   * DECISION (per the card): fire on load, in parallel, one promise per
   * host, each resolved independently rather than behind a `Promise.all` —
   * a host that hangs or times out (bounded server-side by
   * PUBLIC_IP_TIMEOUT_S) must not hold up the row next to it. This only
   * re-fires when the host list or the workspace slug actually changes
   * (initial load, Retry) — not on every render, so a click inside some
   * other row's exit-gate picker never re-measures anything.
   *
   * Offline hosts are never asked at all: `host.connected` already answers
   * "could this be measured", asking anyway would just spend a round trip
   * to be told what is already known.
   */
  useEffect(() => {
    if (!slug || !hosts) return;
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

  /** 'offline' and 'loading' are facts already on hand — no reason to wait
   *  on a render cycle to say them. Only 'measured' comes from `hostIps`. */
  const hostPublicIpState = useCallback(
    (host) => (host.connected ? (hostIps[host.id] || { status: 'loading' }) : { status: 'offline' }),
    [hostIps],
  );

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
      </div>

      <PublicIpBanner egress={egress} loading={egressLoading} onRefresh={remeasure} />

      <Section title="Control plane">
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

      <Section title="Links">
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
              <HostRow
                key={h.id}
                host={h}
                mesh={mesh}
                hosts={hosts}
                slug={slug}
                onChanged={afterGateChange}
                publicIp={hostPublicIpState(h)}
                hostIps={hostIps}
              />
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
                      <HostRow
                        key={h.id}
                        host={h}
                        mesh={mesh}
                        hosts={hosts}
                        slug={slug}
                        onChanged={afterGateChange}
                        publicIp={hostPublicIpState(h)}
                        hostIps={hostIps}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Section>

      {!loading && !error && (
        <ExternalVpnsSection hosts={hosts} mesh={mesh} />
      )}

      <Section
        title="Install tailscale"
        description="Per operating system. The macOS path is genuinely different — the Linux installer does not work there."
      >
        {installInstructions().map((entry) => (
          <div key={entry.id} className="mb-3 last:mb-0">
            <div className="text-[12px] font-medium text-[var(--color-text-primary)]">{entry.title}</div>
            {entry.note && (
              <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{entry.note}</div>
            )}
            <CommandBlock commands={entry.commands} />
          </div>
        ))}
      </Section>

      <Section
        title="Join this mesh"
        description="For a machine that is NOT linked to this account. Anything in the list above is enrolled with its own Join mesh button instead — no key ever leaves the backend on that path."
      >
        <JoinCommandSection slug={slug} controlPlane={controlPlane} />
      </Section>
    </div>
  );
}

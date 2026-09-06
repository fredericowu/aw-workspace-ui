import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchVpnStatus, normalizeVpnStatus, fetchConfigs, connectVpn, disconnectVpn } from '../lib/vpnApi';

/**
 * Top-bar VPN indicator + quick controls.
 *
 * This talks to the SAME /api/vpn/status the Settings → VPNs tab
 * (VpnsTab.jsx) does — there is one VPN subsystem reachable from this SPA,
 * the external dialer on aw-remote-host, not two. See vpnApi.js's header
 * for the pinned status contract (state/connected/egress_ip, and the
 * tri-state dns_tunneled/kill_switch/warnings). This component shares that
 * LOGIC (normalizeVpnStatus) but duplicates VpnsTab's LAYOUT rather than
 * importing its ConnectionBar — the popover's vertical rhythm is much
 * tighter than a settings tab.
 *
 * The shield's color expresses state at-a-glance:
 *   - green (+ center dot)  = connected
 *   - amber (+ center dot)  = unknown — the dialer could not be asked
 *     (e.g. no AW_BACKEND_URL/AW_WORKSPACE_HOST_TOKEN); this is the common
 *     case on many workspaces, not an alarm
 *   - muted, no dot         = disconnected
 *
 * /api/vpn/status shells out live to the remote host on every call, so the
 * hover handler below is debounced rather than fetching on every
 * mouseenter, and there is no background polling — only a fetch on mount,
 * on (debounced) hover, and after a connect/disconnect action settles.
 */
const HOVER_REFRESH_DEBOUNCE_MS = 5000;

export default function VpnNav() {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [status, setStatus] = useState(() => normalizeVpnStatus(null));
  const [configs, setConfigs] = useState([]);
  // The profile name being dialed, '__disconnect__' while tearing down, or
  // null when idle — locks Connect/Disconnect the same way VpnsTab does.
  const [actionPending, setActionPending] = useState(null);
  // The last connect/disconnect outcome (refusal/failure/timeout), or null.
  const [actionErr, setActionErr] = useState(null);
  const closeTimer = useRef(null);
  const lastFetchAt = useRef(0);

  const refreshStatus = useCallback(async () => {
    lastFetchAt.current = Date.now();
    try {
      const data = await fetchVpnStatus();
      setStatus(normalizeVpnStatus(data));
    } catch {
      // A failed poll must not fabricate a verdict — leave the last known
      // (already tri-state) status in place.
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleEnter = useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(true);
    // handleEnter fires on every mouseenter; the status endpoint is a live
    // shellout, so only re-fetch if the last one is stale enough to matter.
    if (Date.now() - lastFetchAt.current > HOVER_REFRESH_DEBOUNCE_MS) {
      refreshStatus();
    }
  }, [refreshStatus]);

  const handleLeave = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setPickerOpen(false);
      setActionErr(null);
    }, 150);
  }, []);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const runAction = useCallback(
    async (pendingKey, fn) => {
      if (actionPending) return;
      setActionPending(pendingKey);
      setActionErr(null);
      try {
        await fn();
      } catch (e) {
        setActionErr(e);
      } finally {
        await refreshStatus();
        setActionPending(null);
      }
    },
    [actionPending, refreshStatus],
  );

  const onConnectClick = async () => {
    setActionErr(null);
    try {
      setConfigs(await fetchConfigs());
    } catch {
      setConfigs([]);
    }
    setPickerOpen(true);
  };

  const onPickConfig = (name) => {
    setPickerOpen(false);
    runAction(name, () => connectVpn(name));
  };

  const onDisconnect = () => runAction('__disconnect__', () => disconnectVpn());

  // Jump to the full VPN settings page. We just push the hash and let
  // App.jsx's hashchange listener flip view to 'settings' — no prop
  // drilling required. Closing the popover keeps the transition clean.
  const openSettings = () => {
    setOpen(false);
    setPickerOpen(false);
    window.location.hash = '#settings/vpn';
  };

  const shieldState = status.unknown ? 'unknown' : status.connected ? 'connected' : 'disconnected';
  const iconColor =
    shieldState === 'connected' ? 'text-green-400'
    : shieldState === 'unknown' ? 'text-amber-400'
    : 'text-[var(--color-text-muted)]';
  const tooltip =
    shieldState === 'connected' ? `VPN connected · ${status.profile || '(unknown profile)'}`
    : shieldState === 'unknown' ? 'VPN status unknown'
    : 'VPN disconnected';

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`p-1 rounded transition-colors hover:bg-white/10 cursor-pointer ${iconColor}`}
        title={tooltip}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" />
          {shieldState !== 'disconnected' && <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />}
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-3"
          style={{ minWidth: 280 }}
        >
          {/* State row */}
          <div className="flex items-center gap-2 mb-2">
            <div
              className={`w-2 h-2 rounded-full ${
                shieldState === 'connected' ? 'bg-green-400' : shieldState === 'unknown' ? 'bg-amber-400' : 'bg-gray-500'
              }`}
            />
            <span className="text-[12px] font-medium text-[var(--color-text-primary)] truncate">
              {shieldState === 'connected'
                ? `Connected · ${status.profile || '(unknown profile)'}`
                : shieldState === 'unknown'
                  ? 'VPN status unknown'
                  : 'Disconnected'}
            </span>
          </div>

          {/* Calm, informative — this is the common case on a workspace
              with no AW_BACKEND_URL/AW_WORKSPACE_HOST_TOKEN, not an alarm. */}
          {shieldState === 'unknown' && (
            <div className="mb-2 text-[11px] text-[var(--color-text-muted)]">
              the host can't be asked right now{status.detail ? ` — ${status.detail}` : ''}.
            </div>
          )}

          {/* Egress IP replaces the old (nonexistent) /api/vpn/public-ip row. */}
          {shieldState === 'connected' && status.egressIp && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] shrink-0">
                Egress IP
              </span>
              <span className="text-[12px] font-mono text-[var(--color-text-primary)] truncate">
                {status.egressIp}
              </span>
            </div>
          )}

          {/* Tri-state discipline, same as VpnsTab's ConnectionBar: only an
              explicit `false` renders a line; `null` renders nothing —
              never an all-clear. */}
          {status.dnsTunneled === false && (
            <div className="mb-2 text-[11px] text-amber-300">
              DNS is not tunneled — lookups resolve outside the tunnel.
            </div>
          )}
          {status.killSwitch === false && (
            <div className="mb-2 text-[11px] text-amber-300">
              kill switch unavailable — Disconnect may not be reachable if the tunnel degrades.
            </div>
          )}
          {status.warnings.length > 0 && (
            <div className="mb-2 space-y-1">
              {status.warnings.map((w, i) => (
                <div
                  key={i}
                  className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1"
                >
                  {w}
                </div>
              ))}
            </div>
          )}

          <ActionOutcome err={actionErr} />

          {/* Settings link — sits above Connect/Disconnect per spec.
              Subtle styling so the primary action stays the loud one. */}
          <button
            onClick={openSettings}
            className="w-full mb-2 px-3 py-1.5 text-[12px] rounded bg-white/5 text-[var(--color-text-primary)] hover:bg-white/10 cursor-pointer flex items-center justify-center gap-1.5"
            title="Open Settings → VPN"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Open VPN settings</span>
          </button>

          {/* Action button */}
          {shieldState === 'connected' ? (
            <button
              onClick={onDisconnect}
              disabled={!!actionPending}
              className="w-full px-3 py-1.5 text-[12px] rounded bg-[var(--color-danger)]/15 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25 disabled:opacity-50 cursor-pointer"
            >
              {actionPending === '__disconnect__' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={onConnectClick}
              disabled={!!actionPending}
              className="w-full px-3 py-1.5 text-[12px] rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50 cursor-pointer"
            >
              {actionPending ? 'Connecting…' : 'Connect…'}
            </button>
          )}

          {/* Config picker — slides out to the LEFT because the parent
              popover sits at the right edge of the top bar. */}
          {pickerOpen && shieldState !== 'connected' && (
            <div
              className="absolute right-full top-0 mr-1 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-2"
              style={{ minWidth: 240, maxWidth: 320 }}
            >
              <div className="flex items-center justify-between px-2 py-1 mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                  Choose configuration
                </span>
                <button
                  onClick={() => setPickerOpen(false)}
                  className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
                  title="Cancel"
                >
                  ✕
                </button>
              </div>
              {configs.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-[var(--color-text-muted)] italic">
                  No VPN configs found.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {configs.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => onPickConfig(c.name)}
                      disabled={!!actionPending}
                      className="w-full text-left px-3 py-1.5 rounded hover:bg-white/[0.06] disabled:opacity-50 cursor-pointer flex items-center gap-2"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.type === 'wireguard' ? 'bg-blue-400' : 'bg-orange-400'}`}
                        title={c.type}
                      />
                      <span className="text-[12px] text-[var(--color-text-primary)] truncate">{c.name}</span>
                      <span className="ml-auto text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">
                        {c.type === 'wireguard' ? 'WG' : 'OVPN'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// The last connect/disconnect outcome — refusal, failure and timeout each
// get a visibly different banner; they must never collapse into one shape.
// Same three shapes as VpnsTab's ActionOutcomeBanner, laid out tighter for
// this popover rather than shared as a component (see file header).
function ActionOutcome({ err }) {
  if (!err) return null;
  if (err.refused) {
    return (
      <div className="mb-2 px-2 py-1.5 rounded bg-sky-500/10 border border-sky-500/30 text-[11px] text-sky-200">
        <div className="font-semibold">Refused — nothing changed</div>
        {err.refusal || err.message}
      </div>
    );
  }
  if (err.timedOut) {
    return (
      <div className="mb-2 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">
        <div className="font-semibold">Timed out — unknown state</div>
        {err.message} Refresh to see what the host actually did.
      </div>
    );
  }
  return (
    <div className="mb-2 px-2 py-1.5 rounded bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 text-[11px] text-[var(--color-danger)]">
      <div className="font-semibold">Failed</div>
      {err.message}
    </div>
  );
}

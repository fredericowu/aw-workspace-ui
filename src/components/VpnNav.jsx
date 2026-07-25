import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../auth';

/**
 * Top-bar VPN indicator + quick controls.
 *
 * Hovering the shield icon opens a small popover below it with:
 *   - Connection state ("Connected · <name>" / "Disconnected")
 *   - External IP (refreshable via the small ↻ on the right)
 *   - "Allow VPN traffic only" toggle  (mirrors Settings → VPN)
 *   - "Auto-start on boot" toggle      (mirrors Settings → VPN)
 *   - Open Settings…  (jumps to Settings → VPN tab)
 *   - Connect…  /  Disconnect  action
 *
 * Clicking "Connect…" expands a side picker (slides out to the left
 * because the icon sits at the right edge of the top bar) listing every
 * VPN config from /api/vpn/configs. Picking one POSTs to /api/vpn/start.
 *
 * The icon's color expresses state at-a-glance:
 *   - green shield with center dot = connected
 *   - muted shield                   = disconnected
 *
 * Why the toggles live here too: the most common adjustment people make
 * after seeing the VPN drop / stick is flipping kill-switch or auto-start
 * — having them inline saves a trip to Settings every time.
 */
export default function VpnNav() {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [status, setStatus] = useState({ active: null, tunneled: false });
  const [publicIp, setPublicIp] = useState(null);
  const [ipLoading, setIpLoading] = useState(false);
  const [configs, setConfigs] = useState([]);
  const [busy, setBusy] = useState(false);
  // Per-toggle busy flags so flipping one doesn't disable the other while
  // the request is in flight (and so we can show optimistic UI without
  // freezing the rest of the popover).
  const [busyVpnOnly, setBusyVpnOnly] = useState(false);
  const [busyAutoStart, setBusyAutoStart] = useState(false);
  const [error, setError] = useState(null);
  const closeTimer = useRef(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/vpn/status');
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data || {});
    } catch { /* ignore — leave previous state */ }
  }, []);

  const refreshIp = useCallback(async () => {
    setIpLoading(true);
    try {
      const res = await apiFetch('/api/vpn/public-ip');
      const data = await res.json().catch(() => ({}));
      setPublicIp(data.ip || null);
    } catch {
      setPublicIp(null);
    } finally {
      setIpLoading(false);
    }
  }, []);

  const refreshConfigs = useCallback(async () => {
    try {
      const res = await apiFetch('/api/vpn/configs');
      const data = await res.json().catch(() => ({}));
      setConfigs(data.configs || []);
    } catch { /* ignore */ }
  }, []);

  // Status now comes from the server-side VpnPoller via /ws/status (the
  // same WS every dashboard tab already keeps open). useComponentStatus
  // dispatches `aw-vpn-update` when a `vpn_update` payload arrives, so
  // we just listen and patch local state. One initial fetch keeps cold
  // page loads from showing a blank shield until the next poll tick.
  useEffect(() => {
    refreshStatus();
    refreshIp();
    const onUpdate = (e) => {
      const { type, ...rest } = e.detail || {};
      setStatus((prev) => ({ ...prev, ...rest }));
    };
    window.addEventListener('aw-vpn-update', onUpdate);
    return () => window.removeEventListener('aw-vpn-update', onUpdate);
  }, [refreshStatus, refreshIp]);

  const handleEnter = useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(true);
    refreshStatus();
    refreshIp();
  }, [refreshStatus, refreshIp]);

  const handleLeave = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setPickerOpen(false);
      setError(null);
    }, 150);
  }, []);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const onConnectClick = async () => {
    setError(null);
    await refreshConfigs();
    setPickerOpen(true);
  };

  const onPickConfig = async (name) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/vpn/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.detail || data.error || 'connect failed');
      } else {
        setPickerOpen(false);
        await refreshStatus();
        await refreshIp();
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch('/api/vpn/stop', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.detail || data.error || 'disconnect failed');
      } else {
        await refreshStatus();
        await refreshIp();
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  // Toggle handlers — same endpoints as Settings → VPN. We refresh status
  // afterwards rather than mutating local state, so the source of truth
  // stays the server (avoids the popover drifting from the settings tab
  // if both are visible).
  const setVpnOnly = async (enabled) => {
    setBusyVpnOnly(true);
    setError(null);
    try {
      const res = await apiFetch('/api/vpn/settings/vpn-only', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.detail || data.error || 'failed to update');
      } else {
        await refreshStatus();
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyVpnOnly(false);
    }
  };

  const setAutoStart = async (enabled) => {
    setBusyAutoStart(true);
    setError(null);
    try {
      const res = await apiFetch('/api/vpn/settings/auto-start', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.detail || data.error || 'failed to update');
      } else {
        await refreshStatus();
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusyAutoStart(false);
    }
  };

  // Jump to the full VPN settings page. We just push the hash and let
  // App.jsx's hashchange listener flip view to 'settings' — no prop
  // drilling required. Closing the popover keeps the transition clean.
  const openSettings = () => {
    setOpen(false);
    setPickerOpen(false);
    window.location.hash = '#settings/vpn';
  };

  const isConnected = !!status.active && !!status.tunneled;
  const iconColor = isConnected ? 'text-green-400' : 'text-[var(--color-text-muted)]';
  // Server returns `vpn_only` (current) and `kill_switch` (legacy alias).
  // Mirror VpnTab's preference order so the two views stay in sync.
  const vpnOnly = !!(status.vpn_only ?? status.kill_switch);
  const autoStart = !!status.auto_start;

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`p-1 rounded transition-colors hover:bg-white/10 cursor-pointer ${iconColor}`}
        title={isConnected ? `VPN connected · ${status.active}` : 'VPN disconnected'}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" />
          {isConnected && <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />}
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-3"
          style={{ minWidth: 280 }}
        >
          {/* State row */}
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-gray-500'}`} />
            <span className="text-[12px] font-medium text-[var(--color-text-primary)] truncate">
              {isConnected ? `Connected · ${status.active}` : 'Disconnected'}
            </span>
          </div>

          {/* External IP row */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] shrink-0">
              External IP
            </span>
            <span className="text-[12px] font-mono text-[var(--color-text-primary)] truncate">
              {ipLoading ? '…' : publicIp || 'unknown'}
            </span>
            <button
              onClick={refreshIp}
              className="ml-auto text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] cursor-pointer"
              title="Refresh public IP"
            >
              ↻
            </button>
          </div>

          {/* Inline toggles — mirror Settings → VPN. Grouped in their own
              divider block so they don't run into the action buttons. */}
          <div className="border-t border-[var(--color-border)] pt-2 mb-2 space-y-2">
            <ToggleRow
              label="Allow VPN traffic only"
              hint="Firewall blocks egress that's not via the tunnel (kill switch)."
              checked={vpnOnly}
              onChange={setVpnOnly}
              disabled={busyVpnOnly}
            />
            <ToggleRow
              label="Auto-start on boot"
              hint={`Brings up "${status.active ?? 'the active config'}" before awserv (no leak window).`}
              checked={autoStart}
              onChange={setAutoStart}
              disabled={busyAutoStart}
            />
          </div>

          {error && (
            <div className="mb-2 px-2 py-1 text-[11px] rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30">
              {error}
            </div>
          )}

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
          {isConnected ? (
            <button
              onClick={onDisconnect}
              disabled={busy}
              className="w-full px-3 py-1.5 text-[12px] rounded bg-[var(--color-danger)]/15 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25 disabled:opacity-50 cursor-pointer"
            >
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            <button
              onClick={onConnectClick}
              disabled={busy}
              className="w-full px-3 py-1.5 text-[12px] rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50 cursor-pointer"
            >
              {busy ? 'Connecting…' : 'Connect…'}
            </button>
          )}

          {/* Config picker — slides out to the LEFT because the parent
              popover sits at the right edge of the top bar. */}
          {pickerOpen && !isConnected && (
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
                      disabled={busy}
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

// Inline iOS-style toggle row used inside the popover. Kept private to
// this file because the styling is tuned for the popover's tighter
// vertical rhythm — VpnTab uses a slightly larger sibling for its own
// settings panel.
function ToggleRow({ label, hint, checked, onChange, disabled }) {
  return (
    <div className="flex items-center gap-2" title={hint}>
      <span className="text-[11px] text-[var(--color-text-primary)] truncate flex-1">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors disabled:opacity-50 cursor-pointer ${
          checked ? 'bg-[var(--color-accent)]' : 'bg-white/15'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-[14px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

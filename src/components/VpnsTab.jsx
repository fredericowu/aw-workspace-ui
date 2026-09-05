// Settings → General → VPNs — a profile manager AND the dialer control:
// upload/edit/delete VPN configs (WireGuard/OpenVPN), import from NordVPN,
// and connect/disconnect the tunnel this workspace's own egress goes
// through. Markup harvested from the legacy VpnTab.jsx/VpnNav.jsx (hanging
// off the OLD SettingsPanel), but the data layer is new — see
// src/lib/vpnApi.js for why the fetch plane differs from Networking's.
//
// Connect is per-profile; Disconnect is global — only one tunnel can be
// active at a time, so there is exactly one Disconnect control, not one per
// row (docs/architecture/vpn-profiles-in-general.md §2.7). Dialing moves
// THIS WORKSPACE CONTAINER's own outbound traffic and nothing else on the
// account. WireGuard/NordLynx is the supported path; an OpenVPN profile's
// Connect stays disabled — second-class per the architect's decision.
//
// The backend's three outcomes for connect/disconnect must never collapse
// into one generic toast — see VpnActionError in vpnApi.js:
//   - refusal — the host declined and changed nothing; render the sentence
//     verbatim, never paraphrase it.
//   - failure — something was attempted and did not work.
//   - timeout — the conversation didn't complete. A dead-man's switch on the
//     host can revert an unconfirmed change on its own, so this is NOT a
//     verdict either way — the only honest UI is "go look" (refresh status).
//
// Dial + confirm takes tens of seconds: while a connect/disconnect request
// is in flight, the whole action surface (Connect/Disconnect/delete/view)
// locks so a slow first click can't be read as "nothing happened" and
// doubled.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchConfigs, fetchConfig, saveConfig, uploadConfig, deleteConfig, fetchVpnStatus,
  fetchNordCredentials, saveNordCredentials, fetchNordCountries, fetchNordRecommendations,
  importNordServer, connectVpn, disconnectVpn, normalizeVpnStatus,
} from '../lib/vpnApi';

function Section({ title, description, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4 border border-[var(--color-border)] rounded overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[var(--color-bg-header)] hover:bg-white/5 transition-colors text-left"
      >
        <div>
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
          {description && <span className="text-xs text-[var(--color-text-muted)] ml-3">{description}</span>}
        </div>
        <span className="text-[var(--color-text-muted)] text-xs">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="border-t border-[var(--color-border)] p-4 bg-[var(--color-bg-primary)]">{children}</div>}
    </div>
  );
}

function Pill({ tone = 'muted', children }) {
  const tones = {
    muted: 'bg-white/5 text-[var(--color-text-muted)]',
    ok: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    err: 'bg-red-500/15 text-red-300',
    info: 'bg-sky-500/15 text-sky-300',
  };
  return (
    <span className={`inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Btn({ children, onClick, kind = 'default', disabled, title, type = 'button' }) {
  const kinds = {
    default: 'bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)]',
    primary: 'bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30 text-[var(--color-accent)]',
    danger: 'bg-red-500/15 hover:bg-red-500/25 text-red-300',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2.5 py-1 rounded text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${kinds[kind]}`}
    >
      {children}
    </button>
  );
}

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="mb-3 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-300 break-all">
      {message}
    </div>
  );
}

// ── Connection bar — the global, single source of "what is the workspace
// actually doing right now" — status is polled fresh after every action
// rather than inferred from that action's own response. ──────────────────

function ConnectionBar({ status, statusErr, actionPending, onDisconnect, onRefresh }) {
  const busy = !!actionPending;
  return (
    <div className="mb-3 px-3 py-2.5 rounded border border-[var(--color-border)] bg-[var(--color-bg-header)]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          {busy ? (
            <>
              <Pill tone="warn">
                {actionPending === '__disconnect__' ? 'Disconnecting…' : 'Connecting…'}
              </Pill>
              <span className="text-[var(--color-text-muted)]">
                {actionPending === '__disconnect__'
                  ? 'Tearing down the tunnel'
                  : `Dialing "${actionPending}"`} — this can take up to a minute. Every
                Connect/Disconnect control is locked until it finishes.
              </span>
            </>
          ) : status.unknown ? (
            <>
              <Pill tone="warn">Unknown</Pill>
              <span className="text-[var(--color-text-muted)]">
                the host won't say up or down right now — this is not "disconnected", refresh or go look
                rather than trust a guess.
              </span>
            </>
          ) : status.connected ? (
            <>
              <Pill tone="ok">Connected</Pill>
              <span className="text-[var(--color-text-muted)]">
                via <span className="font-mono">{status.profile || '(unknown profile)'}</span>
                {status.egressIp && (
                  <> — egress now <span className="font-mono">{status.egressIp}</span></>
                )} — this workspace's own outbound traffic is routed through this tunnel.
              </span>
            </>
          ) : (
            <>
              <Pill tone="muted">Not connected</Pill>
              <span className="text-[var(--color-text-muted)]">no tunnel is dialed from this workspace.</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Btn onClick={onRefresh} disabled={busy} title="Refresh status">Refresh</Btn>
          <Btn kind="danger" onClick={onDisconnect} disabled={busy || !status.connected}>
            {actionPending === '__disconnect__' ? 'Disconnecting…' : 'Disconnect'}
          </Btn>
        </div>
      </div>
      {status.detail && (
        <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">{status.detail}</div>
      )}
      {statusErr && (
        <div className="mt-2 text-[11px] text-amber-300">
          Status unavailable: {statusErr}. The state shown above may be stale.
        </div>
      )}
    </div>
  );
}

// ── The last connect/disconnect outcome — refusal, failure and timeout each
// get a visibly different banner; they must never collapse into one shape. ──

function ActionOutcomeBanner({ err }) {
  if (!err) return null;
  if (err.refused) {
    return (
      <div className="mb-3 px-3 py-2 rounded bg-sky-500/10 border border-sky-500/30 text-xs text-sky-200">
        <div className="font-semibold mb-0.5">Refused — nothing changed</div>
        {err.refusal || err.message}
      </div>
    );
  }
  if (err.timedOut) {
    return (
      <div className="mb-3 px-3 py-2 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
        <div className="font-semibold mb-0.5">Timed out — unknown state</div>
        {err.message} This is not a "connected" or "disconnected" verdict — refresh status above to see
        what the host actually did.
      </div>
    );
  }
  return (
    <div className="mb-3 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-300">
      <div className="font-semibold mb-0.5">Failed</div>
      {err.message}
    </div>
  );
}

// ── Profiles list ───────────────────────────────────────────────────────────

function ProfilesSection({ configs, loading, error, status, actionPending, onView, onDelete, onConnect }) {
  return (
    <Section title="Profiles" description={loading ? 'loading…' : `${configs.length} stored`} defaultOpen>
      <ErrorBanner message={error} />
      {!loading && configs.length === 0 && !error && (
        <div className="text-xs text-[var(--color-text-muted)] py-3">
          No profiles yet. Add one below — upload a file, paste a config, or import from NordVPN.
        </div>
      )}
      {configs.length > 0 && (
        <table className="w-full text-xs">
          <thead className="text-[var(--color-text-muted)]">
            <tr className="border-b border-[var(--color-border)]">
              <th className="text-left py-1.5">Name</th>
              <th className="text-left py-1.5">Type</th>
              <th className="text-left py-1.5">Source</th>
              <th className="text-left py-1.5">Endpoint</th>
              <th className="text-right py-1.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => {
              const isOpenvpn = c.type === 'openvpn';
              const isConnectedHere = status.connected && status.profile === c.name;
              const isConnectingHere = actionPending === c.name;
              const busy = !!actionPending;
              const connectDisabled = busy || isOpenvpn || (status.connected && !isConnectedHere);
              const connectTitle = isOpenvpn
                ? 'OpenVPN profiles are stored but second-class — WireGuard/NordLynx is the supported dialing path.'
                : status.connected && !isConnectedHere
                  ? 'Only one tunnel can be active — disconnect the current one first.'
                  : undefined;
              return (
                <tr key={c.name} className="border-b border-[var(--color-border)]/40">
                  <td className="py-1.5 font-mono">{c.name}</td>
                  <td className="py-1.5"><Pill tone={isOpenvpn ? 'warn' : 'info'}>{c.type}</Pill></td>
                  <td className="py-1.5 text-[var(--color-text-muted)]">{c.source || 'disk'}</td>
                  <td className="py-1.5 font-mono text-[var(--color-text-muted)]">{c.endpoint || '—'}</td>
                  <td className="py-1.5 text-right">
                    <div className="inline-flex gap-1.5">
                      {isConnectedHere ? (
                        <Pill tone="ok">Connected</Pill>
                      ) : (
                        <Btn kind="primary" onClick={() => onConnect(c.name)} disabled={connectDisabled} title={connectTitle}>
                          {isConnectingHere ? 'Connecting…' : 'Connect'}
                        </Btn>
                      )}
                      <Btn onClick={() => onView(c.name)} disabled={busy}>View / edit</Btn>
                      <Btn kind="danger" onClick={() => onDelete(c.name)} title="Delete profile" disabled={busy}>×</Btn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

// ── View/edit modal ─────────────────────────────────────────────────────────
//
// GET returns the stored body REDACTED (no private key over HTTP — see
// docs/architecture/vpn-profiles-in-general.md §2.4). The redacted text is
// shown read-only for reference; replacing the profile means pasting a whole
// new body, never editing the redacted one in place.

function ConfigViewer({ name, onClose, onSaved }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [type, setType] = useState('wireguard');
  const [replacement, setReplacement] = useState('');
  const [saveErr, setSaveErr] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchConfig(name);
        if (cancelled) return;
        setMeta(data);
        setType(data.type || 'wireguard');
      } catch (e) {
        if (!cancelled) setLoadErr(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [name]);

  const save = async () => {
    if (!replacement.trim()) { setSaveErr('paste the replacement config first'); return; }
    setSaving(true);
    setSaveErr(null);
    try {
      await saveConfig(name, { type, content: replacement });
      onSaved();
      onClose();
    } catch (e) {
      // Rejection is a feature — show the server's named error verbatim.
      setSaveErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded w-[800px] max-w-[95vw] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="text-sm font-semibold">Profile: <span className="font-mono">{name}</span></div>
          <Btn onClick={onClose}>Close</Btn>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-xs text-[var(--color-text-muted)]">loading…</div>
          ) : loadErr ? (
            <div className="text-xs text-red-300">{loadErr}</div>
          ) : (
            <>
              <div className="text-xs text-[var(--color-text-muted)] mb-2">
                Type: <Pill tone="info">{meta.type || type}</Pill>
                {meta.created_at && <span className="ml-3">Created: {meta.created_at}</span>}
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)] mb-1">
                Stored body (key material redacted — never sent to the browser):
              </div>
              <textarea
                value={meta.content ?? meta.body ?? ''}
                readOnly
                spellCheck={false}
                className="w-full h-32 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded p-2 text-xs font-mono opacity-70 mb-4"
              />
              <div className="text-[11px] text-[var(--color-text-muted)] mb-1">
                Replace with a new config (paste the full text — this does not merge with the above):
              </div>
              {saveErr && <div className="mb-2 text-xs text-red-300 break-all">{saveErr}</div>}
              <textarea
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                spellCheck={false}
                className="w-full h-40 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded p-2 text-xs font-mono"
              />
            </>
          )}
        </div>
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" onClick={save} disabled={saving || loading || !!loadErr}>
            {saving ? 'Saving…' : 'Save replacement'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Add new: file upload + paste ───────────────────────────────────────────

function AddNewSection({ onSaved }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('wireguard');
  const [content, setContent] = useState('');
  const [err, setErr] = useState(null);
  const fileInputRef = useRef(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    try {
      const auto = file.name.toLowerCase().endsWith('.ovpn') ? 'openvpn' : 'wireguard';
      await uploadConfig(file, { name: name || file.name.replace(/\.[^.]+$/, ''), type: auto });
      onSaved();
      setName('');
      e.target.value = '';
    } catch (ex) {
      // A rejected profile's named error, verbatim.
      setErr(ex.message);
    }
  };

  const onPasteSave = async () => {
    setErr(null);
    if (!name) { setErr('profile name required'); return; }
    if (!content.trim()) { setErr('paste a config first'); return; }
    try {
      await saveConfig(name, { type, content });
      onSaved();
      setName('');
      setContent('');
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <Section title="Add new" description="Upload a file or paste a config" defaultOpen={false}>
      <ErrorBanner message={err} />

      <div className="grid grid-cols-2 gap-3 mb-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="profile name (alphanumeric, ≤30 chars)"
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs"
        >
          <option value="wireguard">WireGuard (.conf)</option>
          <option value="openvpn">OpenVPN (.ovpn)</option>
        </select>
      </div>

      <div className="mb-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".conf,.ovpn,text/plain"
          onChange={onFile}
          className="hidden"
        />
        <Btn onClick={() => fileInputRef.current?.click()}>Upload file…</Btn>
        <span className="ml-2 text-xs text-[var(--color-text-muted)]">
          .conf for WireGuard, .ovpn for OpenVPN — type auto-detected.
        </span>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        placeholder="…or paste config text here"
        className="w-full h-40 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded p-2 text-xs font-mono mb-2"
      />

      <Btn kind="primary" onClick={onPasteSave}>Save pasted profile</Btn>
    </Section>
  );
}

// ── NordVPN card ─────────────────────────────────────────────────────────

function NordSection({ onImported }) {
  const [creds, setCreds] = useState({ username: '', password: '' });
  const [credsSet, setCredsSet] = useState(false);
  const [credsDirty, setCredsDirty] = useState(false);
  const [credsErr, setCredsErr] = useState(null);
  const [credsLoadErr, setCredsLoadErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const [countries, setCountries] = useState([]);
  const [countryId, setCountryId] = useState('');
  const [protocol, setProtocol] = useState('udp');
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const presence = await fetchNordCredentials();
        // The contract guarantees presence-only (never the password); it
        // does not pin exact field names, so treat any truthy "is a
        // credential configured" signal as stored — defaulting to "not set"
        // on an unrecognized shape errs toward re-entering, never toward a
        // false "stored" that hides a save the user still needs to make.
        setCredsSet(!!(presence?.set || presence?.username_set || presence?.configured || presence?.username));
      } catch (e) {
        setCredsLoadErr(e.message);
      }
      try {
        setCountries(await fetchNordCountries());
      } catch (e) {
        setErr(`couldn't load Nord country list: ${e.message}`);
      }
    })();
  }, []);

  const refreshServers = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setServers(await fetchNordRecommendations(countryId));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => { refreshServers(); }, [refreshServers]);

  const saveCreds = async () => {
    setSaving(true);
    setCredsErr(null);
    try {
      await saveNordCredentials({ username: creds.username, password: creds.password });
      setCredsSet(true);
      setCredsDirty(false);
      // The password never round-trips back from the server — clear the
      // local field too, rather than leaving it sitting in state as if it
      // were still meaningful after a successful save.
      setCreds((c) => ({ ...c, password: '' }));
    } catch (e) {
      setCredsErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const importServer = async (s) => {
    setErr(null);
    try {
      await importNordServer({ hostname: s.hostname, protocol });
      onImported();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <Section title="NordVPN" description="Credentials + browse servers, import as a profile" defaultOpen={false}>
      {/* Service credentials — write-only. GET only ever tells us whether
          something is stored, never what it is. */}
      <div className="mb-4">
        <div className="text-xs font-semibold mb-1">
          Service credentials{' '}
          {credsSet ? <Pill tone="ok">stored</Pill> : <Pill tone="warn">not set</Pill>}
        </div>
        {credsLoadErr && (
          <div className="mb-2 text-[11px] text-red-300">Could not check stored credentials: {credsLoadErr}</div>
        )}
        <div className="text-[10px] text-[var(--color-text-muted)] mb-2">
          NordVPN uses separate <em>service</em> credentials (not your account login).
          Find them at{' '}
          <a
            href="https://my.nordaccount.com/dashboard/nordvpn/manual-setup/"
            target="_blank" rel="noreferrer"
            className="text-[var(--color-accent)] underline"
          >
            my.nordaccount.com → Manual setup
          </a>
          . The password is never sent back to this screen once saved.
        </div>
        {credsErr && <div className="mb-2 text-xs text-red-300 break-all">{credsErr}</div>}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            type="text"
            placeholder="service username"
            value={creds.username}
            onChange={(e) => { setCreds({ ...creds, username: e.target.value }); setCredsDirty(true); }}
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs"
          />
          <input
            type="password"
            placeholder="service password"
            value={creds.password}
            onChange={(e) => { setCreds({ ...creds, password: e.target.value }); setCredsDirty(true); }}
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs"
          />
        </div>
        <Btn kind="primary" onClick={saveCreds} disabled={!credsDirty || saving}>
          {saving ? 'Saving…' : 'Save credentials'}
        </Btn>
      </div>

      {/* Country / protocol + recommendations */}
      <div className="border-t border-[var(--color-border)] pt-3">
        {err && <div className="mb-3 text-xs text-red-300 break-all">{err}</div>}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <select
            value={countryId}
            onChange={(e) => setCountryId(e.target.value)}
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs"
          >
            <option value="">Any country</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs"
          >
            <option value="udp">UDP (faster)</option>
            <option value="tcp">TCP (more reliable)</option>
          </select>
        </div>

        {loading ? (
          <div className="text-xs text-[var(--color-text-muted)]">searching…</div>
        ) : servers.length === 0 ? (
          <div className="text-xs text-[var(--color-text-muted)]">no servers found — try a different country</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[var(--color-text-muted)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-1.5">Server</th>
                <th className="text-left py-1.5">Location</th>
                <th className="text-left py-1.5">Load</th>
                <th className="text-right py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => (
                <tr key={s.hostname} className="border-b border-[var(--color-border)]/40">
                  <td className="py-1.5 font-mono">{s.hostname}</td>
                  <td className="py-1.5 text-[var(--color-text-muted)]">
                    {[s.city, s.country].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="py-1.5">
                    <Pill tone={s.load < 30 ? 'ok' : s.load < 70 ? 'warn' : 'err'}>{s.load ?? '?'}%</Pill>
                  </td>
                  <td className="py-1.5 text-right">
                    <Btn kind="primary" onClick={() => importServer(s)}>Import</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Section>
  );
}

// ── Top-level component ────────────────────────────────────────────────────

export default function VpnsTab() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState(null);
  const [viewing, setViewing] = useState(null);

  const [status, setStatus] = useState({ connected: false, profile: null });
  // Set only if GET /api/vpn/status itself fails to answer — a written
  // reason the plane/route isn't reachable, never a fabricated tunnel state.
  const [statusErr, setStatusErr] = useState(null);

  // The profile name being dialed, '__disconnect__' while tearing down, or
  // null when idle. Locks the whole action surface — see the header comment.
  const [actionPending, setActionPending] = useState(null);
  // The last connect/disconnect VpnActionError (refusal/failure/timeout), or
  // null. Cleared at the start of the next action, not on every render, so
  // the outcome stays visible until the user tries again.
  const [actionErr, setActionErr] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setConfigs(await fetchConfigs());
      setListErr(null);
    } catch (e) {
      setListErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const data = await fetchVpnStatus();
      setStatus(normalizeVpnStatus(data));
      setStatusErr(null);
    } catch (e) {
      setStatusErr(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshStatus();
  }, [refresh, refreshStatus]);

  const remove = async (name) => {
    if (!window.confirm(`Delete profile "${name}"? This cannot be undone.`)) return;
    try {
      await deleteConfig(name);
      refresh();
    } catch (e) {
      setListErr(e.message);
    }
  };

  // Shared by connect and disconnect: lock the surface, run the call, and —
  // whatever the outcome (success, refusal, failure, or timeout) — always
  // re-poll status rather than trust the action response's own claim. A
  // timeout in particular tells us nothing about the real state; only the
  // status endpoint (backed by the host's own dead-man's switch) does.
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

  const connect = (name) => runAction(name, () => connectVpn(name));
  const disconnect = () => runAction('__disconnect__', () => disconnectVpn());

  const configCount = useMemo(() => configs.length, [configs]);

  return (
    <div className="p-4 max-w-3xl">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">VPNs</h2>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Store, edit and validate VPN profiles (WireGuard/OpenVPN configs, including NordVPN
          imports) — {configCount} on file. Connecting dials the selected profile and routes this
          workspace's own outbound traffic through it — nothing else on your account moves.
          WireGuard/NordLynx is the supported dialing path; OpenVPN profiles are stored but their
          Connect stays disabled for now, second-class. This is a different screen from Settings →
          General → Networking → External VPNs, which only shows what a remote host is already
          dialing and cannot start or stop anything — this one is the one that actually connects.
        </p>
      </div>

      <ConnectionBar
        status={status}
        statusErr={statusErr}
        actionPending={actionPending}
        onDisconnect={disconnect}
        onRefresh={refreshStatus}
      />

      <ActionOutcomeBanner err={actionErr} />

      <ProfilesSection
        configs={configs}
        loading={loading}
        error={listErr}
        status={status}
        actionPending={actionPending}
        onView={setViewing}
        onDelete={remove}
        onConnect={connect}
      />

      <AddNewSection onSaved={refresh} />

      <NordSection onImported={refresh} />

      {viewing && (
        <ConfigViewer name={viewing} onClose={() => setViewing(null)} onSaved={refresh} />
      )}
    </div>
  );
}

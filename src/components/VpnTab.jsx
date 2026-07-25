import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../auth';

// ─────────────────────────────────────────────────────────────────────────────
// Settings → VPN
//
// Three sections:
//   1. Status   — current tunnel state, public IP, kill switch toggle
//   2. Configs  — list of saved configs (from disk, GHA artifact, uploads,
//                 Nord). Activate / stop / delete / view-edit.
//   3. Add new  — paste/upload your own .conf/.ovpn, OR pick a NordVPN server.
//
// Connect actions require explicit confirmation since flipping the VPN can
// instantly change the container's egress path (or block it, with kill
// switch on).
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, description, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4 border border-[var(--color-border)] rounded overflow-hidden">
      <button
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

// iOS-style sliding toggle. Tooltip carries the long explanation —
// the row itself stays a clean one-liner.
function Toggle({ checked, onChange, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      onClick={() => onChange(!checked)}
      title={title}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-[var(--color-accent)]' : 'bg-white/15'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function Btn({ children, onClick, kind = 'default', disabled, title }) {
  const kinds = {
    default: 'bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)]',
    primary: 'bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30 text-[var(--color-accent)]',
    danger: 'bg-red-500/15 hover:bg-red-500/25 text-red-300',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2.5 py-1 rounded text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${kinds[kind]}`}
    >
      {children}
    </button>
  );
}

// ── API helpers ────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await apiFetch(path, opts);
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).detail || '';
    } catch (_e) {
      detail = await res.text();
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}

async function uploadConfig(name, type, file) {
  const fd = new FormData();
  fd.append('type', type);
  if (name) fd.append('name', name);
  fd.append('file', file);
  const res = await apiFetch('/api/vpn/configs/upload', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json();
}

// ── Status section ─────────────────────────────────────────────────────────

function StatusSection({ status, publicIp, onRefresh, onVpnOnly, onAutoStart, onStop }) {
  const active = status?.active;
  // Server returns both `vpn_only` (current) and `kill_switch` (legacy alias).
  // Prefer the new key; fall back so we don't desync if the API is slow to roll.
  const vpnOnly = status?.vpn_only ?? status?.kill_switch;
  const autoStart = !!status?.auto_start;
  const ifaces = status?.interfaces || [];
  const tunneled = !!status?.tunneled;

  // Spinning state for the inline refresh icon — visual feedback that the
  // status fetch is in-flight. Cleared by the parent's refresh resolving.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    try { await onRefresh?.(); }
    finally { setRefreshing(false); }
  };

  return (
    <Section title="Status" description="Current tunnel + firewall" defaultOpen>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs mb-3">
        <div className="text-[var(--color-text-muted)]">Active config</div>
        <div className="font-mono flex items-center gap-1.5">
          {active ? (
            <>
              <Pill tone={tunneled ? 'ok' : 'warn'}>{tunneled ? 'connected' : 'starting…'}</Pill>
              <span>{active}</span>
            </>
          ) : (
            <Pill tone="muted">disconnected</Pill>
          )}
          {/* Inline force-refresh — sits next to the status pill so users
              can re-sync without scrolling to the section's footer button. */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh status now"
            aria-label="Refresh VPN status"
            className="ml-1 p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-white/5 cursor-pointer disabled:opacity-50"
          >
            <svg
              className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>

        <div className="text-[var(--color-text-muted)]">Interfaces</div>
        <div className="font-mono">
          {ifaces.length === 0 ? '—' : ifaces.map((i) => `${i.name}${i.up ? '↑' : '↓'}`).join(', ')}
        </div>

        <div className="text-[var(--color-text-muted)]">Public IP</div>
        <div className="font-mono">
          {publicIp?.ip ?? <span className="text-[var(--color-text-muted)]">checking…</span>}
        </div>

        <div className="text-[var(--color-text-muted)]">Allow VPN traffic only</div>
        <Toggle
          checked={!!vpnOnly}
          onChange={onVpnOnly}
          title="When on, firewall REJECTs egress that's not via the tunnel (lo + RFC1918 still allowed). Sticky across stop/start."
        />

        <div className="text-[var(--color-text-muted)]">Auto-start on boot</div>
        <Toggle
          checked={autoStart}
          onChange={onAutoStart}
          title={`When on, the entrypoint brings up "${active ?? 'active config'}" before awserv (no leak window).`}
        />
      </div>

      <div className="flex gap-2">
        <Btn onClick={onRefresh}>Refresh</Btn>
        {active && (
          <Btn kind="danger" onClick={onStop}>Disconnect</Btn>
        )}
      </div>
    </Section>
  );
}

// ── Configs list ───────────────────────────────────────────────────────────

function ConfigsSection({ configs, status, onActivate, onStop, onDelete, onView }) {
  return (
    <Section
      title="Configs"
      description={`${configs.length} saved`}
      defaultOpen
    >
      {configs.length === 0 ? (
        <div className="text-xs text-[var(--color-text-muted)] py-3">
          No configs yet. Add one below — upload a file, paste a config, or pick a NordVPN server.
        </div>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-[var(--color-text-muted)]">
            <tr className="border-b border-[var(--color-border)]">
              <th className="text-left py-1.5">Name</th>
              <th className="text-left py-1.5">Type</th>
              <th className="text-left py-1.5">Source</th>
              <th className="text-left py-1.5">State</th>
              <th className="text-right py-1.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => {
              const isActive = status?.active === c.name;
              return (
                <tr key={c.name} className="border-b border-[var(--color-border)]/40">
                  <td className="py-1.5 font-mono">{c.name}</td>
                  <td className="py-1.5">
                    <Pill tone="info">{c.type}</Pill>
                  </td>
                  <td className="py-1.5 text-[var(--color-text-muted)]">{c.source || 'disk'}</td>
                  <td className="py-1.5">
                    {isActive ? <Pill tone="ok">active</Pill> : <Pill tone="muted">idle</Pill>}
                  </td>
                  <td className="py-1.5 text-right">
                    <div className="inline-flex gap-1.5">
                      <Btn onClick={() => onView(c.name)}>View / edit</Btn>
                      {isActive ? (
                        <Btn kind="danger" onClick={onStop}>Stop</Btn>
                      ) : (
                        <Btn kind="primary" onClick={() => onActivate(c.name)}>Connect</Btn>
                      )}
                      <Btn kind="danger" onClick={() => onDelete(c.name)} title="Delete config">×</Btn>
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

// ── Editor modal ────────────────────────────────────────────────────────────

function ConfigEditor({ name, onClose, onSave }) {
  const [content, setContent] = useState('');
  const [type, setType] = useState('wireguard');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api('GET', `/api/vpn/configs/${encodeURIComponent(name)}`);
        if (cancelled) return;
        setContent(data.content || '');
        setType(data.type || 'wireguard');
      } catch (e) {
        setErr(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [name]);

  const save = async () => {
    try {
      await api('PUT', `/api/vpn/configs/${encodeURIComponent(name)}`, { type, content });
      onSave();
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded w-[800px] max-w-[95vw] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
          <div className="text-sm font-semibold">Edit: <span className="font-mono">{name}</span></div>
          <Btn onClick={onClose}>Close</Btn>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-xs text-[var(--color-text-muted)]">loading…</div>
          ) : (
            <>
              {err && <div className="mb-3 text-xs text-red-300">{err}</div>}
              <div className="text-xs text-[var(--color-text-muted)] mb-2">
                Type: <Pill tone="info">{type}</Pill>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="w-full h-96 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded p-2 text-xs font-mono"
              />
            </>
          )}
        </div>
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" onClick={save}>Save</Btn>
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
      await uploadConfig(name || file.name.replace(/\.[^.]+$/, ''), auto, file);
      onSaved();
      setName('');
      e.target.value = '';
    } catch (ex) {
      setErr(ex.message);
    }
  };

  const onPasteSave = async () => {
    setErr(null);
    if (!name) { setErr('config name required'); return; }
    if (!content.trim()) { setErr('paste a config first'); return; }
    try {
      await api('PUT', `/api/vpn/configs/${encodeURIComponent(name)}`, { type, content });
      onSaved();
      setName('');
      setContent('');
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <Section title="Add new" description="Upload a file or paste a config" defaultOpen={false}>
      {err && <div className="mb-3 text-xs text-red-300">{err}</div>}

      <div className="grid grid-cols-2 gap-3 mb-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="config name (alphanumeric, ≤30 chars)"
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
        className="w-full h-48 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded p-2 text-xs font-mono mb-2"
      />

      <Btn kind="primary" onClick={onPasteSave}>Save pasted config</Btn>
    </Section>
  );
}

// ── NordVPN picker ─────────────────────────────────────────────────────────

function NordSection({ onImported }) {
  const [creds, setCreds] = useState({ username: '', password: '', set: false });
  const [credsDirty, setCredsDirty] = useState(false);
  // Token presence flag — drives whether the Dedicated IPs subsection can
  // load. The token itself is never sent to the browser.
  const [tokenSet, setTokenSet] = useState(false);

  const [countries, setCountries] = useState([]);
  const [countryId, setCountryId] = useState('');
  const [cityId, setCityId] = useState('');
  const [protocol, setProtocol] = useState('udp');
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  // Dedicated IPs — Nord account-bound list, fetched via the access token.
  const [dedicatedIps, setDedicatedIps] = useState(null);  // null = not yet loaded
  const [dedicatedLoading, setDedicatedLoading] = useState(false);
  const [dedicatedErr, setDedicatedErr] = useState(null);

  // Load creds-set flag + countries
  useEffect(() => {
    (async () => {
      try {
        const settings = await api('GET', '/api/vpn/settings');
        setCreds((c) => ({ ...c, set: !!settings.nord_username_set }));
        setTokenSet(!!settings.nord_token_set);
      } catch (_e) {/* ignore */}
      try {
        const data = await api('GET', '/api/vpn/nord/countries');
        setCountries(data.countries || []);
      } catch (e) {
        setErr(`couldn't load Nord country list: ${e.message}`);
      }
    })();
  }, []);

  const cities = useMemo(() => {
    const c = countries.find((x) => String(x.id) === String(countryId));
    return c?.cities || [];
  }, [countries, countryId]);

  const refreshServers = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ limit: 15 });
      if (countryId) params.set('country_id', countryId);
      if (cityId) params.set('city_id', cityId);
      const data = await api('GET', `/api/vpn/nord/recommendations?${params}`);
      setServers(data.servers || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [countryId, cityId]);

  useEffect(() => { refreshServers(); }, [refreshServers]);

  // Dedicated IPs loader — separate from the recommendations flow because
  // it hits a different (auth-gated) endpoint and only makes sense when the
  // user has a Nord access token configured.
  const refreshDedicatedIps = useCallback(async () => {
    setDedicatedLoading(true);
    setDedicatedErr(null);
    try {
      const data = await api('GET', '/api/vpn/nord/dedicated-ips');
      setDedicatedIps(data.servers || []);
    } catch (e) {
      setDedicatedErr(e.message);
      setDedicatedIps([]);  // fall out of "loading" placeholder
    } finally {
      setDedicatedLoading(false);
    }
  }, []);

  // Auto-load once the token is known to be set; re-run if the token state
  // flips (e.g. user just saved a token elsewhere).
  useEffect(() => {
    if (tokenSet) refreshDedicatedIps();
  }, [tokenSet, refreshDedicatedIps]);

  // Import a dedicated IP server as a local OpenVPN config — same endpoint
  // the recommendations table uses, just driven from a different row.
  const importDedicated = async (s) => {
    if (!s?.hostname) return;
    setDedicatedErr(null);
    try {
      await api('POST', '/api/vpn/nord/import', {
        hostname: s.hostname, protocol,
      });
      onImported();
    } catch (e) {
      setDedicatedErr(e.message);
    }
  };

  const saveCreds = async () => {
    try {
      await api('PUT', '/api/vpn/settings/nord-credentials', {
        username: creds.username, password: creds.password,
      });
      setCreds({ ...creds, set: true });
      setCredsDirty(false);
    } catch (e) {
      setErr(e.message);
    }
  };

  const importServer = async (s) => {
    setErr(null);
    try {
      await api('POST', '/api/vpn/nord/import', {
        hostname: s.hostname, protocol,
      });
      onImported();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <Section
      title="NordVPN"
      description="Browse Nord servers + import as OpenVPN configs"
      defaultOpen={false}
    >
      {err && <div className="mb-3 text-xs text-red-300">{err}</div>}

      {/* Service credentials */}
      <div className="mb-4">
        <div className="text-xs font-semibold mb-1">
          Service credentials{' '}
          {creds.set ? <Pill tone="ok">stored</Pill> : <Pill tone="warn">not set</Pill>}
        </div>
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
          . Required to actually connect to Nord servers.
        </div>
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
        <Btn kind="primary" onClick={saveCreds} disabled={!credsDirty}>Save credentials</Btn>
      </div>

      {/* Dedicated IPs — only meaningful when the access token is set.
          Resolved server-side via /v1/users/services + /v1/servers. */}
      <div className="mb-4 border-t border-[var(--color-border)] pt-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-xs font-semibold">Dedicated IPs</div>
          <button
            type="button"
            onClick={refreshDedicatedIps}
            disabled={dedicatedLoading || !tokenSet}
            title={tokenSet ? 'Refresh dedicated IPs' : 'Set the Nord access token first'}
            aria-label="Refresh dedicated IPs"
            className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:bg-white/5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg
              className={`w-3.5 h-3.5 ${dedicatedLoading ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          {dedicatedIps && (
            <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
              {dedicatedIps.length} server{dedicatedIps.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)] mb-2">
          Servers assigned to your account from{' '}
          <a
            href="https://my.nordaccount.com/dashboard/nordvpn/dedicated-ip/"
            target="_blank" rel="noreferrer"
            className="text-[var(--color-accent)] underline"
          >
            my.nordaccount.com → Dedicated IP
          </a>
          . Import as an OpenVPN config to connect.
        </div>

        {dedicatedErr && (
          <div className="mb-2 text-xs text-red-300">{dedicatedErr}</div>
        )}

        {!tokenSet ? (
          <div className="text-[11px] text-[var(--color-text-muted)] italic">
            Nord access token not set — can't list dedicated IPs.
          </div>
        ) : dedicatedIps === null || dedicatedLoading ? (
          <div className="text-xs text-[var(--color-text-muted)]">loading…</div>
        ) : dedicatedIps.length === 0 ? (
          <div className="text-[11px] text-[var(--color-text-muted)] italic">
            No dedicated IPs found on this account.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[var(--color-text-muted)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left py-1.5">Hostname</th>
                <th className="text-left py-1.5">IP</th>
                <th className="text-left py-1.5">Location</th>
                <th className="text-left py-1.5">Load</th>
                <th className="text-right py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {dedicatedIps.map((s) => (
                <tr key={s.id} className="border-b border-[var(--color-border)]/40">
                  <td className="py-1.5 font-mono">
                    {s.hostname || <span className="text-[var(--color-text-muted)]">unknown</span>}
                  </td>
                  <td className="py-1.5 font-mono">
                    {s.ip || <span className="text-[var(--color-text-muted)]">—</span>}
                  </td>
                  <td className="py-1.5 text-[var(--color-text-muted)]">
                    {[s.city, s.country].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="py-1.5">
                    {typeof s.load === 'number' ? (
                      <Pill tone={s.load < 30 ? 'ok' : s.load < 70 ? 'warn' : 'err'}>{s.load}%</Pill>
                    ) : (
                      <Pill tone="muted">?</Pill>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    <Btn
                      kind="primary"
                      onClick={() => importDedicated(s)}
                      disabled={!s.hostname}
                    >
                      Import
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Country / city / protocol */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <select
          value={countryId}
          onChange={(e) => { setCountryId(e.target.value); setCityId(''); }}
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs"
        >
          <option value="">Any country</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={cityId}
          onChange={(e) => setCityId(e.target.value)}
          disabled={!countryId}
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs disabled:opacity-40"
        >
          <option value="">Any city</option>
          {cities.map((c) => (
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

      {/* Recommendations table */}
      {loading ? (
        <div className="text-xs text-[var(--color-text-muted)]">searching…</div>
      ) : servers.length === 0 ? (
        <div className="text-xs text-[var(--color-text-muted)]">no servers found — try different filters</div>
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
    </Section>
  );
}

// ── Server: static reference for the shared WireGuard server ───────────────
//
// This is documentation, not a live control panel — the server (repo `vpn`,
// deployed onto aw.tekflox.com by the "Start VPN Server" GitHub Actions
// workflow) has no API exposed to aw-sandbox. Client-side (VpnManager /
// this whole file above) only manages tunnels this container connects OUT
// to; it has no way to reach into that server's config.

function CodeBlock({ children }) {
  return (
    <pre className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded p-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap">
      {children}
    </pre>
  );
}

function ServerPane() {
  return (
    <div className="p-4">
      <Section title="Overview" description="repo vpn → aw.tekflox.com" defaultOpen>
        <div className="text-xs text-[var(--color-text-muted)] space-y-1">
          <p>
            A WireGuard server runs directly on the shared Hetzner host
            (<span className="font-mono">aw.tekflox.com</span>) — deployed via
            the <span className="font-mono">repos/vpn</span> repo, not managed
            from this UI. It gives external devices (like a Mac) a private
            route into the server's internal network.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
            <div>Subnet</div><div className="font-mono text-[var(--color-text-primary)]">10.8.0.0/24</div>
            <div>Server IP</div><div className="font-mono text-[var(--color-text-primary)]">10.8.0.1</div>
            <div>Port</div><div className="font-mono text-[var(--color-text-primary)]">51820/UDP</div>
            <div>Endpoint</div><div className="font-mono text-[var(--color-text-primary)]">aw.tekflox.com:51820</div>
          </div>
        </div>
      </Section>

      <Section title="Add a new client" description="GitHub Actions — repo vpn" defaultOpen>
        <div className="text-xs text-[var(--color-text-muted)] space-y-2">
          <p>Run the "Start VPN Server" workflow with a higher client count. It's idempotent — existing clients keep their keys, only the new slot is generated.</p>
          <CodeBlock>{`gh workflow run start-vpn.yml \\
  --repo <org>/vpn \\
  -f provider=hetzner \\
  -f client_count=<N+1>   # bump from current count
  -f refresh_clients=false`}</CodeBlock>
          <p>Download the <span className="font-mono">wireguard-configs</span> artifact from the run — it contains <span className="font-mono">client_&lt;N&gt;.conf</span> plus a QR code (<span className="font-mono">client_&lt;N&gt;-qr.png</span>).</p>
        </div>
      </Section>

      <Section title="Split-tunnel (internal-only) client" description="only route the server's subnet through the VPN" defaultOpen>
        <div className="text-xs text-[var(--color-text-muted)] space-y-2">
          <p>
            The generated <span className="font-mono">client_&lt;N&gt;.conf</span> defaults to full-tunnel
            (<span className="font-mono">AllowedIPs = 0.0.0.0/0, ::/0</span>) — all traffic goes through the VPN.
            To make it internal-only (normal internet stays on the regular route, only <span className="font-mono">10.8.0.0/24</span> goes
            through the tunnel), edit one line before importing:
          </p>
          <CodeBlock>{`[Peer]
PublicKey = <server public key, from the .conf>
Endpoint = aw.tekflox.com:51820
AllowedIPs = 10.8.0.0/24   # ← only this line changes (was 0.0.0.0/0, ::/0)
PersistentKeepalive = 25`}</CodeBlock>
        </div>
      </Section>

      <Section title="Enable on your device" description="macOS / Windows / Linux" defaultOpen={false}>
        <div className="text-xs text-[var(--color-text-muted)] space-y-4">
          <div>
            <div className="font-semibold text-[var(--color-text-primary)] mb-1">macOS</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Install <span className="font-mono">WireGuard</span> from the Mac App Store.</li>
              <li>Open the app → <span className="font-mono">+</span> → "Import tunnel(s) from file…" and pick the edited <span className="font-mono">.conf</span> (or scan the QR code with "Create from QR code" on iOS).</li>
              <li>Toggle the tunnel on. Only requests to <span className="font-mono">10.8.0.0/24</span> route through it; everything else keeps using your normal connection.</li>
            </ol>
          </div>
          <div>
            <div className="font-semibold text-[var(--color-text-primary)] mb-1">Windows</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Install the <span className="font-mono">WireGuard</span> app from wireguard.com/install.</li>
              <li>"Import tunnel(s) from file" → pick the <span className="font-mono">.conf</span> → Activate.</li>
            </ol>
          </div>
          <div>
            <div className="font-semibold text-[var(--color-text-primary)] mb-1">Linux</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li><span className="font-mono">sudo apt install wireguard</span> (or your distro's equivalent).</li>
              <li>Copy the file to <span className="font-mono">/etc/wireguard/wg0.conf</span> and run <span className="font-mono">sudo wg-quick up wg0</span> (or import into NetworkManager).</li>
            </ol>
          </div>
        </div>
      </Section>
    </div>
  );
}

// ── Top-level component ────────────────────────────────────────────────────

function ClientPane() {
  const [status, setStatus] = useState(null);
  const [publicIp, setPublicIp] = useState(null);
  const [configs, setConfigs] = useState([]);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        api('GET', '/api/vpn/status'),
        api('GET', '/api/vpn/configs'),
      ]);
      setStatus(s);
      setConfigs(c.configs || []);
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
    api('GET', '/api/vpn/public-ip').then(setPublicIp).catch(() => setPublicIp(null));
  }, []);

  // Status updates arrive via /ws/status (dispatched as `aw-vpn-update`
  // by useComponentStatus when the server's VpnPoller broadcasts).
  // One initial fetch to populate the page on cold load — that hits
  // the cache, no subprocess calls. Configs list isn't push-driven so
  // it only refreshes on mount + on user actions (start/stop/save).
  useEffect(() => {
    refresh();
    const onUpdate = (e) => {
      const { type, ...rest } = e.detail || {};
      setStatus((prev) => ({ ...(prev || {}), ...rest }));
    };
    window.addEventListener('aw-vpn-update', onUpdate);
    return () => window.removeEventListener('aw-vpn-update', onUpdate);
  }, [refresh]);

  const activate = async (name) => {
    const vpnOnly = status?.vpn_only ?? status?.kill_switch;
    if (!confirm(
      `Connect through "${name}"?\n\n` +
      `This routes ALL of aw-sandbox's outbound traffic through the VPN.\n` +
      (vpnOnly
        ? `"Allow VPN traffic only" is ON — if the tunnel drops, no internet at all.\n`
        : `"Allow VPN traffic only" is off — egress falls back to default if tunnel drops.\n`) +
      `\nThe AW UI itself stays reachable (Caddy → aw-sandbox is local).`
    )) return;
    try {
      await api('POST', '/api/vpn/start', { name });
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  };

  const stop = async () => {
    try {
      await api('POST', '/api/vpn/stop');
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (name) => {
    if (!confirm(`Delete config "${name}"? This cannot be undone.`)) return;
    try {
      await api('DELETE', `/api/vpn/configs/${encodeURIComponent(name)}`);
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  };

  const setVpnOnly = async (enabled) => {
    try {
      await api('PUT', '/api/vpn/settings/vpn-only', { enabled });
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  };

  const setAutoStart = async (enabled) => {
    try {
      await api('PUT', '/api/vpn/settings/auto-start', { enabled });
      refresh();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="p-4">
      {err && (
        <div className="mb-3 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {err}
        </div>
      )}

      <StatusSection
        status={status}
        publicIp={publicIp}
        onRefresh={refresh}
        onVpnOnly={setVpnOnly}
        onAutoStart={setAutoStart}
        onStop={stop}
      />

      <ConfigsSection
        configs={configs}
        status={status}
        onActivate={activate}
        onStop={stop}
        onDelete={remove}
        onView={setEditing}
      />

      <AddNewSection onSaved={refresh} />

      <NordSection onImported={refresh} />

      {editing && (
        <ConfigEditor
          name={editing}
          onClose={() => setEditing(null)}
          onSave={refresh}
        />
      )}
    </div>
  );
}

const SUB_TABS = [
  { id: 'client', label: 'Client' },
  { id: 'server', label: 'Server' },
];

export default function VpnTab() {
  const [subTab, setSubTab] = useState('client');

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-4 pt-3 border-b border-[var(--color-border)]">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`px-3 py-1.5 text-xs rounded-t transition-colors ${subTab === tab.id
              ? 'bg-[var(--color-bg-primary)] text-[var(--color-accent)] border border-b-0 border-[var(--color-border)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {subTab === 'client' ? <ClientPane /> : <ServerPane />}
    </div>
  );
}

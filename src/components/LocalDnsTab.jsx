import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth';
import { currentWorkspaceSlug } from '../lib/networkingApi';

// ─────────────────────────────────────────────────────────────────────────────
// Settings → Local Network
//
// Consent + status for the "lan" DnsPublication kind — the opaque-ID local
// name (`<id>.local.workspace.<zone>`) that the LAN fast-path resolves to
// this workspace's linked host, replacing the old guessable
// `local.<slug>.workspace...` record. Mirrors aw-app-ddns's own panel
// pattern (enabled/disabled, assigned hostname, current status) for the
// WAN dynamic-DNS kind — this is the same shape for the LAN kind, just
// living in the SPA's own Settings rather than a separate installed app.
//
// This is a CONSENT screen: nothing is published until the toggle is
// flipped, same rule dns_publication.py enforces server-side. Only the
// value the control plane already trusts (the host's own /link-advertised
// LAN address) can ever be published here — there is no free-text IP
// field, on purpose.
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

// iOS-style sliding toggle. Tooltip carries the long explanation — the row
// itself stays a clean one-liner.
function Toggle({ checked, onChange, disabled, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      title={title}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
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

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — the name is still selectable text.
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

// ── API helpers ────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await apiFetch(path, opts);
  if (!res.ok) {
    let detail;
    try {
      detail = (await res.json()).error || '';
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `${res.status}`);
  }
  return res.json();
}

function statusPill(row, configError) {
  if (configError) return <Pill tone="warn">Not configured</Pill>;
  if (!row?.enabled) return <Pill tone="muted">Off</Pill>;
  if (row.last_error) return <Pill tone="err">Error</Pill>;
  if (row.published_value) return <Pill tone="ok">Published</Pill>;
  return <Pill tone="warn">Pending</Pill>;
}

export default function LocalDnsTab() {
  const [slug, setSlug] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const s = await currentWorkspaceSlug();
    setSlug(s);
    if (!s) {
      setLoading(false);
      return;
    }
    try {
      const resp = await api('GET', `/api/workspaces/${encodeURIComponent(s)}/dns-publications`);
      setData(resp);
      setError('');
    } catch (e) {
      setError(e.message || 'could not load status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const lanRow = data?.publications?.find((p) => p.kind === 'lan');

  const toggle = async (next) => {
    if (!slug || busy) return;
    setBusy(true);
    setError('');
    try {
      if (next) {
        await api('POST', `/api/workspaces/${encodeURIComponent(slug)}/dns-publications/lan`, {});
      } else {
        await api('DELETE', `/api/workspaces/${encodeURIComponent(slug)}/dns-publications/lan`);
      }
      await load();
    } catch (e) {
      setError(e.message || `could not ${next ? 'enable' : 'disable'} local DNS`);
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!slug || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('POST', `/api/workspaces/${encodeURIComponent(slug)}/dns-publications/lan/rotate-id`);
      await load();
    } catch (e) {
      setError(e.message || 'could not rotate the local name');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading…</div>;
  }

  return (
    <div className="p-4">
      <Section
        title="Local Network Access"
        description="LAN fast-path — bypass the tunnel when you're on the same network"
        defaultOpen
      >
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          When enabled, this workspace publishes a private, non-guessable name
          that resolves to your linked host's LAN address — so a browser on
          the same network reaches it directly instead of through the cloud
          tunnel. Nothing is published until you turn it on, and turning it
          off removes the name again. The name is opaque on purpose: unlike a
          slug-based name, it can't be guessed or enumerated by anyone probing
          DNS.
        </p>

        {data && !data.eligible && (
          <p className="text-xs text-[var(--color-text-muted)]">{data.ineligible_reason}</p>
        )}

        {data && data.eligible && (
          <>
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-3">
                <Toggle
                  checked={!!lanRow?.enabled}
                  onChange={toggle}
                  disabled={busy || !!lanRow?.config_error}
                  title={lanRow?.config_error || (lanRow?.enabled ? 'Turn off' : 'Turn on')}
                />
                {statusPill(lanRow, lanRow?.config_error)}
              </div>
              {lanRow?.enabled && (
                <Btn onClick={rotate} disabled={busy} title="Replace this name with a fresh one — nothing else changes">
                  Rotate name
                </Btn>
              )}
            </div>

            {lanRow?.config_error && (
              <p className="text-xs text-amber-300 mb-2">{lanRow.config_error}</p>
            )}

            {lanRow?.enabled && lanRow?.name && (
              <div className="flex items-center gap-2 mt-1">
                <code className="text-xs px-2 py-1 rounded bg-white/5 text-[var(--color-text-primary)] select-all">
                  {lanRow.name}
                </code>
                <CopyButton text={lanRow.name} />
              </div>
            )}

            {lanRow?.enabled && lanRow?.published_value && (
              <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
                → {lanRow.published_value}
                {lanRow.published_at && ` (published ${new Date(lanRow.published_at * 1000).toLocaleString()})`}
              </p>
            )}

            {lanRow?.last_error && (
              <p className="text-xs text-red-300 mt-2">{lanRow.last_error}</p>
            )}
          </>
        )}

        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
      </Section>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth';

export default function ProxyTab() {
  const [cookies, setCookies] = useState(null);    // null = loading
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [persisting, setPersisting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiFetch('/api/proxy/cookie-keys').then(r => r.json());
      if (res.error) { setError(res.error); setCookies([]); }
      else { setCookies(res.keys || []); setSelected(new Set()); }
    } catch (e) {
      setError(String(e));
      setCookies([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!cookies) return [];
    const q = search.toLowerCase().trim();
    if (!q) return cookies;
    return cookies.filter(c =>
      c.name.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q)
    );
  }, [cookies, search]);

  const allVisibleSelected = filtered.length > 0 && filtered.every(c => selected.has(c.name));
  const someSelected = filtered.some(c => selected.has(c.name));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected(prev => {
        const n = new Set(prev);
        filtered.forEach(c => n.delete(c.name));
        return n;
      });
    } else {
      setSelected(prev => {
        const n = new Set(prev);
        filtered.forEach(c => n.add(c.name));
        return n;
      });
    }
  };

  const persistSelected = async (items) => {
    setPersisting(true);
    setError('');
    try {
      for (const item of items) {
        const res = await apiFetch(`/api/proxy/persistent-cookies/${encodeURIComponent(item.name)}`, { method: 'POST' }).then(r => r.json());
        if (res.error) { setError(res.error); break; }
      }
      // Refresh to get updated persisted flags
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setPersisting(false);
    }
  };

  const clearFromBrowser = async (items) => {
    setClearing(true);
    setError('');
    try {
      const isAll = items === 'all';
      const body = isAll
        ? { all: true }
        : { cookies: items.map(c => ({ name: c.name, domain: c.domain })) };
      const res = await apiFetch('/api/proxy/browser-cookies/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(r => r.json());
      if (res.error) { setError(res.error); return; }
      if (isAll) {
        setCookies([]);
        setSelected(new Set());
      } else {
        const gone = new Set(items.map(c => c.name));
        setCookies(prev => prev?.filter(c => !gone.has(c.name)) ?? prev);
        setSelected(prev => { const n = new Set(prev); gone.forEach(name => n.delete(name)); return n; });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setClearing(false);
    }
  };

  const selectedVisible = filtered.filter(c => selected.has(c.name));
  const busy = persisting || clearing;

  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-[var(--color-text-muted)]">
        Browser cookies synced by the Chrome extension. Select cookies and use <span className="text-[var(--color-accent)]">Persist</span> to encrypt and store them in PostgreSQL — they will be re-injected on proxy restart.
      </p>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Filter by name or domain…"
        className="w-full bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-xs focus:outline-none focus:border-[var(--color-accent)]"
      />

      {/* Toolbar */}
      {cookies !== null && (
        <div className="flex items-center gap-2 flex-wrap">
          {cookies.length > 0 && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={el => { if (el) el.indeterminate = someSelected && !allVisibleSelected; }}
                onChange={toggleSelectAll}
                className="cursor-pointer"
              />
              <span className="text-xs text-[var(--color-text-muted)]">
                {filtered.length} cookie{filtered.length !== 1 ? 's' : ''}{search ? ' filtered' : ''}
              </span>
            </label>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => persistSelected(selectedVisible)}
              disabled={busy || selectedVisible.length === 0}
              className="px-2.5 py-1 text-xs rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Persist{selectedVisible.length > 0 ? ` (${selectedVisible.length})` : ''}
            </button>
            <button
              onClick={() => clearFromBrowser(selectedVisible)}
              disabled={busy || selectedVisible.length === 0}
              className="px-2.5 py-1 text-xs rounded bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Clear{selectedVisible.length > 0 ? ` (${selectedVisible.length})` : ''}
            </button>
            <button
              onClick={() => clearFromBrowser('all')}
              disabled={busy || !cookies?.length}
              className="px-2.5 py-1 text-xs rounded bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Clear all
            </button>
            <button
              onClick={load}
              disabled={busy}
              className="px-2.5 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5 disabled:opacity-30"
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-300">{error}</p>}
      {cookies === null && !error && <p className="text-xs text-[var(--color-text-muted)] italic">Loading…</p>}
      {cookies !== null && cookies.length === 0 && !error && (
        <p className="text-xs text-[var(--color-text-muted)] italic">No cookies in browser yet.</p>
      )}
      {cookies !== null && cookies.length > 0 && filtered.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)] italic">No cookies match "{search}".</p>
      )}

      {/* Cookie rows */}
      {filtered.length > 0 && (
        <div>
          {filtered.map(item => (
            <div
              key={item.name}
              className="flex items-center gap-2.5 py-1.5 border-b border-[var(--color-border)] last:border-0"
            >
              <input
                type="checkbox"
                checked={selected.has(item.name)}
                onChange={() => setSelected(prev => {
                  const n = new Set(prev);
                  n.has(item.name) ? n.delete(item.name) : n.add(item.name);
                  return n;
                })}
                className="cursor-pointer shrink-0"
              />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-mono text-[var(--color-text-primary)] truncate block">{item.name}</span>
                {item.domain && (
                  <span className="text-[10px] text-[var(--color-text-muted)]">{item.domain}</span>
                )}
              </div>
              {item.persisted && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 shrink-0">
                  DB
                </span>
              )}
              <button
                onClick={() => clearFromBrowser([item])}
                disabled={busy}
                title="Clear from browser"
                className="text-[var(--color-text-muted)] hover:text-red-300 disabled:opacity-30 shrink-0 text-sm leading-none px-0.5"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

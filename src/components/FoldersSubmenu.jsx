import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth';

/**
 * Workspace > Folders — map ANY directory into the workspace by name.
 *
 * The UI half of `/api/folders` (aw-workspace `src/api/folders.py`), and the
 * deliberate counterpart to the Repos submenu next to it: Repos lists what
 * happens to be a git checkout under `repos/`, this lists what the user
 * explicitly pointed at. A mapped folder needs no `.git` and no `repos/`
 * prefix — that repository binding is exactly what this replaces.
 *
 * "Point at a folder" is taken literally: the picker walks real directories
 * through `/api/folders/-/browse` rather than asking the user to recall an
 * absolute path. Typing one still works for anyone who already knows it —
 * including a path only the container engine can see, which the server
 * accepts and flags rather than rejects.
 */

function FolderIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export default function FoldersSubmenu({ onEnter }) {
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  // Browser state: null = collapsed. Otherwise the listing for `cwd`.
  const [browser, setBrowser] = useState(null);

  // Reload is a counter rather than a callable fetch so the effect owns the
  // request start-to-finish and can cancel its own state writes — the popover
  // is routinely unmounted mid-flight by a mouse leaving the menu.
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/folders');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (cancelled) return;
        setFolders(d.folders || []);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(`Could not load mapped folders: ${e.message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadTick]);

  const browseTo = useCallback(async (path) => {
    try {
      const q = path ? `?path=${encodeURIComponent(path)}` : '';
      const res = await apiFetch(`/api/folders/-/browse${q}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || `HTTP ${res.status}`);
      setBrowser(d);
      setPathInput(d.path);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const addFolder = useCallback(async (path, name) => {
    const target = (path || '').trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const body = { path: target };
      if ((name || '').trim()) body.name = name.trim();
      const res = await apiFetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || `HTTP ${res.status}`);
      setPathInput('');
      setNameInput('');
      setBrowser(null);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const removeFolder = useCallback(async (name) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/folders/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `HTTP ${res.status}`);
      }
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [reload]);

  return (
    <div
      onMouseEnter={onEnter}
      className="absolute left-full top-0 ml-1 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-2"
      style={{ minWidth: 420, maxWidth: 560 }}
    >
      <div className="flex items-center justify-between px-2 py-1 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          Mapped folders · {folders.length}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)]">any folder — no git repo needed</span>
      </div>

      {error && (
        <div className="mx-1 mb-2 px-2 py-1 text-[11px] rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30">
          {error}
        </div>
      )}

      {folders.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-[var(--color-text-muted)] italic">
          Nothing mapped yet.
        </div>
      ) : (
        <div className="overflow-y-auto" style={{ maxHeight: '40vh' }}>
          {folders.map((f) => (
            <div key={f.name} className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.05]">
              <FolderIcon />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] text-[var(--color-text-primary)] truncate">{f.name}</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-white/10 text-[var(--color-text-muted)] shrink-0">
                    {f.mode}
                  </span>
                  {/* exists:false is informational, not an error — the path may
                      be visible only to the container engine on the host. */}
                  {!f.exists && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-400/15 text-amber-400 shrink-0"
                      title="Not visible from the workspace process — still handed to app containers as a host path"
                    >
                      unverified
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-[var(--color-text-muted)] truncate" title={f.path}>{f.path}</div>
              </div>
              <button
                onClick={() => removeFolder(f.name)}
                disabled={busy}
                className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors disabled:opacity-50 shrink-0"
                title={`Unmap ${f.name}`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-1.5 px-1">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFolder(pathInput, nameInput)}
            placeholder="/absolute/path/to/folder"
            className="flex-1 min-w-0 px-2 py-1 text-[12px] font-mono rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFolder(pathInput, nameInput)}
            placeholder="name (optional)"
            style={{ width: 110 }}
            className="px-2 py-1 text-[12px] rounded bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={() => (browser ? setBrowser(null) : browseTo(pathInput || null))}
            className="px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-muted)] transition-colors shrink-0"
            title="Browse for a folder"
          >
            {browser ? 'Hide' : 'Browse…'}
          </button>
          <button
            onClick={() => addFolder(pathInput, nameInput)}
            disabled={busy || !pathInput.trim()}
            className="px-2 py-1 text-[11px] rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 transition-colors disabled:opacity-40 shrink-0"
          >
            Map
          </button>
        </div>

        {browser && (
          <div className="mt-2 mx-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)]">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--color-border)]">
              <button
                onClick={() => browseTo(browser.parent)}
                disabled={!browser.parent}
                className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] disabled:opacity-30"
                title="Up one level"
              >
                ↑
              </button>
              <span className="flex-1 text-[10px] font-mono text-[var(--color-text-muted)] truncate" title={browser.path}>
                {browser.path}
              </span>
              <button
                onClick={() => addFolder(browser.path, nameInput)}
                disabled={busy}
                className="text-[10px] text-[var(--color-accent)] hover:underline disabled:opacity-40 shrink-0"
              >
                Map this one
              </button>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: '30vh' }}>
              {browser.entries.length === 0 ? (
                <div className="px-2 py-3 text-center text-[11px] text-[var(--color-text-muted)] italic">
                  No subdirectories.
                </div>
              ) : browser.entries.map((e) => (
                <div
                  key={e.path}
                  className="flex items-center gap-2 px-2 py-1 hover:bg-white/[0.05] cursor-pointer"
                  onClick={() => browseTo(e.path)}
                  title={e.path}
                >
                  <FolderIcon />
                  <span className="flex-1 text-[12px] text-[var(--color-text-primary)] truncate">{e.name}</span>
                  <button
                    onClick={(ev) => { ev.stopPropagation(); addFolder(e.path, ''); }}
                    disabled={busy}
                    className="text-[10px] text-[var(--color-accent)] hover:underline disabled:opacity-40 shrink-0"
                  >
                    Map
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

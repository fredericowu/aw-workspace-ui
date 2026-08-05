import { useState, useRef, useCallback, useEffect } from 'react';
import { wsUrl, apiFetch } from '../auth';

/**
 * Top-bar nav entry for Repos. Hovering opens a popover listing local repos
 * (same data as the Repos page) with quick-actions: open in VSCode, pull,
 * show diff (opens aw-app-diff-tool's window — see diffRepo below),
 * open-terminal-in-folder. Mirrors the Presentation hover-gallery pattern
 * so the two top-bar items feel consistent.
 */
export default function RepoNav() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);

  const [repos, setRepos] = useState([]);
  const [error, setError] = useState(null);
  const [busyRepo, setBusyRepo] = useState(null);
  const [flash, setFlash] = useState({});
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  // --- WS subscription (only kept open while popover-relevant) ---------------
  const connect = useCallback(() => {
    const ws = new WebSocket(wsUrl('/ws/github'));
    wsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'github_init' || msg.type === 'github_update') {
          setRepos(msg.repos || []);
          setError(msg.error || null);
        }
      } catch {}
    };
    ws.onclose = () => { reconnectRef.current = setTimeout(connect, 5000); };
    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    apiFetch('/api/github/prs').then((r) => r.json()).then((d) => {
      setRepos(d.repos || []);
    }).catch(() => {});
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  // --- Hover handling --------------------------------------------------------
  const handleEnter = useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);
  const handleLeave = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // --- Repo actions ----------------------------------------------------------
  const flashFor = (path, kind, ms = 2000) => {
    setFlash((p) => ({ ...p, [path]: kind }));
    setTimeout(() => setFlash((p) => { const n = { ...p }; delete n[path]; return n; }), ms);
  };

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/github/refresh', { method: 'POST' });
      const d = await res.json();
      setRepos(d.repos || []);
    } catch {}
  }, []);

  const pullRepo = async (r) => {
    setBusyRepo(r.path);
    try {
      const res = await apiFetch('/api/git/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: r.path }),
      });
      const data = await res.json();
      if (data.success) {
        flashFor(r.path, 'success');
        refresh();
      } else {
        flashFor(r.path, 'error');
        setError(`${r.name}: ${data.error || 'pull failed'}`);
      }
    } catch (e) {
      flashFor(r.path, 'error');
      setError(`${r.name}: ${e.message}`);
    } finally {
      setBusyRepo(null);
    }
  };

  // Opens aw-app-diff-tool's window directly with the diff_id from this
  // POST's own response, rather than waiting on that app's diff_open WS
  // broadcast (the other entry point — an agent's show_diff MCP call —
  // needs the broadcast since nobody in this tab triggered it; a click
  // here already has the id in hand).
  const diffRepo = async (r) => {
    setBusyRepo(r.path);
    try {
      const res = await apiFetch('/api/apps/diff-tool/diffs/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: r.path,
          ref: r.diff_ref || 'HEAD~1',
          title: `${r.name}${r.ahead ? `: ${r.ahead} ahead` : ''}`,
        }),
      });
      const data = await res.json();
      if (data.success) {
        window.__awOpenAppWindow?.('diff-tool.viewer', data.diff_id, `${r.name} diff`);
        setOpen(false);
      } else {
        flashFor(r.path, 'error');
        setError(`${r.name}: ${data.error || 'diff failed'}`);
      }
    } catch (e) {
      flashFor(r.path, 'error');
      setError(`${r.name}: ${e.message}`);
    } finally {
      setBusyRepo(null);
    }
  };

  const openTerminal = async (r) => {
    // We deliberately do NOT pass `command: "cd <path> && exec $SHELL"` here.
    // The backend runs commands through `shlex.split → shlex.quote → bash -lc`,
    // which turns `&&` into a literal `'&&'` token (and quotes `$SHELL`). Bash
    // then sees a single `cd` invocation with extra args, exits non-zero, and
    // the detached `screen` session dies with no children — producing
    // "There is no screen to be attached matching aw-terminal-N" on attach.
    //
    // Instead: create a plain shell terminal, then write `cd <path>\r` once
    // it's attached. This routes through the PTY (where the path is a normal
    // bash arg) and works for any path that doesn't contain a single quote.
    try {
      const res = await apiFetch('/api/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: r.name }),
      });
      const data = await res.json();
      if (!data.id) {
        flashFor(r.path, 'error');
        setError(`${r.name}: failed to create terminal`);
        return;
      }
      // Open the terminal window immediately so the user sees it spawn,
      // then send the cd once the screen has had a moment to attach.
      if (window.__awOpenTerminal) {
        window.__awOpenTerminal(data.id);
        setOpen(false);
      }
      const escaped = (r.path || '').replace(/'/g, "'\\''");
      setTimeout(() => {
        apiFetch(`/api/terminals/${data.id}/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `cd '${escaped}'\r` }),
        }).catch(() => {});
      }, 350);
    } catch (e) {
      flashFor(r.path, 'error');
      setError(`${r.name}: ${e.message}`);
    }
  };

  const openInVscode = (r) => {
    window.open(`vscode://file/${r.path}`, '_self');
    setOpen(false);
  };

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1 text-xs rounded transition-colors cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5"
      >
        Repos
        {repos.length > 0 && (
          <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] rounded-full text-[9px] font-bold px-1 bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
            {repos.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-2"
          style={{ minWidth: 360, maxWidth: 520 }}
        >
          <div className="flex items-center justify-between px-2 py-1 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Repositories · {repos.length}
            </span>
            <button
              onClick={refresh}
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
              title="Refresh repo status"
            >
              ↻ Refresh
            </button>
          </div>

          {error && (
            <div className="mx-1 mb-2 px-2 py-1 text-[11px] rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30">
              {error}
            </div>
          )}

          {repos.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)] italic">
              No repos configured.
            </div>
          ) : (
            <div className="overflow-y-auto" style={{ maxHeight: '70vh' }}>
              {repos.map((r) => {
                const busy = busyRepo === r.path;
                const fl = flash[r.path];
                return (
                  <div
                    key={r.name}
                    className={`group flex items-center gap-2 px-2 py-1.5 rounded transition-colors cursor-pointer ${
                      fl === 'success' ? 'bg-green-500/10' :
                      fl === 'error' ? 'bg-red-500/10' :
                      'hover:bg-white/[0.05]'
                    }`}
                    onClick={() => openInVscode(r)}
                    title={`Open ${r.path} in VSCode`}
                  >
                    <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] text-[var(--color-text-primary)] truncate">{r.name}</span>
                        {r.dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Has local changes" />}
                        {r.diff_ref && r.ahead > 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--color-accent)]/15 text-[var(--color-accent)] shrink-0">
                            +{r.ahead}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-[var(--color-text-muted)] truncate">{r.branch || '?'}</div>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => pullRepo(r)}
                        disabled={busy}
                        className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-green-400 transition-colors disabled:opacity-50"
                        title="Fetch & pull latest"
                      >
                        <svg className={`w-3.5 h-3.5 ${busy ? 'animate-spin [animation-direction:reverse]' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14M5 12l7 7 7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => diffRepo(r)}
                        disabled={busy}
                        className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-50"
                        title="Show diff"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => openTerminal(r)}
                        className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-amber-400 transition-colors"
                        title={`Open terminal in ${r.name}`}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="4 17 10 11 4 5" />
                          <line x1="12" y1="19" x2="20" y2="19" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { parseAnsi } from './AnsiParser';
import { computeMatches, highlightSearch, countMatches } from './logSearch';

/**
 * LogStream — embedded WebSocket-driven log terminal used inside
 * AppProxyWindow's "logs" view (the window already owns a title bar, so this
 * renders its own compact search row instead of a full LogWindow chrome).
 *
 * Feature parity with the standalone `LogWindow` (Workspace > Components):
 * Cmd/Ctrl+F search with live substring highlight, match counter + prev/next
 * nav, clear-logs, and the same scroll-lock heuristic. Only Start/Stop/
 * Restart live outside this component (in AppProxyWindow's title bar, via
 * `DockerControls`) since those are gated on `standalone_app` — a log
 * stream can exist (and be searched/cleared) for a non-standalone
 * (`tier: inprocess`) app too.
 *
 * Props:
 *   componentKey — the component to stream logs for (e.g. "docker:aw-browser"
 *                  or "service:proxy:proxy-server" for a `ctx.services`
 *                  managed subprocess of an inprocess app)
 *   component    — the component status object (optional; used to clear
 *                  lines on boot transitions so a restart shows a clean
 *                  backlog rather than appending to stale output)
 *   maxLines     — backlog cap; default 1000
 */
export default function LogStream({ componentKey, component, maxLines = 1000 }) {
  const [lines, setLines] = useState([]);
  const [scrollLocked, setScrollLocked] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const terminalRef = useRef(null);
  const rootRef = useRef(null);
  const searchInputRef = useRef(null);
  const autoScrollRef = useRef(true);
  const matchRefs = useRef([]);

  const onMessage = useCallback(
    (data) => {
      setLines((prev) => {
        const next = [...prev, data];
        return next.length > maxLines ? next.slice(-maxLines) : next;
      });
    },
    [maxLines]
  );

  const { connected } = useWebSocket(componentKey, onMessage);

  // Clear backlog on boot transitions so a restart shows fresh output.
  const currentStatus = component?.status || 'off';
  const prevStatus = useRef(currentStatus);
  useEffect(() => {
    if (prevStatus.current !== 'boot' && currentStatus === 'boot') {
      setLines([]);
    }
    prevStatus.current = currentStatus;
  }, [currentStatus]);

  // ── Search (Cmd/Ctrl+F) — same matching math as LogWindow ──────────────
  const matches = useMemo(() => computeMatches(lines, searchQuery), [lines, searchQuery]);

  useEffect(() => { setActiveMatchIdx(0); }, [searchQuery]);

  useEffect(() => {
    if (matches.length > 0 && matchRefs.current[activeMatchIdx]) {
      matchRefs.current[activeMatchIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeMatchIdx, matches.length]);

  matchRefs.current = [];
  let globalMatchCounter = 0;

  const goNextMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIdx((prev) => (prev + 1) % matches.length);
  };
  const goPrevMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIdx((prev) => (prev - 1 + matches.length) % matches.length);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchVisible(true);
        setScrollLocked(true);
        autoScrollRef.current = false;
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && searchVisible) {
        setSearchVisible(false);
        setSearchQuery('');
      }
    };
    const el = rootRef.current;
    if (!el) return;
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [searchVisible]);

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      setSearchVisible(false);
      setSearchQuery('');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) goPrevMatch();
      else goNextMatch();
    }
  };

  const renderLine = (line, lineIdx) => {
    const spans = parseAnsi(line);
    return (
      <div key={lineIdx} className="whitespace-pre-wrap break-all leading-5 hover:bg-white/[0.02]">
        {spans.map((span, i) => {
          if (searchQuery && span.text.toLowerCase().includes(searchQuery.toLowerCase())) {
            const parts = highlightSearch(span.text, searchQuery, lineIdx, globalMatchCounter, activeMatchIdx, matchRefs);
            globalMatchCounter += countMatches(span.text, searchQuery);
            return <span key={i} className={span.className}>{parts}</span>;
          }
          return <span key={i} className={span.className}>{span.text}</span>;
        })}
      </div>
    );
  };

  // Auto-scroll to bottom on new lines unless the user scrolled up.
  useEffect(() => {
    if (!scrollLocked && autoScrollRef.current && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines, scrollLocked]);

  // Re-stick to bottom on container resize (e.g. when the parent window
  // grows) — otherwise the ResizeObserver delta would leave us pinned
  // to the old scrollTop and look like a scroll lock.
  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      if (autoScrollRef.current) el.scrollTop = el.scrollHeight;
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Lock scroll only on deliberate user scroll-up (debounced to ignore
  // trackpad jitter). Re-engage auto-scroll when the user reaches the
  // bottom again.
  const wheelAccum = useRef(0);
  const wheelTimer = useRef(null);
  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.deltaY < 0) {
        wheelAccum.current += Math.abs(e.deltaY);
        if (wheelAccum.current > 50) {
          setScrollLocked(true);
          autoScrollRef.current = false;
        }
        clearTimeout(wheelTimer.current);
        wheelTimer.current = setTimeout(() => { wheelAccum.current = 0; }, 200);
      } else if (e.deltaY > 0) {
        wheelAccum.current = 0;
        requestAnimationFrame(() => {
          const { scrollTop, scrollHeight, clientHeight } = el;
          if (scrollHeight - scrollTop - clientHeight < 30) {
            setScrollLocked(false);
            autoScrollRef.current = true;
          }
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(wheelTimer.current);
    };
  }, []);

  const unlockScroll = () => {
    setScrollLocked(false);
    autoScrollRef.current = true;
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  };

  const status = component?.status || 'off';
  const searchHasQuery = searchQuery.length > 0;
  const searchNoResults = searchHasQuery && matches.length === 0;

  return (
    <div ref={rootRef} tabIndex={0} className="relative flex-1 flex flex-col min-h-0 outline-none">
      {/* Compact toolbar — clear + search toggle. AppProxyWindow's own
          title bar already carries Start/Stop/Restart (when standalone)
          and the iframe/logs view toggle, so this stays minimal. */}
      <div className="flex items-center justify-end gap-1 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-bg-header)] shrink-0">
        <button
          onClick={() => setLines([])}
          className="p-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
          title="Clear logs"
        >
          <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6h12Z" />
          </svg>
        </button>
        <button
          onClick={() => {
            setSearchVisible((v) => !v);
            if (!searchVisible) {
              setScrollLocked(true);
              autoScrollRef.current = false;
              setTimeout(() => searchInputRef.current?.focus(), 50);
            } else {
              setSearchQuery('');
            }
          }}
          className={`p-1 rounded cursor-pointer transition-colors ${
            searchVisible ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:bg-white/10'
          }`}
          title="Search (Cmd+F)"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </button>
      </div>

      {searchVisible && (
        <div className={`flex items-center gap-2 px-2 py-1 border-b border-[var(--color-border)] shrink-0 ${
          searchNoResults ? 'bg-red-950/30' : 'bg-[var(--color-bg-header)]'
        }`}>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search logs..."
            className={`flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--color-text-muted)] ${
              searchNoResults ? 'text-red-400' : 'text-[var(--color-text-primary)]'
            }`}
          />
          {searchHasQuery && (
            <div className="flex items-center gap-1 shrink-0">
              <span className={`text-xs ${searchNoResults ? 'text-red-400' : 'text-[var(--color-text-muted)]'}`}>
                {matches.length === 0 ? 'No matches' : `${activeMatchIdx + 1} / ${matches.length}`}
              </span>
              <button
                onClick={goPrevMatch}
                disabled={matches.length === 0}
                className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Previous (Shift+Enter)"
              >
                <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
              <button
                onClick={goNextMatch}
                disabled={matches.length === 0}
                className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Next (Enter)"
              >
                <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
          )}
          <button
            onClick={() => { setSearchQuery(''); setSearchVisible(false); }}
            className="p-0.5 rounded hover:bg-white/10 transition-colors"
            title="Close search (Escape)"
          >
            <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <div
          ref={terminalRef}
          className="absolute inset-0 overflow-y-auto overflow-x-hidden p-3 font-mono text-[13px] text-[var(--color-text-primary)] bg-[var(--color-bg-terminal)]"
        >
          {lines.length === 0 ? (
            <div className="text-[var(--color-text-muted)] italic">
              {status === 'off'
                ? 'Component is not running. Click play to start.'
                : connected
                  ? 'Waiting for logs...'
                  : 'Connecting...'}
            </div>
          ) : (
            lines.map((line, i) => renderLine(line, i))
          )}
        </div>
        {scrollLocked && (
          <button
            onClick={unlockScroll}
            className="absolute bottom-2 right-3 px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors cursor-pointer"
            title="Click to follow (auto-scroll)"
          >
            SCROLL LOCKED
          </button>
        )}
      </div>
    </div>
  );
}

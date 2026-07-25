import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { parseAnsi } from './AnsiParser';
import ControlButtons from './ControlButtons';
import StatusDot from './StatusDot';

export default function LogWindow({ componentKey, component, maxLines, onClose, onAction, onMaximize, isMaximized }) {
  const [lines, setLines] = useState([]);
  const [scrollLocked, setScrollLocked] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const terminalRef = useRef(null);
  const searchInputRef = useRef(null);
  const autoScrollRef = useRef(true);
  const matchRefs = useRef([]);

  const onMessage = useCallback((data) => {
    setLines((prev) => {
      const next = [...prev, data];
      return next.length > maxLines ? next.slice(-maxLines) : next;
    });
  }, [maxLines]);

  const { connected, close: closeWs } = useWebSocket(componentKey, onMessage);

  // When status transitions to boot (restart/start), clear lines so backlog repopulates
  const currentStatus = component?.status || 'off';
  const prevStatus = useRef(currentStatus);
  useEffect(() => {
    if (prevStatus.current !== 'boot' && currentStatus === 'boot') {
      setLines([]);
    }
    prevStatus.current = currentStatus;
  }, [currentStatus]);

  // Compute all search matches: [{lineIdx, startIdx}]
  const matches = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    const result = [];
    lines.forEach((line, lineIdx) => {
      const lower = line.toLowerCase();
      let pos = 0;
      while ((pos = lower.indexOf(q, pos)) !== -1) {
        result.push({ lineIdx, startIdx: pos });
        pos += q.length;
      }
    });
    return result;
  }, [lines, searchQuery]);

  // Reset active match when query changes
  useEffect(() => {
    setActiveMatchIdx(0);
  }, [searchQuery]);

  // Scroll to active match
  useEffect(() => {
    if (matches.length > 0 && matchRefs.current[activeMatchIdx]) {
      matchRefs.current[activeMatchIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeMatchIdx, matches.length]);

  // Reset match refs on render
  matchRefs.current = [];
  let globalMatchCounter = 0;

  // Auto-scroll to bottom
  useEffect(() => {
    if (!scrollLocked && autoScrollRef.current && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines, scrollLocked]);

  // Re-scroll to bottom on container resize (prevents false scroll lock from window resize)
  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      if (autoScrollRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Lock scroll only on deliberate user scroll-up (debounced to avoid trackpad jitter).
  const wheelAccum = useRef(0);
  const wheelTimer = useRef(null);

  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.deltaY < 0) {
        // Accumulate upward scroll — only lock after threshold
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
    return () => { el.removeEventListener('wheel', onWheel); clearTimeout(wheelTimer.current); };
  }, []);

  const unlockScroll = () => {
    setScrollLocked(false);
    autoScrollRef.current = true;
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  };

  const goNextMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIdx((prev) => (prev + 1) % matches.length);
  };

  const goPrevMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIdx((prev) => (prev - 1 + matches.length) % matches.length);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchVisible(true);
        setScrollLocked(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && searchVisible) {
        setSearchVisible(false);
        setSearchQuery('');
      }
    };
    const el = terminalRef.current?.closest('.log-window');
    if (el) {
      el.addEventListener('keydown', handleKeyDown);
      return () => el.removeEventListener('keydown', handleKeyDown);
    }
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

  // Render a single line with ANSI parsing and search highlights
  const renderLine = (line, lineIdx) => {
    const spans = parseAnsi(line);
    return (
      <div key={lineIdx} className="whitespace-pre-wrap break-all leading-5 hover:bg-white/[0.02]">
        {spans.map((span, i) => {
          if (searchQuery && span.text.toLowerCase().includes(searchQuery.toLowerCase())) {
            const parts = highlightSearch(span.text, searchQuery, lineIdx, globalMatchCounter, activeMatchIdx, matchRefs);
            // Count how many matches are in this span
            const q = searchQuery.toLowerCase();
            let count = 0;
            let pos = 0;
            const lower = span.text.toLowerCase();
            while ((pos = lower.indexOf(q, pos)) !== -1) { count++; pos += q.length; }
            globalMatchCounter += count;
            return (
              <span key={i} className={span.className}>
                {parts}
              </span>
            );
          }
          return (
            <span key={i} className={span.className}>
              {span.text}
            </span>
          );
        })}
      </div>
    );
  };

  const status = component?.status || 'off';
  const port = component?.port;

  // Search bar styling based on match state
  const searchHasQuery = searchQuery.length > 0;
  const searchNoResults = searchHasQuery && matches.length === 0;

  return (
    <div
      className="log-window flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full"
      tabIndex={0}
    >
      {/* Header */}
      <div className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={status} size="md" />
          <span className="font-semibold text-[15px] text-[var(--color-text-primary)] truncate">
            {componentKey}
          </span>
          {port && (
            <span className="text-[13px] text-[var(--color-text-muted)]">:{port}</span>
          )}
          {component?.pid && (
            <span className="text-[12px] text-[var(--color-text-muted)]">PID {component.pid}</span>
          )}
          {connected && status === 'running' && (
            <span className="text-[11px] text-green-500/70 uppercase tracking-wider font-medium">live</span>
          )}
        </div>
        <div className="flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
          <ControlButtons componentKey={componentKey} status={status} onAction={onAction} />
          <button
            onClick={() => { setLines([]); }}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="Clear logs"
          >
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6h12Z" />
            </svg>
          </button>
          <button
            onClick={() => {
              setSearchVisible(!searchVisible);
              if (!searchVisible) {
                setScrollLocked(true);
                setTimeout(() => searchInputRef.current?.focus(), 50);
              } else {
                setSearchQuery('');
              }
            }}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="Search (Cmd+F)"
          >
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </button>
          {scrollLocked && (
            <button
              onClick={unlockScroll}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors"
              title="Click to follow (auto-scroll)"
            >
              SCROLL LOCKED
            </button>
          )}
          {/* Maximize / Restore */}
          <button
            onClick={() => onMaximize && onMaximize(componentKey)}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="5" width="14" height="14" rx="1" />
                <path d="M8 2h12a2 2 0 0 1 2 2v12" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            )}
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="Close"
          >
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search bar */}
      {searchVisible && (
        <div className={`flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] ${
          searchNoResults ? 'bg-red-950/30' : 'bg-[var(--color-bg-header)]'
        }`}>
          <svg className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search logs..."
            className={`flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--color-text-muted)] ${
              searchNoResults ? 'text-red-400' : 'text-[var(--color-text-primary)]'
            }`}
          />

          {/* Match count + navigation */}
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

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-3 font-mono text-base text-[var(--color-text-primary)] bg-[var(--color-bg-terminal)]"
      >
        {lines.length === 0 ? (
          <div className="text-[var(--color-text-muted)] italic">
            {status === 'off' ? 'Component is not running. Click play to start.' : 'Waiting for logs...'}
          </div>
        ) : (
          lines.map((line, i) => renderLine(line, i))
        )}
      </div>
    </div>
  );
}

function highlightSearch(text, query, lineIdx, matchOffset, activeMatchIdx, matchRefs) {
  const parts = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let lastIdx = 0;
  let idx = lower.indexOf(q);
  let localMatch = 0;

  while (idx !== -1) {
    if (idx > lastIdx) parts.push(text.slice(lastIdx, idx));
    const globalIdx = matchOffset + localMatch;
    const isActive = globalIdx === activeMatchIdx;
    parts.push(
      <mark
        key={`${lineIdx}-${idx}`}
        ref={(el) => { if (el) matchRefs.current[globalIdx] = el; }}
        className={isActive ? 'search-hit search-hit-active' : 'search-hit'}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    localMatch++;
    lastIdx = idx + query.length;
    idx = lower.indexOf(q, lastIdx);
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

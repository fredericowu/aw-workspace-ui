import { useState, useRef, useEffect, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { parseAnsi } from './AnsiParser';

/**
 * LogStream — chrome-less WebSocket-driven log terminal.
 *
 * Subscribes to a component's log stream (same WS protocol used by
 * LogWindow → see useWebSocket(componentKey, onMessage)) and renders
 * the ANSI-parsed lines into a scrolling terminal-style div.
 *
 * No header / search / control buttons — embedders that want chrome
 * provide it themselves (LogWindow wraps this in a draggable window;
 * AppProxyWindow toggles it in-place where the iframe normally lives).
 *
 * Auto-scrolls to the bottom unless the user explicitly scrolled up
 * (debounced wheel delta — same heuristic LogWindow uses, to avoid
 * trackpad jitter flipping the lock).
 *
 * Props:
 *   componentKey — the component to stream logs for (e.g. "docker:aw-browser")
 *   component    — the component status object (optional; used to clear
 *                  lines on boot transitions so a restart shows a clean
 *                  backlog rather than appending to stale output)
 *   maxLines     — backlog cap; default 1000
 */
export default function LogStream({ componentKey, component, maxLines = 1000 }) {
  const [lines, setLines] = useState([]);
  const [scrollLocked, setScrollLocked] = useState(false);
  const terminalRef = useRef(null);
  const autoScrollRef = useRef(true);

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

  return (
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
          lines.map((line, i) => {
            const spans = parseAnsi(line);
            return (
              <div key={i} className="whitespace-pre-wrap break-all leading-5">
                {spans.map((span, j) => (
                  <span key={j} className={span.className}>{span.text}</span>
                ))}
              </div>
            );
          })
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
  );
}

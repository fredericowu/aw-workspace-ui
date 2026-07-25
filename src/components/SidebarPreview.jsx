import { useState, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { wsUrl } from '../auth';
import { parseAnsi } from './AnsiParser';
import StatusDot from './StatusDot';

const MAX_PREVIEW_LINES = 25;

/**
 * Floating preview that appears when hovering a sidebar item.
 *
 * - Components: connects to /ws/logs/{key} and renders ANSI-parsed log lines.
 * - Terminals/Claude: connects to /ws/terminal/{id} with a read-only xterm instance
 *   that shows a live snapshot of the terminal output.
 */
export default function SidebarPreview({ componentKey, component, anchorRect, type, name }) {
  const [lines, setLines] = useState([]);
  const wsRef = useRef(null);
  const scrollRef = useRef(null);
  const xtermContainerRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);

  // Connect to log WebSocket for components
  useEffect(() => {
    if (!componentKey || type === 'terminal') return;

    setLines([]);
    const ws = new WebSocket(wsUrl(`/ws/logs/${componentKey}`));
    wsRef.current = ws;

    ws.onmessage = (event) => {
      setLines((prev) => {
        const next = [...prev, event.data];
        return next.length > MAX_PREVIEW_LINES ? next.slice(-MAX_PREVIEW_LINES) : next;
      });
    };

    ws.onerror = () => ws.close();

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
    };
  }, [componentKey, type]);

  // Connect to terminal WebSocket for terminals/Claude with a read-only xterm
  useEffect(() => {
    if (!componentKey || type !== 'terminal' || !xtermContainerRef.current) return;

    const sessionId = componentKey.replace('terminal:', '');

    const term = new Terminal({
      cursorBlink: false,
      fontSize: 10,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
      scrollback: 200,
      disableStdin: true,
      theme: {
        background: '#000000',
        foreground: '#e2e8f0',
        cursor: 'transparent',
        selectionBackground: '#3b3b5c',
        black: '#4b5563',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#6b7280',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(xtermContainerRef.current);
    xtermRef.current = term;
    fitRef.current = fitAddon;

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });

    const ws = new WebSocket(wsUrl(`/ws/terminal/${sessionId}`));
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : new TextEncoder().encode(event.data);
      term.write(data);
    };

    ws.onerror = () => ws.close();

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.onclose = null;
        ws.close();
      }
      wsRef.current = null;
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, [componentKey, type]);

  // Auto-scroll log lines to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  if (!anchorRect) return null;

  // Position the preview to the right of the sidebar item
  const top = Math.max(8, Math.min(anchorRect.top - 40, window.innerHeight - 420));
  const left = anchorRect.right + 8;

  const isRunning = component?.status === 'running' || component?.status === 'boot';

  return (
    <div
      style={{
        position: 'fixed',
        top,
        left,
        width: '560px',
        height: '350px',
        zIndex: 10000,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          background: type === 'terminal' ? '#000000' : 'var(--color-bg-secondary, #1e1f2e)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          borderRadius: '8px',
          boxShadow: '0 0 15px rgba(99, 102, 241, 0.15), 0 0 40px rgba(99, 102, 241, 0.08), 0 12px 40px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--color-border, #2d2e3f)',
          background: 'var(--color-bg-header, #161726)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
        }}>
          {component ? (
            <StatusDot status={component.status} />
          ) : (
            <svg style={{ width: 10, height: 10, color: '#22c55e', flexShrink: 0 }} viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="6" />
            </svg>
          )}
          <span style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--color-text-primary, #e2e8f0)',
          }}>{name || componentKey}</span>
          {component?.port && (
            <span style={{
              fontSize: '10px',
              color: 'var(--color-text-muted, #64748b)',
              marginLeft: 'auto',
            }}>:{component.port}</span>
          )}
          {component?.pid && (
            <span style={{
              fontSize: '10px',
              color: 'var(--color-text-muted, #64748b)',
            }}>PID {component.pid}</span>
          )}
        </div>

        {/* Content */}
        {type === 'terminal' ? (
          <div
            ref={xtermContainerRef}
            style={{
              flex: 1,
              overflow: 'hidden',
              padding: '4px',
            }}
          />
        ) : (
          <div
            ref={scrollRef}
            style={{
              padding: '6px 10px',
              overflowY: 'auto',
              flex: 1,
              fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
              fontSize: '11px',
              lineHeight: '1.5',
            }}
          >
            {lines.length === 0 ? (
              <div style={{
                color: 'var(--color-text-muted, #64748b)',
                padding: '12px 0',
                textAlign: 'center',
                fontSize: '11px',
              }}>
                {isRunning ? 'Connecting...' : 'No logs available'}
              </div>
            ) : (
              lines.map((line, i) => (
                <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {parseAnsi(line).map((span, j) => (
                    <span key={j} className={span.className}>{span.text}</span>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

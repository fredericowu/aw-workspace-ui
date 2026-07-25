/**
 * Standalone terminal page — opened via pop-out button.
 * URL: /terminal.html?session=<id>&name=<name>
 *
 * Renders a full-screen xterm.js terminal connected to the PTY session
 * with no surrounding chrome. Auth is via JWT cookie (same-origin).
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';

const params = new URLSearchParams(window.location.search);
const sessionId = params.get('session');
const termName = params.get('name') || sessionId || 'Terminal';

document.title = termName;

const root = document.getElementById('root');

if (!sessionId) {
  root.innerHTML = '<div style="color:#e2e8f0;padding:2rem;font-family:monospace;">Missing ?session= parameter</div>';
} else {
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
    scrollback: 10000,
    allowProposedApi: true,
    theme: {
      background: '#000000',
      foreground: '#e2e8f0',
      cursor: '#e2e8f0',
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
  const webLinksAddon = new WebLinksAddon();
  const searchAddon = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(webLinksAddon);
  term.loadAddon(searchAddon);

  term.open(root);

  // Fit after a tick
  requestAnimationFrame(() => {
    try { fitAddon.fit(); } catch {}
  });

  // Resize on window resize
  window.addEventListener('resize', () => {
    try { fitAddon.fit(); } catch {}
  });

  // Connect WebSocket — JWT cookie is sent automatically on same-origin WS upgrade
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = `${proto}//${host}/ws/terminal/${sessionId}`;

  let ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    // Send initial resize
    const dims = fitAddon.proposeDimensions();
    if (dims) {
      ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
    }
  };

  ws.onmessage = (event) => {
    const data = event.data instanceof ArrayBuffer
      ? new Uint8Array(event.data)
      : new TextEncoder().encode(event.data);
    term.write(data);
  };

  ws.onclose = () => {
    term.write('\r\n\x1b[90m[session disconnected]\x1b[0m\r\n');
  };

  // Send keystrokes
  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(new TextEncoder().encode(data));
    }
  });

  // Resize handler — notify server
  const resizeObserver = new ResizeObserver(() => {
    try {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
      }
    } catch {}
  });
  resizeObserver.observe(root);

  // Cmd+F / Ctrl+F search
  let searchBar = null;

  function toggleSearch() {
    if (searchBar) {
      searchBar.remove();
      searchBar = null;
      searchAddon.clearDecorations();
      term.focus();
      return;
    }
    searchBar = document.createElement('div');
    searchBar.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:6px 12px;background:#161726;border-bottom:1px solid #2d2e3f;display:flex;align-items:center;gap:8px;z-index:100;';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search...';
    input.style.cssText = 'flex:1;background:#0a0b14;color:#e2e8f0;border:1px solid #2d2e3f;border-radius:4px;padding:4px 8px;font-size:13px;outline:none;font-family:inherit;';
    input.addEventListener('input', () => {
      if (input.value) searchAddon.findNext(input.value);
      else searchAddon.clearDecorations();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) searchAddon.findPrevious(input.value);
        else searchAddon.findNext(input.value);
      }
      if (e.key === 'Escape') toggleSearch();
    });
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00d7';
    closeBtn.style.cssText = 'background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;padding:0 4px;';
    closeBtn.onclick = toggleSearch;
    searchBar.appendChild(input);
    searchBar.appendChild(closeBtn);
    document.body.appendChild(searchBar);
    input.focus();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      toggleSearch();
    }
  });
}

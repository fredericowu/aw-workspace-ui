import { useState, useRef, useEffect, useCallback } from 'react';
import { wsUrl } from '../auth';

/**
 * AndroidViewerPanel — the reusable live-view + controls, no window chrome
 * of its own. Live screen mirror of the headless Android emulator (AVD
 * aw_pixel, serial emulator-5554) running on the remote Mac macbook-fred.
 * Unlike RemoteDesktopWindow (real VNC/RFB over a raw TCP bridge), there is
 * no VNC server here — frames arrive as binary PNG WebSocket messages
 * produced by polling `adb exec-out screencap` on the remote machine (see
 * src/api/routes/android_viewer.py). Each frame is painted into an <img>
 * via a Blob object URL, revoking the previous one so we don't leak memory
 * across ~2 frames/second.
 *
 * Click/tap sends `{"type":"tap",x,y}` back over the same socket, mapped
 * from CSS-rendered coordinates to the image's natural (device) pixel
 * size so taps land correctly regardless of how the img is scaled.
 *
 * Used both standalone (AndroidViewerWindow below) and nested as a tab
 * inside RemoteDesktopWindow.
 */
export function AndroidViewerPanel({ toolbarPortalRef }) {
  const [frameUrl, setFrameUrl] = useState(null);
  const [status, setStatus] = useState('connecting'); // connecting | live | error | closed
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const imgRef = useRef(null);
  const prevUrlRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const connect = useCallback(() => {
    setStatus('connecting');
    setError(null);
    let ws;
    try {
      ws = new WebSocket(wsUrl('/ws/android-viewer'));
    } catch (e) {
      setStatus('error');
      setError(String(e));
      return;
    }
    ws.binaryType = 'blob';
    wsRef.current = ws;

    ws.onopen = () => setStatus('live');

    ws.onmessage = (event) => {
      if (!(event.data instanceof Blob)) return;
      const url = URL.createObjectURL(event.data);
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = url;
      setFrameUrl(url);
      setStatus('live');
    };

    ws.onerror = () => setStatus('error');

    ws.onclose = () => {
      setStatus('closed');
      wsRef.current = null;
      // Auto-reconnect after a short delay, same spirit as RemoteDesktop's
      // reconnect toolbar action but automatic since there's no toolbar UI here.
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // don't auto-reconnect on unmount
        wsRef.current.close();
      }
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    };
  }, [connect]);

  const sendControl = (msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  // Map a point on the rendered <img> to device pixel coordinates using
  // naturalWidth/naturalHeight, so taps/swipes land correctly regardless
  // of CSS scaling.
  const toDevicePoint = (clientX, clientY) => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return null;
    const rect = img.getBoundingClientRect();
    return {
      x: Math.round(((clientX - rect.left) / rect.width) * img.naturalWidth),
      y: Math.round(((clientY - rect.top) / rect.height) * img.naturalHeight),
    };
  };

  const handleImageClick = (e) => {
    // A drag that ended in a swipe already fired its own control message
    // (see handlePointerUp) — don't also send a tap for the same gesture.
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    const pt = toDevicePoint(e.clientX, e.clientY);
    if (pt) sendControl({ type: 'tap', x: pt.x, y: pt.y });
  };

  // Scroll/swipe support — the backend already understands a `swipe`
  // control message (see _build_input_command in android_viewer.py),
  // the panel just never sent one. Two input paths feed it:
  //   - Mouse wheel (desktop): each wheel "step" becomes a short vertical
  //     swipe centered on the cursor, in the natural scroll direction.
  //   - Touch/pointer drag: pointerdown→pointermove past a small threshold
  //     marks the gesture a drag; pointerup sends one swipe from the drag
  //     start to end and suppresses the trailing click so it isn't also
  //     treated as a tap.
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const wheelAccumRef = useRef(0);
  const wheelBusyRef = useRef(false);

  const handlePointerDown = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(e.clientX - drag.startX) > 8 || Math.abs(e.clientY - drag.startY) > 8) {
      drag.moved = true;
    }
  };

  const handlePointerUp = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.moved) return;
    const start = toDevicePoint(drag.startX, drag.startY);
    const end = toDevicePoint(e.clientX, e.clientY);
    if (!start || !end) return;
    suppressClickRef.current = true;
    sendControl({ type: 'swipe', x1: start.x, y1: start.y, x2: end.x, y2: end.y, duration_ms: 150 });
  };

  const handleWheel = (e) => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    wheelAccumRef.current += e.deltaY;
    if (wheelBusyRef.current || Math.abs(wheelAccumRef.current) < 40) return;
    const scrollingDown = wheelAccumRef.current > 0;
    wheelAccumRef.current = 0;

    const pt = toDevicePoint(e.clientX, e.clientY);
    if (!pt) return;
    const offset = Math.round(img.naturalHeight * 0.12);
    // Scrolling down = content moves up = finger swipes from bottom to top.
    const y1 = scrollingDown ? Math.min(pt.y + offset, img.naturalHeight - 1) : Math.max(pt.y - offset, 0);
    const y2 = scrollingDown ? Math.max(pt.y - offset, 0) : Math.min(pt.y + offset, img.naturalHeight - 1);
    sendControl({ type: 'swipe', x1: pt.x, y1, x2: pt.x, y2, duration_ms: 120 });

    wheelBusyRef.current = true;
    setTimeout(() => { wheelBusyRef.current = false; }, 180);
  };

  const reconnectNow = () => {
    clearTimeout(reconnectTimerRef.current);
    if (wsRef.current) wsRef.current.close();
    connect();
  };

  // Forward the physical keyboard to the device: printable characters go
  // through `input text`, everything else maps to a keyevent. Requires the
  // panel to have focus (it's given tabIndex=0 and focused on click) since
  // there's no reliable way to capture keys typed into a remote <img>.
  const KEYCODE_MAP = {
    Enter: 'KEYCODE_ENTER',
    Backspace: 'KEYCODE_DEL',
    Delete: 'KEYCODE_FORWARD_DEL',
    Tab: 'KEYCODE_TAB',
    Escape: 'KEYCODE_BACK',
    ArrowLeft: 'KEYCODE_DPAD_LEFT',
    ArrowRight: 'KEYCODE_DPAD_RIGHT',
    ArrowUp: 'KEYCODE_DPAD_UP',
    ArrowDown: 'KEYCODE_DPAD_DOWN',
  };

  const handleKeyDown = (e) => {
    if (e.key.length === 1) {
      e.preventDefault();
      sendControl({ type: 'text', text: e.key });
      return;
    }
    const code = KEYCODE_MAP[e.key];
    if (code) {
      e.preventDefault();
      sendControl({ type: 'key', code });
    }
  };

  const statusLabel = {
    connecting: 'Connecting…',
    live: 'Live',
    error: 'Connection error',
    closed: 'Disconnected — reconnecting…',
  }[status];

  const statusColor = {
    connecting: 'bg-amber-400',
    live: 'bg-green-400',
    error: 'bg-red-400',
    closed: 'bg-red-400 animate-pulse',
  }[status];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1 shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
        <span className="text-[10px] text-[var(--color-text-muted)]">{statusLabel}</span>
        <div className="flex-1" />
        <button
          onClick={() => sendControl({ type: 'key', code: 'KEYCODE_BACK' })}
          className="px-4 py-2 rounded hover:bg-white/10 transition-colors text-[22px] leading-none text-[var(--color-text-muted)]"
          title="Back"
        >
          ◁
        </button>
        <button
          onClick={() => sendControl({ type: 'key', code: 'KEYCODE_HOME' })}
          className="px-4 py-2 rounded hover:bg-white/10 transition-colors text-[22px] leading-none text-[var(--color-text-muted)]"
          title="Home"
        >
          ○
        </button>
        <button
          onClick={() => sendControl({ type: 'key', code: 'KEYCODE_APP_SWITCH' })}
          className="px-4 py-2 rounded hover:bg-white/10 transition-colors text-[22px] leading-none text-[var(--color-text-muted)]"
          title="Recents"
        >
          ▢
        </button>
        <button
          onClick={reconnectNow}
          className="p-1.5 rounded hover:bg-white/10 transition-colors"
          title="Reconnect"
        >
          <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" />
          </svg>
        </button>
      </div>
      <div
        className="flex-1 relative bg-black flex items-center justify-center overflow-hidden outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {frameUrl ? (
          <img
            ref={imgRef}
            src={frameUrl}
            onClick={(e) => { e.currentTarget.parentElement.focus(); handleImageClick(e); }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
            alt="Android emulator screen"
            className="max-w-full max-h-full cursor-pointer select-none touch-none"
            draggable={false}
          />
        ) : (
          <div className="text-xs text-[var(--color-text-muted)]">
            {status === 'error' ? (error || 'Connection error') : 'Waiting for first frame…'}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * AndroidViewerWindow — standalone floating-window wrapper around
 * AndroidViewerPanel, with its own title bar (mirrors RemoteDesktopWindow's
 * chrome). Not currently opened directly from the top menu — the Android
 * Emulator viewer is nested as a tab inside RemoteDesktopWindow instead —
 * but kept as an independently usable component per the window-manager
 * convention (windowKey/onClose/onMaximize/isMaximized props).
 */
export default function AndroidViewerWindow({ windowKey, onClose, onMaximize, isMaximized }) {
  return (
    <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
      {/* Header */}
      <div className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" />
          </svg>
          <span className="text-xs font-medium text-[var(--color-text-primary)] shrink-0">Android Emulator</span>
        </div>
        <div className="flex items-center gap-1.5 no-drag" onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={() => onMaximize?.(windowKey)} className="p-1.5 rounded hover:bg-white/10 transition-colors" title={isMaximized ? 'Restore' : 'Maximize'}>
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
          </button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 transition-colors" title="Close">
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        <AndroidViewerPanel />
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../auth';
import { AndroidViewerPanel } from './AndroidViewerWindow';

const ANDROID_ID = '__android__';

/**
 * RemoteDesktopWindow — a floating panel embedding the full noVNC web client
 * (vendored at src/app/public/novnc/, same UI as the aw-windows/aw-browser
 * apps' vnc.html — connect toolbar, clipboard, Ctrl+Alt+Del, quality/scale
 * settings) via iframe, connected through /ws/remote-desktop/{id} (a raw
 * byte bridge to the saved connection's host:port — see
 * src/api/routes/remote_desktop.py). Mirrors WhiteboardWindow's chrome.
 */

function novncUrl(connId, password) {
  const params = new URLSearchParams({
    path: `ws/remote-desktop/${connId}`,
    autoconnect: 'true',
    resize: 'scale',
    reconnect: 'true',
  });
  if (password) params.set('password', password);
  return `/novnc/vnc.html?${params.toString()}`;
}

async function api(method, path, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await apiFetch(path, opts);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch (_e) { detail = await res.text(); }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json();
}

// ── Connection manager modal ────────────────────────────────────────────────

// Shared header — matches the window-chrome close icon used across the app
// (see TerminalWindow/WhiteboardWindow) instead of the ad-hoc "Close" text
// link this used to have.
function ModalHeader({ title, onClose }) {
  return (
    <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between shrink-0">
      <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{title}</div>
      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors shrink-0"
        title="Close"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

function ConnectionEditor({ conn, onClose, onSaved }) {
  const [name, setName] = useState(conn?.name || '');
  const [host, setHost] = useState(conn?.host || '127.0.0.1');
  const [port, setPort] = useState(conn?.port || '');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setErr(null);
    if (!name.trim() || !host.trim() || !port) { setErr('name, host and port are required'); return; }
    setSaving(true);
    try {
      const body = { name: name.trim(), host: host.trim(), port: Number(port) };
      if (password) body.password = password;
      if (conn) await api('PUT', `/api/remote-desktop/connections/${conn.id}`, body);
      else await api('POST', '/api/remote-desktop/connections', body);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded w-[380px] max-w-[90vw] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader title={conn ? `Edit: ${conn.name}` : 'New connection'} onClose={onClose} />
        <div className="p-4 flex flex-col gap-3">
          {err && <div className="text-xs text-red-300">{err}</div>}
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs" />
          <div className="flex gap-2">
            <input placeholder="Host (e.g. 127.0.0.1)" value={host} onChange={(e) => setHost(e.target.value)}
              className="flex-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs" />
            <input placeholder="Port" type="number" value={port} onChange={(e) => setPort(e.target.value)}
              className="w-20 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs" />
          </div>
          <input
            placeholder={conn?.has_password ? 'Password (leave blank to keep current)' : 'Password (optional)'}
            type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs"
          />
        </div>
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-2.5 py-1 rounded text-xs bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)]">Cancel</button>
          <button onClick={save} disabled={saving} className="px-2.5 py-1 rounded text-xs bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30 text-[var(--color-accent)] disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionsManager({ connections, onClose, onChanged }) {
  const [editing, setEditing] = useState(null); // null = closed, {} = new, conn = edit
  const remove = async (id) => {
    if (!confirm('Delete this connection?')) return;
    await api('DELETE', `/api/remote-desktop/connections/${id}`);
    onChanged();
  };
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded w-[440px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader title="Manage connections" onClose={onClose} />
        <div className="p-3 overflow-y-auto flex-1 flex flex-col gap-2">
          {connections.length === 0 && (
            <div className="text-xs text-[var(--color-text-muted)] py-4 text-center">No connections yet.</div>
          )}
          {connections.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded border border-[var(--color-border)]">
              <div className="min-w-0">
                <div className="text-xs font-medium text-[var(--color-text-primary)] truncate">{c.name}</div>
                <div className="text-[10px] text-[var(--color-text-muted)] font-mono">{c.host}:{c.port}{c.has_password ? ' · saved password' : ''}</div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => setEditing(c)} className="px-2 py-1 rounded text-[11px] bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)]">Edit</button>
                <button onClick={() => remove(c.id)} className="px-2 py-1 rounded text-[11px] bg-red-500/15 hover:bg-red-500/25 text-red-300">Delete</button>
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-[var(--color-border)]">
          <button onClick={() => setEditing({})} className="w-full px-2.5 py-1.5 rounded text-xs bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30 text-[var(--color-accent)]">
            + Add connection
          </button>
        </div>
      </div>
      {editing !== null && (
        <ConnectionEditor
          conn={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

// ── Main window ──────────────────────────────────────────────────────────────

export default function RemoteDesktopWindow({ windowKey, onClose, onMaximize, isMaximized }) {
  // The Android Emulator live view (screen-mirror over the remote-agent's
  // exec channel, no VNC server involved — see AndroidViewerWindow.jsx) is
  // just another entry in the connection picker, not a separate tab.
  const [connections, setConnections] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [managerOpen, setManagerOpen] = useState(false);
  const [iframeSrc, setIframeSrc] = useState('');
  const [iframeKey, setIframeKey] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 });
  const pickerAnchorRef = useRef(null);
  const iframeRef = useRef(null);

  const isAndroid = selectedId === ANDROID_ID;
  const items = [...connections.map((c) => ({ ...c, kind: 'vnc' })), { id: ANDROID_ID, name: 'Android Emulator', kind: 'android' }];
  const selectedItem = items.find((it) => it.id === selectedId);

  const refreshConnections = useCallback(async () => {
    const data = await api('GET', '/api/remote-desktop/connections');
    setConnections(data.connections || []);
    return data.connections || [];
  }, []);

  useEffect(() => {
    refreshConnections().then((conns) => {
      if (!selectedId) setSelectedId(conns.length ? conns[0].id : ANDROID_ID);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async (connId) => {
    if (!connId) { setIframeSrc(''); return; }
    const { password } = await api('GET', `/api/remote-desktop/connections/${connId}/credentials`);
    setIframeSrc(novncUrl(connId, password));
    setIframeKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (selectedId && selectedId !== ANDROID_ID) connect(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const openPicker = () => {
    const rect = pickerAnchorRef.current?.getBoundingClientRect();
    if (rect) setPickerPos({ top: rect.bottom + 4, left: rect.left });
    setPickerOpen(true);
  };

  return (
    <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
      {/* Header */}
      <div className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" />
          </svg>
          <span className="text-xs font-medium text-[var(--color-text-primary)] shrink-0">Remote Desktop</span>
        </div>
        <div className="flex items-center gap-1.5 no-drag" onMouseDown={(e) => e.stopPropagation()}>
          <button
            ref={pickerAnchorRef}
            onClick={() => (pickerOpen ? setPickerOpen(false) : openPicker())}
            className="flex items-center gap-1 text-[11px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text-primary)] max-w-[180px] hover:border-[var(--color-accent)] transition-colors"
            title="Switch connection"
          >
            <span className="truncate">{selectedItem ? selectedItem.name : 'No connections'}</span>
            <svg className={`w-3 h-3 shrink-0 text-[var(--color-text-muted)] transition-transform ${pickerOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {pickerOpen && createPortal(
            <div
              className="fixed w-72 max-h-80 overflow-y-auto bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl shadow-black/60"
              style={{ top: pickerPos.top, left: pickerPos.left, zIndex: 99999 }}
            >
              {items.map((it) => {
                const isActive = it.id === selectedId;
                return (
                  <button
                    key={it.id}
                    onClick={() => { setSelectedId(it.id); setPickerOpen(false); }}
                    className={`w-full text-left px-3 py-2 hover:bg-white/5 transition-colors border-b border-[var(--color-border)] last:border-0 ${isActive ? 'bg-[var(--color-accent)]/10' : ''}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-[var(--color-accent)]' : ''}`} />
                      <div className="text-xs font-medium text-[var(--color-text-primary)] truncate">{it.name}</div>
                      {isActive && <span className="text-[10px] text-[var(--color-accent)] shrink-0 ml-auto">active</span>}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 pl-3 truncate">
                      {it.kind === 'android' ? 'Live screen mirror' : `${it.host}:${it.port}`}
                    </div>
                  </button>
                );
              })}
              <button
                onClick={() => { setPickerOpen(false); setManagerOpen(true); }}
                className="w-full text-left px-3 py-2 text-xs text-[var(--color-accent)] hover:bg-white/5 flex items-center gap-1.5"
              >
                <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                Manage connections
              </button>
            </div>,
            document.body
          )}
          {!isAndroid && (
            <button
              onClick={() => selectedId && connect(selectedId)}
              className="p-1.5 rounded hover:bg-white/10 transition-colors"
              title="Reconnect"
            >
              <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" />
              </svg>
            </button>
          )}
          {/* Opens the device's native on-screen keyboard by focusing noVNC's
              own hidden keyboard-capture input inside the iframe (same
              mechanism as noVNC's own touch "keyboard" control-bar button —
              see app/ui.js's showVirtualKeyboard/UI.toggleVirtualKeyboard,
              exposed on window.UI for this same-origin call). Surfacing it
              here means mobile users don't have to find noVNC's own
              collapsed control-bar handle inside the small embedded view. */}
          {!isAndroid && selectedId && (
            <button
              onClick={() => iframeRef.current?.contentWindow?.UI?.toggleVirtualKeyboard?.()}
              className="p-1.5 rounded hover:bg-white/10 transition-colors"
              title="Toggle keyboard"
            >
              <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" />
              </svg>
            </button>
          )}
          {/* Pop out to new window — same window.open(popup=1,...) pattern
              used by the workspace-app windows (see WindowManager.jsx),
              so it behaves identically to e.g. the Linux app's pop-out:
              a same-origin page that opens edge-to-edge (a real fullscreen
              tab on mobile, a resizable window on desktop). VNC pops out
              to the noVNC page; Android has no URL of its own so it pops
              out to the standalone android-viewer.html entry instead. */}
          <button
            onClick={async () => {
              if (isAndroid) {
                window.open('/android-viewer.html', 'remote-desktop-android', 'popup=1,width=1280,height=800');
                onClose();
                return;
              }
              if (!selectedId) return;
              const { password } = await api('GET', `/api/remote-desktop/connections/${selectedId}/credentials`);
              window.open(novncUrl(selectedId, password), `remote-desktop-${selectedId}`, 'popup=1,width=1280,height=800');
              onClose();
            }}
            disabled={!selectedId}
            className="p-1.5 rounded hover:bg-white/10 transition-colors disabled:opacity-30"
            title="Pop out to new window"
          >
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
          <button onClick={() => onMaximize?.(windowKey)} className="p-1.5 rounded hover:bg-white/10 transition-colors" title={isMaximized ? 'Restore' : 'Maximize'}>
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
          </button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 transition-colors" title="Close">
            <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      {/* Content — VNC connections: the full noVNC web client (toolbar,
          clipboard, quality, Ctrl+Alt+Del, fullscreen — same UI as the
          Windows/Browser apps). Android: live screen-mirror, see
          AndroidViewerPanel. Which one shows is picked from the connection
          switcher above, not a separate tab. */}
      <div className="flex-1 relative bg-black">
        {isAndroid ? (
          <div className="absolute inset-0">
            <AndroidViewerPanel />
          </div>
        ) : !selectedId ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
            No connections yet — click "Manage connections" to add one.
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            key={iframeKey}
            src={iframeSrc}
            className="absolute inset-0 w-full h-full border-0"
            title="Remote Desktop"
          />
        )}
      </div>
      {pickerOpen && (
        <div className="fixed inset-0 z-[99998]" onClick={() => setPickerOpen(false)} />
      )}
      {managerOpen && (
        <ConnectionsManager
          connections={connections}
          onClose={() => setManagerOpen(false)}
          onChanged={refreshConnections}
        />
      )}
    </div>
  );
}

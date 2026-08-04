import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, wsUrl } from '../auth';

/**
 * Top-right floating notification stack — replaces the NinjaBuddy speech-
 * bubble system. Consumes the same `/ws/notifications` feed and renders
 * stacked cards in the same corner as PromptNotifications.
 *
 * For notifications with `source: "task"`, clicking the card opens the
 * Tasks floating window (via window.__awOpenAppWindow('tasks.main'),
 * aw-app-tasks's own component-mode window body) and broadcasts
 * `aw-focus-task` so it can scroll-to and auto-expand the row.
 *
 * Per-notification color follows level (info / success / warning / error).
 * Auto-dismisses after 30s unless hovered.
 */

const LEVEL_STYLES = {
  info:    { border: '#6366f1', accent: '#a5b4fc', icon: '💬' },
  success: { border: '#22c55e', accent: '#86efac', icon: '✓' },
  warning: { border: '#f59e0b', accent: '#fcd34d', icon: '⚠' },
  error:   { border: '#ef4444', accent: '#fca5a5', icon: '✕' },
};

export default function TopNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [hoveredId, setHoveredId] = useState(null);
  const wsRef = useRef(null);

  // Connect WS — mirrors the NinjaBuddy logic but renders elsewhere.
  useEffect(() => {
    let closed = false;
    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(wsUrl('/ws/notifications'));
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'ninja_init' && msg.notifications?.length > 0) {
            setNotifications((prev) => [...prev, ...msg.notifications]);
          } else if (msg.type === 'ninja_notification' && msg.notification) {
            const superseded = new Set(msg.superseded_ids || []);
            setNotifications((prev) => {
              const filtered = superseded.size > 0 ? prev.filter((n) => !superseded.has(n.id)) : prev;
              // Cap the stack at 5; newest at the top.
              return [msg.notification, ...filtered].slice(0, 5);
            });
          }
        } catch (_) { /* ignore malformed */ }
      };
      ws.onclose = () => {
        if (!closed) setTimeout(connect, 5000);
      };
      ws.onerror = () => { try { ws.close(); } catch {} };
    };
    connect();
    return () => {
      closed = true;
      if (wsRef.current) { try { wsRef.current.close(); } catch {} }
    };
  }, []);

  // Accept locally-dispatched notifications (client-side errors, constraint
  // violations, etc.) via a CustomEvent so any module can push a notification
  // without needing a WebSocket round-trip.
  // Usage: window.dispatchEvent(new CustomEvent('aw-notification', {
  //   detail: { level: 'error', title: 'Oops', message: 'Something failed' }
  // }))
  useEffect(() => {
    const handler = (e) => {
      const { level = 'error', title, message } = e.detail || {};
      if (!message) return;
      const notif = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        level,
        title,
        message,
        created_at: Date.now() / 1000,
      };
      setNotifications((prev) => [notif, ...prev].slice(0, 5));
    };
    window.addEventListener('aw-notification', handler);
    return () => window.removeEventListener('aw-notification', handler);
  }, []);

  // Auto-dismiss after 30 seconds unless hovered.
  // Also marks expired notifications as read in the backend so they don't
  // reappear on a hard refresh (DB status stays 'delivered' otherwise).
  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = setInterval(() => {
      if (hoveredId) return;
      const now = Date.now() / 1000;
      setNotifications((prev) => {
        const expired = prev.filter((n) => {
          const created = n.created_at || n.timestamp || now;
          return now - created >= 30;
        });
        // Persist dismissal for expired notifications so they won't come back
        // on reconnect/refresh (backend keeps 'delivered' without this call).
        expired.forEach((n) => {
          if (typeof n.id === 'number') {
            apiFetch(`/api/notify/${n.id}`, { method: 'DELETE' }).catch(() => {});
          }
        });
        return prev.filter((n) => {
          const created = n.created_at || n.timestamp || now;
          return now - created < 30;
        });
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [notifications.length, hoveredId]);

  const dismiss = useCallback((notif) => {
    setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    if (typeof notif.id === 'number') {
      apiFetch(`/api/notify/${notif.id}`, { method: 'DELETE' }).catch(() => {});
    }
  }, []);

  const onCardClick = useCallback((notif) => {
    if (notif.source === 'task' && notif.external_id) {
      // external_id is the task id; open the Tasks window and ask its
      // window body to focus this task. Defer the focus event with a
      // microtask so the newly-mounted window body has registered its
      // 'aw-focus-task' listener before we dispatch — otherwise the event
      // fires into the void.
      window.__awOpenAppWindow?.('tasks.main');
      const tid = notif.external_id;
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('aw-focus-task', { detail: { taskId: tid } }));
      }, 50);
      dismiss(notif);
    } else if (notif.url) {
      window.open(notif.url, '_blank', 'noopener,noreferrer');
    }
  }, [dismiss]);

  if (notifications.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 56, // below PromptNotifications which sits at 16
      right: 16,
      zIndex: 9998,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      width: 380,
      pointerEvents: 'auto',
    }}>
      {notifications.map((n) => {
        const style = LEVEL_STYLES[n.level] || LEVEL_STYLES.info;
        const isTask = n.source === 'task';
        const ts = n.created_at || n.timestamp;
        return (
          <div
            key={n.id}
            onMouseEnter={() => setHoveredId(n.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => onCardClick(n)}
            style={{
              background: 'var(--color-bg-header, #15171d)',
              border: `1px solid ${style.border}`,
              borderRadius: 8,
              padding: '8px 10px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              cursor: (isTask || n.url) ? 'pointer' : 'default',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            title={isTask ? 'Click to open this task' : (n.url ? 'Click to open' : '')}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 12, color: style.accent, marginTop: 1 }}>{style.icon}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {n.title && (
                    <div style={{
                      fontSize: 11, fontWeight: 700,
                      color: style.accent, marginBottom: 2,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {n.title}
                    </div>
                  )}
                  <div style={{
                    fontSize: 12,
                    color: 'var(--color-text-primary, #e2e8f0)',
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  }}>
                    {n.message}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--color-text-muted, #64748b)', marginTop: 3 }}>
                    {ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    {n.source && (
                      <span style={{ marginLeft: 6, fontFamily: 'monospace' }}>· {n.source}</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); dismiss(n); }}
                style={{
                  background: 'none', border: 'none',
                  color: 'var(--color-text-muted, #94a3b8)',
                  cursor: 'pointer', padding: 2, fontSize: 14, lineHeight: 1,
                }}
                title="Dismiss"
              >×</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

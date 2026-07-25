import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../auth';
import { getAwConfig } from '../hooks/useComponentStatus';

/**
 * Floating notification stack for Claude interactive prompts.
 *
 * Listens for 'aw-prompt-notification' events dispatched by useComponentStatus
 * and displays actionable notifications in the top-right corner.
 *
 * Controlled by show_claude_prompts in aw.json (default: true).
 *
 * Each notification shows:
 * - Terminal name + prompt title (collapsed)
 * - Full description + option buttons (expanded on hover)
 * - Text input for custom response
 * - Dismiss button
 *
 * Sends responses via REST POST /api/terminals/{id}/write.
 */
export default function PromptNotifications({ terminals }) {
  const [notifications, setNotifications] = useState([]);
  const [hoveredId, setHoveredId] = useState(null);
  const [enabled, setEnabled] = useState(true);

  // Load setting from aw.json
  useEffect(() => {
    getAwConfig().then((cfg) => {
      if (cfg?.show_claude_prompts === false) setEnabled(false);
    }).catch(() => {});
  }, []);

  // Re-check on config changes (settings save)
  useEffect(() => {
    const handler = () => {
      getAwConfig().then((cfg) => {
        if (cfg?.show_claude_prompts === false) setEnabled(false);
        else setEnabled(true);
      }).catch(() => {});
    };
    window.addEventListener('aw-config-changed', handler);
    return () => window.removeEventListener('aw-config-changed', handler);
  }, []);

  // Listen for prompt notifications
  useEffect(() => {
    const handler = (e) => {
      const data = e.detail;
      const id = `${data.session_id}-${data.timestamp}`;
      setNotifications((prev) => {
        // Deduplicate
        if (prev.some((n) => n.id === id)) return prev;
        // Stack max 5
        const next = [...prev, { ...data, id, expanded: false }];
        return next.slice(-5);
      });
    };
    window.addEventListener('aw-prompt-notification', handler);
    return () => window.removeEventListener('aw-prompt-notification', handler);
  }, []);

  // Auto-dismiss after 60 seconds, but pause while any notification is hovered
  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = setInterval(() => {
      if (hoveredId) return; // pause expiry while hovering
      const now = Date.now() / 1000;
      setNotifications((prev) => prev.filter((n) => now - n.timestamp < 60));
    }, 5000);
    return () => clearInterval(timer);
  }, [notifications.length, hoveredId]);

  const dismiss = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const sendToTerminal = useCallback((sessionId, text, sendEnter = true) => {
    apiFetch(`/api/terminals/${sessionId}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, send_enter: sendEnter }),
    }).catch((err) => console.error('Failed to send to terminal:', err));
  }, []);

  if (!enabled || notifications.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      width: '500px',
      pointerEvents: 'auto',
    }}>
      {notifications.map((n) => {
        const isExpanded = hoveredId === n.id;
        return (
          <div
            key={n.id}
            onMouseEnter={() => setHoveredId(n.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{
              background: 'var(--color-bg-header, #1a1b2e)',
              border: '1px solid var(--color-accent, #6366f1)',
              borderRadius: '10px',
              padding: '10px 14px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              maxHeight: isExpanded ? '400px' : '48px',
              overflow: 'hidden',
            }}
          >
            {/* Header — always visible */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: '14px' }}>💬</span>
                <span style={{
                  fontSize: '11px',
                  color: 'var(--color-accent, #6366f1)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>{n.terminal_name || n.session_id}</span>
                <span style={{
                  fontSize: '12px',
                  color: 'var(--color-text-primary, #e2e8f0)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{n.title}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                style={{
                  background: 'none', border: 'none', color: 'var(--color-text-muted, #64748b)',
                  cursor: 'pointer', padding: '2px', fontSize: '14px', lineHeight: 1,
                }}
              >×</button>
            </div>

            {/* Expanded content — visible on hover */}
            {isExpanded && (
              <div style={{ marginTop: '8px' }}>
                {/* Description */}
                {n.description && (
                  <p style={{
                    fontSize: '11px',
                    color: 'var(--color-text-muted, #94a3b8)',
                    margin: '0 0 8px 0',
                    lineHeight: 1.4,
                    whiteSpace: 'pre-wrap',
                  }}>{n.description}</p>
                )}

                {/* Option buttons */}
                {n.options && n.options.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
                    {n.options.map((opt, i) => (
                      <button
                        key={i}
                        onClick={(e) => {
                          e.stopPropagation();
                          sendToTerminal(n.session_id, opt.key);
                          dismiss(n.id);
                        }}
                        style={{
                          background: 'var(--color-accent, #6366f1)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '6px 12px',
                          fontSize: '12px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'opacity 0.15s',
                          textAlign: 'left',
                        }}
                        onMouseEnter={(e) => e.target.style.opacity = '0.8'}
                        onMouseLeave={(e) => e.target.style.opacity = '1'}
                      >{opt.key}. {opt.label}</button>
                    ))}
                  </div>
                )}

              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

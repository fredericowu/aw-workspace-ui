import { useEffect, useState } from 'react';
import { startBootStatus } from '../apps/bootStatus';

// Non-blocking corner chip while core's boot reconcile installs apps.
// pointer-events:none so it can never cover or disable anything.
export default function BootStatusChip() {
  const [s, setS] = useState(null);
  useEffect(() => startBootStatus(setS), []);

  let text = null;
  if (s?.phase === 'reconciling' && s.total > 0) {
    text = `Setting up apps ${Math.min(s.loaded ?? 0, s.total)}/${s.total}`;
  } else if (s?.phase === 'failed') {
    text = 'Some apps failed to set up. Check Apps for details.';
  }
  if (!text) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="boot-status-chip"
      style={{
        position: 'fixed', right: 12, bottom: 12, zIndex: 2000,
        pointerEvents: 'none', padding: '6px 12px', borderRadius: 999,
        font: '12px system-ui, sans-serif', color: '#e8eaed',
        background: s.phase === 'failed' ? 'rgba(160,50,50,0.92)' : 'rgba(40,44,52,0.92)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      }}
    >
      {text}
    </div>
  );
}

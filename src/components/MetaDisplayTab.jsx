import { useState, useEffect, useCallback, useRef } from 'react';

const TTL = 300; // seconds — must match pair.py TOKEN_TTL_SECONDS

function useQrSession() {
  const [qrSrc, setQrSrc] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(TTL);
  const [expired, setExpired] = useState(false);
  const timerRef = useRef(null);

  const refresh = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setExpired(false);
    setSecondsLeft(TTL);
    setQrSrc(`/api/meta/pair/qr.png?t=${Date.now()}`);

    timerRef.current = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          setExpired(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    refresh();
    return () => clearInterval(timerRef.current);
  }, [refresh]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return { qrSrc, expired, countdown: `${mm}:${ss}`, secondsLeft, refresh };
}

export default function MetaDisplayGlassesSection() {
  const { qrSrc, expired, countdown, secondsLeft, refresh } = useQrSession();
  const pct = (secondsLeft / TTL) * 100;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-text-muted)]">
        Scan the QR with your phone to add the AW chat app to your glasses and authenticate in one step.
      </p>

      <div className="flex gap-6 items-start">
        {/* QR frame */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          <div className={`relative rounded-lg overflow-hidden border ${expired ? 'border-red-500/50' : 'border-[var(--color-border)]'} bg-white p-2`}>
            {qrSrc && (
              <img
                src={qrSrc}
                alt="Pairing QR code"
                className={`w-40 h-40 ${expired ? 'opacity-20 blur-sm' : ''}`}
                style={{ imageRendering: 'pixelated' }}
              />
            )}
            {expired && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <span className="text-[10px] font-medium text-red-400">QR expired</span>
                <button
                  onClick={refresh}
                  className="px-2 py-1 text-[10px] bg-[var(--color-accent)] text-white rounded hover:opacity-90 transition-opacity"
                >
                  Refresh
                </button>
              </div>
            )}
          </div>

          {/* TTL bar */}
          {!expired && (
            <div className="w-40 space-y-1">
              <div className="h-0.5 rounded-full bg-[var(--color-border)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: pct > 40 ? 'var(--color-accent)' : pct > 20 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-[var(--color-text-muted)]">Expires {countdown}</span>
                <button onClick={refresh} className="text-[10px] text-[var(--color-accent)] hover:underline">
                  Refresh
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Steps */}
        <ol className="space-y-2.5 text-xs text-[var(--color-text-muted)] pt-1">
          <li className="flex gap-2">
            <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold">1</span>
            Point your phone camera at the QR
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold">2</span>
            Tap the notification — Meta AI app registers <strong className="text-[var(--color-text-secondary)]">AW Glasses</strong>
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold">3</span>
            Open <strong className="text-[var(--color-text-secondary)]">AW Glasses</strong> from the glasses app drawer — it auto-authenticates
          </li>
          <li className="pt-2">
            <a
              href="/meta/pair"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              Open full pairing page →
            </a>
          </li>
        </ol>
      </div>
    </div>
  );
}

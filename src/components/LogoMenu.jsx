import { useState, useRef, useEffect } from 'react';

/**
 * "❯ aw ⌄" logo wordmark + account dropdown. Same click-toggle /
 * click-outside-closes idiom as WorkspaceNav/AppsNav right next to it
 * (not the full-height slide-in drawer, which is now notifications-only —
 * see the Profile button in App.jsx). Holds the account-level actions that
 * used to live in the profile drawer: Console, Settings, Log Out.
 *
 * "Settings (old)" (the legacy SettingsPanel entry) is wired via
 * onOpenSettingsOld but gated off with `false &&` per the Settings
 * rename/promote card — kept so the handler isn't orphaned, not rendered,
 * not in the accessibility tree.
 */
export default function LogoMenu({ onOpenSettings, onOpenSettingsOld, onLogout }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div className="relative flex items-center gap-1 shrink-0" ref={rootRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-1 rounded border border-[var(--color-border)] bg-white/[0.03] transition-colors hover:bg-white/5 cursor-pointer"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="72" height="21" viewBox="0 0 240 70" className="shrink-0" style={{ marginTop: 3 }}>
          <text x="0" y="50" fontFamily="ui-monospace, Menlo, monospace" fontSize="46" fontWeight="700" fill="var(--color-accent)">&#10095;</text>
          <text x="44" y="50" fontFamily="Inter" fontSize="46" fontWeight="800" fill="var(--color-text-primary)" letterSpacing="-1">aw</text>
        </svg>
        <svg
          className={`w-3 h-3 shrink-0 text-[var(--color-text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-2 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-2"
          style={{ minWidth: 200 }}
        >
          <a
            href="https://console.aw.tekflox.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer text-left"
            aria-label="Open Console (account admin) in a new tab"
          >
            <svg className="w-4 h-4 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
            <span className="text-[13px] text-[var(--color-text-primary)]">Console</span>
          </a>

          <button
            onClick={() => { setOpen(false); onOpenSettings?.(); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer text-left"
            aria-label="Open Settings"
          >
            <svg className="w-4 h-4 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            <span className="text-[13px] text-[var(--color-text-primary)]">Settings</span>
          </button>

          {false && (
            <button
              onClick={() => { setOpen(false); onOpenSettingsOld?.(); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer text-left"
              aria-label="Open Settings (old)"
            >
              <svg className="w-4 h-4 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
              <span className="text-[13px] text-[var(--color-text-primary)]">Settings (old)</span>
            </button>
          )}

          <button
            onClick={async () => { setOpen(false); await onLogout?.(); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer text-left text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
            aria-label="Log out"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
            </svg>
            <span className="text-[13px]">Log Out</span>
          </button>
        </div>
      )}
    </div>
  );
}

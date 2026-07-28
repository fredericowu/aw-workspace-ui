import AppWindow from './AppWindow';
import ErrorBoundary from './ErrorBoundary';

// Real WindowManager-integrated chrome (drag/resize/maximize/close, same
// header pattern as DiffWindow/PresentationWindow) for a decoupled app's
// declarative window (aw-app.json's contributes.windows[].body: {type:
// "declarative", spec: "windows/main.json"}).
//
// Before this existed, opening one of these (via a nav entry's onOpenWindow,
// or an Installed Apps row click) rendered a small ad-hoc centered modal in
// App.jsx instead — no drag, no resize, no maximize, not part of the
// window-manager's z-order/persisted-position system every other window
// type gets for free. That modal was originally built for tiny single-action
// popups (e.g. aw-app-git's "Sign in with GitHub"), not a full app UI —
// confirmed as the wrong fit for aw-app-whiteboard's window (2026-07-28).
export default function AppDeclarativeWindow({ title, spec, onClose, onMaximize, isMaximized, windowKey, onFocus }) {
  return (
    <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
      <div
        className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0"
        onMouseDown={onFocus}
      >
        <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
          {title || 'App'}
        </span>
        <div className="flex items-center gap-1 no-drag" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => onMaximize?.(windowKey)}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="app-declarative-window-body flex-1 overflow-auto no-drag" onMouseDown={(e) => e.stopPropagation()}>
        <ErrorBoundary label={title || 'App'}>
          <AppWindow spec={spec} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

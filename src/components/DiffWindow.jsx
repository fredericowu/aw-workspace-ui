export default function DiffWindow({ diff, onClose, onMaximize, isMaximized, windowKey, onFocus }) {
  const htmlUrl = diff?.id ? `/api/diff/${diff.id}/html` : null;

  return (
    <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
      {/* Header */}
      <div
        className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0"
        onMouseDown={onFocus}
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
            <line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>
          </svg>
          <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
            {diff?.title || 'Diff'}
          </span>
        </div>
        <div className="flex items-center gap-1 no-drag" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => onMaximize?.(windowKey)}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Diff iframe */}
      <div className="flex-1 overflow-hidden">
        {htmlUrl ? (
          <iframe
            src={htmlUrl}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms"
            title={diff?.title || 'Diff'}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
            Diff not available
          </div>
        )}
      </div>
    </div>
  );
}

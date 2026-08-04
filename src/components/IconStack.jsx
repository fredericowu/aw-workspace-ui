// IconStack — a single trigger icon (the last-picked item) that expands
// DOWNWARD into a dropdown on hover, mirroring the top bar's Workspace menu
// popover — not a lateral/inline row. Clicking the trigger re-runs its own
// action; picking a different item from the dropdown runs that item's
// action and becomes the new trigger. Generic — first user is the top
// bar's window-layout buttons (Side by side / Stacked / Grid), but any
// {id, icon, title, onClick} list works.
import { useCallback, useEffect, useRef, useState } from 'react';

export default function IconStack({ items, selectedId, onSelect, className = '' }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);
  const rootRef = useRef(null);

  const selected = items.find((i) => i.id === selectedId) || items[0];

  const handleEnter = useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);
  const handleLeave = useCallback(() => {
    clearTimeout(closeTimer.current);
    // Mirrors the top-bar Workspace menu's close delay — long enough to
    // survive a normal move from the trigger down into the dropdown.
    closeTimer.current = setTimeout(() => setOpen(false), 400);
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Click-outside-to-close, same pattern as the Workspace menu.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        clearTimeout(closeTimer.current);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const pick = (item) => {
    onSelect?.(item.id);
    item.onClick?.();
    setOpen(false);
  };

  if (!selected) return null;

  return (
    <div
      className={`relative ${className}`}
      ref={rootRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        type="button"
        onClick={() => pick(selected)}
        className="p-1 rounded hover:bg-white/10 transition-colors"
        title={selected.title}
      >
        {selected.icon}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg shadow-2xl p-2"
          style={{ minWidth: 160 }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pick(item)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] cursor-pointer text-left ${
                item.id === selected.id ? 'bg-white/[0.06]' : ''
              }`}
            >
              {item.icon}
              <span className="text-[13px] text-[var(--color-text-primary)]">{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

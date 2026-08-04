// IconStack — a row of related icon actions collapsed to just the
// last-picked one. Hovering expands the full row (including the collapsed
// one) so any of them can be seen/clicked; picking one runs its action AND
// becomes the new collapsed default. Generic — first user is the top bar's
// window-layout buttons (Side by side / Stacked / Grid), but any
// {id, icon, title, onClick} list works.
import { useCallback, useRef, useState } from 'react';

export default function IconStack({ items, selectedId, onSelect, className = '' }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);

  const selected = items.find((i) => i.id === selectedId) || items[0];

  const handleEnter = useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);
  const handleLeave = useCallback(() => {
    clearTimeout(closeTimer.current);
    // Mirrors the top-bar Workspace menu's close delay — long enough to
    // survive a normal move across the row without feeling sluggish.
    closeTimer.current = setTimeout(() => setOpen(false), 400);
  }, []);

  const pick = (item) => {
    onSelect?.(item.id);
    item.onClick?.();
    setOpen(false);
  };

  if (!selected) return null;

  const visible = open ? items : [selected];

  return (
    <div
      className={`flex items-center gap-1 ${className}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {visible.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => pick(item)}
          className={`p-1 rounded hover:bg-white/10 transition-colors ${
            open && item.id === selected.id ? 'bg-white/10' : ''
          }`}
          title={item.title}
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}

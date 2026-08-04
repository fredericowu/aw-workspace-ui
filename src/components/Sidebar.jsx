import { useState, useRef, useCallback } from 'react';
import StatusDot from './StatusDot';
import SidebarPreview from './SidebarPreview';
import { startComponent, stopComponent, restartComponent } from '../hooks/useComponentStatus';

export default function Sidebar({ components, openWindows, onToggleWindow, collapsed, onToggleCollapse }) {

  // Hover preview state
  const [hoverItem, setHoverItem] = useState(null); // { key, type, name, component, rect }
  const hoverTimeout = useRef(null);

  const handleItemHover = useCallback((key, type, name, component, e) => {
    clearTimeout(hoverTimeout.current);
    const rect = e.currentTarget.getBoundingClientRect();
    hoverTimeout.current = setTimeout(() => {
      setHoverItem({ key, type, name, component, rect });
    }, 300);
  }, []);

  const handleItemLeave = useCallback(() => {
    clearTimeout(hoverTimeout.current);
    setHoverItem(null);
  }, []);
  const [collapsedCategories, setCollapsedCategories] = useState(new Set(['APIs', 'Apps', 'Docker', 'Tools', 'GitHub', 'GitHub:My', 'GitHub:Team', 'Presentation']));
  const [searchQuery, setSearchQuery] = useState('');

  // Group components by category from the API
  const HIDDEN_CATEGORIES = new Set(['System']);
  const CATEGORY_ORDER = ['Platform', 'APIs', 'Apps', 'Docker', 'Service', 'Tools'];
  const groups = {};
  components.forEach((c) => {
    const cat = c.category || 'Other';
    if (HIDDEN_CATEGORIES.has(cat)) return;
    if (c.menu_display === false) return;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(c);
  });
  // Sort categories by defined order, unknowns go last
  const sortedCategories = Object.keys(groups).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  // Search filtering
  const sq = searchQuery.toLowerCase();

  if (collapsed) {
    return (
      <div className="w-10 bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)] flex flex-col items-center py-3 shrink-0 overflow-y-auto">
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded hover:bg-white/10 transition-colors mb-3 shrink-0"
          title="Expand sidebar"
        >
          <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        {components.filter((c) => (c.status === 'running' || c.status === 'boot') && !HIDDEN_CATEGORIES.has(c.category) && c.menu_display !== false).map((c) => (
          <button
            key={c.key}
            onClick={() => onToggleWindow(c.key)}
            className={`flex flex-col items-center gap-1 py-2 px-1 mb-1 rounded hover:bg-white/10 transition-colors w-full ${
              openWindows.has(c.key) ? 'bg-white/[0.08]' : ''
            }`}
            title={c.key}
          >
            <StatusDot status={c.status} />
            <span
              className="text-[12px] text-[var(--color-text-secondary)] leading-none whitespace-nowrap font-medium"
              style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
            >
              {c.key.replace('docker:', '')}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="w-[244px] bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)] flex flex-col shrink-0 select-none">
      {/* Search + collapse */}
      <div className="px-2 py-2 border-b border-[var(--color-border)] flex items-center gap-1">
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-0 px-2 py-1 text-[13px] rounded bg-white/5 border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)] transition-colors"
        />
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded hover:bg-white/10 transition-colors shrink-0"
          title="Collapse sidebar"
        >
          <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto py-2">
        {/* Component categories */}
        {sortedCategories.map((category) => ({ category, items: groups[category] })).filter(({ items }) => {
          if (!searchQuery) return true;
          return items.some((c) => c.key.toLowerCase().includes(searchQuery.toLowerCase()));
        }).map(({ category, items }) => (
          <div key={category} className="mb-2">
            <div
              className="px-3 py-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center justify-between cursor-pointer hover:text-[var(--color-text-secondary)] transition-colors"
              onClick={() => setCollapsedCategories((prev) => {
                const next = new Set(prev);
                if (next.has(category)) next.delete(category);
                else next.add(category);
                return next;
              })}
            >
              {category}
              <svg className={`w-3 h-3 transition-transform ${collapsedCategories.has(category) ? '-rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
            {(!!sq || !collapsedCategories.has(category)) && items.filter((c) => !sq || c.key.toLowerCase().includes(sq)).map((c) => {
              const isOpen = openWindows.has(c.key);
              const isRunning = c.status === 'running' || c.status === 'boot';
              return (
                <div
                  key={c.key}
                  className={`group w-full flex items-center gap-2 px-3 py-2 text-left text-[15px] transition-colors cursor-pointer ${
                    isOpen
                      ? 'bg-white/[0.06] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-white/[0.04] hover:text-[var(--color-text-primary)]'
                  }`}
                  onClick={() => onToggleWindow(c.key)}
                  onMouseEnter={(e) => handleItemHover(c.key, 'component', c.key, c, e)}
                  onMouseLeave={handleItemLeave}
                >
                  <StatusDot status={c.status} />
                  <span className="truncate flex-1">{c.key}</span>
                  {/* Hover action buttons */}
                  <span className="hidden group-hover:flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {!isRunning && (
                      <button
                        onClick={() => startComponent(c.key)}
                        className="p-1 rounded hover:bg-white/10"
                        title="Start"
                      >
                        <svg className="w-3.5 h-3.5 text-green-400" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      </button>
                    )}
                    {isRunning && (
                      <>
                        <button
                          onClick={() => stopComponent(c.key)}
                          className="p-1 rounded hover:bg-white/10"
                          title="Stop"
                        >
                          <svg className="w-3.5 h-3.5 text-red-400" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                        </button>
                        <button
                          onClick={() => restartComponent(c.key)}
                          className="p-1 rounded hover:bg-white/10"
                          title="Restart"
                        >
                          <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                        </button>
                      </>
                    )}
                  </span>
                  {/* Port (hidden on hover to make room for buttons) */}
                  {c.port && (
                    <span className="group-hover:hidden text-[13px] text-[var(--color-text-muted)] shrink-0">:{c.port}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}

      </div>

      {/* Hover preview */}
      {hoverItem && (
        <SidebarPreview
          componentKey={hoverItem.key}
          component={hoverItem.component}
          anchorRect={hoverItem.rect}
          type={hoverItem.type}
          name={hoverItem.name}
        />
      )}
    </div>
  );
}

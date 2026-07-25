import { useState, useEffect } from 'react';

const THEMES = [
  {
    id: 'dark',
    label: 'Dark',
    colors: {
      bg: '#0a0a0f',
      header: '#16161e',
      accent: '#f5a623',
      text: '#e2e8f0',
      border: '#2a2a3d',
    },
  },
  {
    id: 'light',
    label: 'Light',
    colors: {
      bg: '#f8fafc',
      header: '#e2e8f0',
      accent: '#2563eb',
      text: '#0f172a',
      border: '#cbd5e1',
    },
  },
  {
    id: 'dracula',
    label: 'Dracula',
    colors: {
      bg: '#282a36',
      header: '#21222c',
      accent: '#bd93f9',
      text: '#f8f8f2',
      border: '#44475a',
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    colors: {
      bg: '#2e3440',
      header: '#272c36',
      accent: '#88c0d0',
      text: '#eceff4',
      border: '#3b4252',
    },
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    colors: {
      bg: '#1e1e2e',
      header: '#181825',
      accent: '#89b4fa',
      text: '#cdd6f4',
      border: '#313244',
    },
  },
  {
    id: 'system',
    label: 'System',
    colors: {
      bg: '#1e2030',
      header: '#222436',
      accent: '#82aaff',
      text: '#c8d3f5',
      border: '#2f334d',
    },
  },
];

function applyTheme(themeId) {
  const root = document.documentElement;
  if (themeId === 'system') {
    root.removeAttribute('data-theme');
    // System: respect OS preference — dark is default (:root), nothing to set
  } else if (themeId === 'dark') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', themeId);
  }
}

function ThemeCard({ theme, isActive, onClick }) {
  const { colors } = theme;
  return (
    <button
      onClick={onClick}
      style={{
        background: colors.bg,
        border: `2px solid ${isActive ? colors.accent : colors.border}`,
        borderRadius: '8px',
        padding: '12px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, transform 0.1s',
        transform: isActive ? 'scale(1.02)' : 'scale(1)',
        outline: 'none',
        textAlign: 'left',
        width: '100%',
      }}
      title={theme.label}
    >
      {/* Mini preview */}
      <div style={{ borderRadius: '4px', overflow: 'hidden', marginBottom: '8px', border: `1px solid ${colors.border}` }}>
        {/* Header bar */}
        <div style={{ background: colors.header, height: '12px', display: 'flex', alignItems: 'center', padding: '0 4px', gap: '3px' }}>
          <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#ef4444' }} />
          <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#eab308' }} />
          <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#22c55e' }} />
        </div>
        {/* Body */}
        <div style={{ background: colors.bg, padding: '6px', display: 'flex', gap: '4px' }}>
          {/* Sidebar strip */}
          <div style={{ width: '16px', background: colors.header, borderRadius: '2px', minHeight: '28px' }} />
          {/* Content area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ height: '4px', background: colors.accent, borderRadius: '2px', width: '60%' }} />
            <div style={{ height: '3px', background: colors.text, borderRadius: '2px', opacity: 0.4, width: '90%' }} />
            <div style={{ height: '3px', background: colors.text, borderRadius: '2px', opacity: 0.3, width: '70%' }} />
            <div style={{ height: '3px', background: colors.accent, borderRadius: '2px', opacity: 0.6, width: '40%', marginTop: '3px' }} />
          </div>
        </div>
      </div>

      {/* Label */}
      <div style={{ color: colors.text, fontSize: '12px', fontWeight: isActive ? 600 : 400, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{theme.label}</span>
        {isActive && (
          <span style={{ color: colors.accent, fontSize: '10px' }}>✓ Active</span>
        )}
      </div>
    </button>
  );
}

export default function AppearanceTab() {
  const [activeTheme, setActiveTheme] = useState(() => {
    return localStorage.getItem('aw-theme') || 'dark';
  });

  // Apply saved theme on mount
  useEffect(() => {
    const saved = localStorage.getItem('aw-theme') || 'dark';
    applyTheme(saved);
    setActiveTheme(saved);
  }, []);

  function handleThemeSelect(themeId) {
    setActiveTheme(themeId);
    applyTheme(themeId);
    localStorage.setItem('aw-theme', themeId);
  }

  return (
    <div className="p-4">
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ color: 'var(--color-text-primary)', fontSize: '14px', fontWeight: 600, margin: '0 0 4px 0' }}>Theme</h3>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '12px', margin: 0 }}>
          Choose a color theme for the workspace. Your preference is saved locally.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: '12px',
      }}>
        {THEMES.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            isActive={activeTheme === theme.id}
            onClick={() => handleThemeSelect(theme.id)}
          />
        ))}
      </div>

      {activeTheme === 'system' && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '11px', marginTop: '12px' }}>
          System theme follows your OS dark/light mode preference.
        </p>
      )}
    </div>
  );
}

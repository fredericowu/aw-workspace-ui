/**
 * Shared workspace-app icon set — same 12 named icons production has always
 * shipped (see LogoMenu.jsx WORKSPACE_APP_ICONS), factored out so both
 * the Apps nav button (AppsNav.jsx, 14px) and the Mission Control App
 * Launcher (AppLauncher.jsx, 16-40px) render identical glyphs at whatever
 * size their layout needs, instead of drifting copies of the same SVG path
 * data.
 */

const ICON_PATHS = {
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  code: (
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </>
  ),
  terminal: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </>
  ),
  git: (
    <>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </>
  ),
  cloud: <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  mail: (
    <>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </>
  ),
  star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  box: <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />,
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </>
  ),
  'book-open': (
    <>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </>
  ),
};

/**
 * Resolves a workspace_apps `icon` value the same way production always
 * has: URL/path/data-uri -> <img>, known name -> inline SVG, anything else
 * (or empty) -> first-letter fallback badge.
 */
export default function AppIcon({ icon, label, size = 14, className = '' }) {
  if (icon && (icon.startsWith('http') || icon.startsWith('/') || icon.startsWith('data:'))) {
    return (
      <img
        src={icon}
        alt=""
        className={`shrink-0 object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  if (icon && ICON_PATHS[icon]) {
    return (
      <svg
        className={`shrink-0 ${className}`}
        style={{ width: size, height: size }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICON_PATHS[icon]}
      </svg>
    );
  }
  return (
    <span
      className={`shrink-0 rounded-sm font-bold flex items-center justify-center leading-none bg-white/10 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.5)) }}
    >
      {(label || icon || '?')[0].toUpperCase()}
    </span>
  );
}

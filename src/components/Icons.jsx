// Shared inline-SVG icon set — ported from the prototype's `ICO` object
// (ux-proto app.js) as small JSX components instead of innerHTML strings.
// Only the icons this pass actually uses are ported; the rest of the
// prototype's set (kb, bug, whiteboard, remote, plans, tests, …) is left
// for whichever future window-type pass needs them.

export function IconGear(props) {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
    </svg>
  );
}

export function IconBolt(props) {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

export function IconAgent(props) {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 21h8M9 10h.01M15 10h.01M9 14h6" />
    </svg>
  );
}

export function IconPresent(props) {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="12" rx="1" />
      <path d="M8 21h8M12 15v6" />
    </svg>
  );
}

export function IconApps(props) {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function IconChevDown(props) {
  return (
    <svg className="chev-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const NAMED_ICONS = {
  gear: IconGear,
  bolt: IconBolt,
  agent: IconAgent,
  present: IconPresent,
  apps: IconApps,
};

/** Resolve one of the window-shell icon keys (e.g. 'bolt', 'gear') to a component. */
export function ShellIcon({ name, ...rest }) {
  const Icon = NAMED_ICONS[name] || IconBolt;
  return <Icon {...rest} />;
}

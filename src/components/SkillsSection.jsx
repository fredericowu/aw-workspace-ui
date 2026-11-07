import { useState } from 'react';
import SkillsTab from './SkillsTab';

// Fase 7 (card 4105bf3b): the shared skills.aw registry is the primary view
// now — same-site iframe, auth rides the apex aw_id_jwt cookie, zero token
// plumbing. The local `skills/` inventory (native + app-contributed, the
// code-server editing surface SkillsTab already covers) is a DIFFERENT
// dataset from the registry, so it stays reachable as a secondary sub-view
// rather than being replaced outright.
const SKILLS_REGISTRY_URL = 'https://skills.aw.tekflox.com';

export default function SkillsSection() {
  const [view, setView] = useState('registry'); // 'registry' | 'local'

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="inline-flex rounded-full bg-white/5 p-0.5" role="tablist" aria-label="Skills view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'registry'}
            onClick={() => setView('registry')}
            data-testid="skills-view-registry"
            className={`px-3 py-1.5 text-xs rounded-full font-medium transition-colors cursor-pointer ${
              view === 'registry'
                ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            Registry
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'local'}
            onClick={() => setView('local')}
            data-testid="skills-view-local"
            className={`px-3 py-1.5 text-xs rounded-full font-medium transition-colors cursor-pointer ${
              view === 'local'
                ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            Local (workspace)
          </button>
        </div>
        {view === 'registry' && (
          <a
            className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] shrink-0"
            href={SKILLS_REGISTRY_URL}
            target="_blank"
            rel="noreferrer"
          >
            open in new tab ↗
          </a>
        )}
      </div>

      {view === 'registry' ? (
        <div className="appcfg-appwindow" data-testid="skills-registry-pane">
          <div className="appwin-iframe-wrap relative w-full h-full">
            <iframe className="appwin-iframe" title="Skills registry" src={SKILLS_REGISTRY_URL} />
          </div>
        </div>
      ) : (
        <SkillsTab />
      )}
    </div>
  );
}

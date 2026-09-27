import { useState, useEffect, useCallback, useRef } from 'react';
import { refreshGitHubPRs, getGitHubPRs, getAwConfig } from '../hooks/useComponentStatus';
import { createSharedSocket } from '../hooks/useSharedSocket';
import { wsUrl, notifyWsAuthFailed } from '../auth';
import { GITHUB_STREAM_PATH } from '../lib/githubApi';

const BADGE_STYLES = {
  'ci-running':    { bg: 'bg-blue-500/15',   text: 'text-blue-400',   label: 'CI Running' },
  'tests-failed':  { bg: 'bg-red-500/15',    text: 'text-red-400',    label: 'Tests Failed' },
  'ready-to-merge':{ bg: 'bg-green-500/15',  text: 'text-green-400',  label: 'Ready to Merge' },
  'needs-review':  { bg: 'bg-amber-500/15',  text: 'text-amber-400',  label: 'Needs Review' },
  'draft':         { bg: 'bg-gray-500/15',   text: 'text-gray-400',   label: 'Draft' },
  'open':          { bg: 'bg-purple-500/15',  text: 'text-purple-400', label: 'Open' },
};

function Badge({ type }) {
  const s = BADGE_STYLES[type] || BADGE_STYLES.open;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.bg} ${s.text} whitespace-nowrap`}>
      {type === 'ci-running' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-1" />}
      {s.label}
    </span>
  );
}

function CountBadge({ count, color = 'var(--color-accent)', title }) {
  if (!count) return null;
  return (
    <span
      className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1 cursor-default"
      style={{ background: `color-mix(in srgb, ${color} 20%, transparent)`, color }}
      title={title ? `${count} ${title}` : undefined}
    >
      {count}
    </span>
  );
}

function StatusBadges({ counts }) {
  // Show colored mini-badges: green=merge, yellow=review, red=failed, gray=draft
  const items = [
    { count: counts.merge,  color: '#4ade80', title: 'Ready to merge' },
    { count: counts.review, color: '#fbbf24', title: 'Needs review' },
    { count: counts.failed, color: '#f87171', title: 'Tests failed' },
    { count: counts.draft,  color: '#71717a', title: 'Draft' },
    { count: counts.other,  color: '#818cf8', title: 'Open' },
  ];
  const visible = items.filter((i) => i.count > 0);
  if (!visible.length) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {visible.map((i) => (
        <CountBadge key={i.title} count={i.count} color={i.color} title={i.title} />
      ))}
    </span>
  );
}

function PRItem({ pr, onClaudeReview }) {
  return (
    <div className="group relative px-3 py-2 hover:bg-white/[0.04] transition-colors">
      <div className="flex items-start gap-2">
        <svg className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
          pr.badge === 'ready-to-merge' ? 'text-green-400' :
          pr.badge === 'needs-review' ? 'text-amber-400' :
          pr.badge === 'tests-failed' ? 'text-red-400' :
          pr.badge === 'draft' ? 'text-gray-500' :
          pr.badge === 'ci-running' ? 'text-blue-400 animate-pulse' :
          'text-purple-400'
        }`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 012 2v7M6 9v12"/>
        </svg>
        <div className="flex-1 min-w-0">
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-[var(--color-text-primary)] hover:text-[var(--color-accent)] hover:underline leading-tight block truncate"
            title={pr.title}
          >
            {pr.title}
          </a>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className="text-[10px] text-[var(--color-text-muted)]">#{pr.number}</span>
            {pr.author && <span className="text-[10px] text-[var(--color-text-muted)]">{pr.author}</span>}
            {pr.review_requested && <span className="text-[10px] text-amber-400 font-medium">review requested</span>}
          </div>
        </div>
      </div>
      {/* Floating review button — absolute so it doesn't shift layout */}
      <button
        onClick={(e) => { e.stopPropagation(); onClaudeReview(pr); }}
        className="hidden group-hover:flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#d97706]/90 text-white hover:bg-[#d97706] transition-colors whitespace-nowrap absolute right-2 top-2 shadow-lg"
        title="Open Claude to review this PR"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z" />
        </svg>
        review
      </button>
    </div>
  );
}

const sortPRs = (prs) => [...(prs || [])].sort((a, b) => (a.isDraft ? 1 : 0) - (b.isDraft ? 1 : 0));

function PRList({ prs, onClaudeReview }) {
  const [showDrafts, setShowDrafts] = useState(false);
  if (!prs || prs.length === 0) return <div className="px-3 py-1 text-[11px] text-[var(--color-text-muted)] italic">No open PRs</div>;

  const sorted = sortPRs(prs);
  const nonDrafts = sorted.filter((pr) => pr.badge !== 'draft');
  const drafts = sorted.filter((pr) => pr.badge === 'draft');
  const hideDrafts = prs.length > 5 && drafts.length > 0 && !showDrafts;

  const visible = hideDrafts ? nonDrafts : sorted;

  return (
    <>
      {visible.map((pr) => <PRItem key={pr.url} pr={pr} onClaudeReview={onClaudeReview} />)}
      {hideDrafts && (
        <button
          onClick={() => setShowDrafts(true)}
          className="px-3 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors w-full text-left"
        >
          + show {drafts.length} draft{drafts.length > 1 ? 's' : ''}
        </button>
      )}
      {showDrafts && drafts.length > 0 && (
        <button
          onClick={() => setShowDrafts(false)}
          className="px-3 py-1 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors w-full text-left"
        >
          − hide drafts
        </button>
      )}
    </>
  );
}

export default function GitHubSection({ collapsed, collapsedCategories, setCollapsedCategories, onCreateClaude, searchQuery, inlineResults }) {
  const [data, setData] = useState({ my_prs: [], team_prs: [], review_prs: [], repos: [], error: null });
  const [loading, setLoading] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState('');

  // Load prompt template from config
  useEffect(() => {
    getAwConfig().then((cfg) => {
      const gh = cfg?.github || {};
      setPromptTemplate(gh.review_prompt_template || 'use gh cli and review {pr_url}. Clone the repo and review the code under /tmp/{repo_name}-{pr_number}');
    }).catch(() => {});
  }, []);

  // WebSocket connection for live updates — reconnect/backoff/close-code
  // handling all live in the shared aw-ws/1 client (§7/§9.1). Lazy useState
  // initializer, not a ref checked in the render body, so it's created
  // exactly once without touching `.current` during render.
  const [socket] = useState(() => createSharedSocket({
    url: () => wsUrl(GITHUB_STREAM_PATH),
    initType: 'github_init',
    onFrame: (msg) => {
      if (msg.type === 'github_init' || msg.type === 'github_update') {
        setData({ my_prs: msg.my_prs || [], team_prs: msg.team_prs || [], review_prs: msg.review_prs || [], repos: msg.repos || [], error: msg.error, last_poll: msg.last_poll });
      }
    },
    onStatus: ({ state }) => {
      if (state !== 'fatal') return;
      setData((prev) => ({ ...prev, error: 'Session expired — log in again' }));
      notifyWsAuthFailed();
    },
  }));

  useEffect(() => {
    // Initial REST fetch (for cached data on page load)
    getGitHubPRs().then((d) => setData(d)).catch(() => {});
    // Then open the shared WebSocket for live updates
    return socket.retain();
  }, [socket]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await refreshGitHubPRs();
      setData(result);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  const handleClaudeReview = useCallback(async (pr) => {
    const repoName = pr.repo?.split('/').pop() || 'repo';
    const prompt = promptTemplate
      .replace('{pr_url}', pr.url)
      .replace('{repo_name}', repoName)
      .replace('{pr_number}', String(pr.number))
      .replace('{pr_title}', pr.title)
      .replace('{author}', pr.author);

    if (onCreateClaude) {
      onCreateClaude(prompt, `PR Review ${repoName} #${pr.number}`);
    }
  }, [onCreateClaude, promptTemplate]);

  // Sort: non-drafts first, then drafts

  // Count PRs by status category
  const countByStatus = (prs) => {
    const counts = { merge: 0, review: 0, failed: 0, draft: 0, other: 0 };
    for (const pr of (prs || [])) {
      if (pr.badge === 'ready-to-merge') counts.merge++;
      else if (pr.badge === 'needs-review') counts.review++;
      else if (pr.badge === 'tests-failed') counts.failed++;
      else if (pr.badge === 'draft') counts.draft++;
      else counts.other++;
    }
    return counts;
  };

  // Filter PRs by search query (title, author)
  const sq = searchQuery || '';
  const filterPR = (pr) => !sq || pr.title?.toLowerCase().includes(sq) || pr.author?.toLowerCase().includes(sq) || 'github pr pull request'.includes(sq);
  const filteredMyPRs = (data.my_prs || []).filter(filterPR);
  const filteredTeamPRs = (data.team_prs || []).filter(filterPR);
  const filteredReviewPRs = (data.review_prs || []).filter(filterPR);
  const [showAllReviews, setShowAllReviews] = useState(false);

  const myCount = data.my_prs?.length || 0;
  const teamCount = data.team_prs?.length || 0;
  const reviewCount = data.review_prs?.length || 0;
  const myCounts = countByStatus(data.my_prs);
  const teamCounts = countByStatus(data.team_prs);

  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef(null);
  const headerRef = useRef(null);

  // Close panel on outside click (ignore clicks on the header toggle)
  useEffect(() => {
    if (!panelOpen) return;
    // Delay registration to avoid catching the same click that opened the panel
    const timer = setTimeout(() => {
      const handler = (e) => {
        if (panelRef.current && panelRef.current.contains(e.target)) return;
        if (headerRef.current && headerRef.current.contains(e.target)) return;
        setPanelOpen(false);
      };
      document.addEventListener('mousedown', handler);
      window.__ghPanelCleanup = () => document.removeEventListener('mousedown', handler);
    }, 100);
    return () => { clearTimeout(timer); window.__ghPanelCleanup?.(); };
  }, [panelOpen]);

  if (collapsed) return null;
  if (sq && filteredMyPRs.length === 0 && filteredTeamPRs.length === 0 && !'github pr pull request'.includes(sq)) return null;

  return (
    <div className="mb-2 relative">
      {/* Header — click opens side panel */}
      <div
        ref={headerRef}
        className={`px-3 py-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center justify-between cursor-pointer hover:text-[var(--color-text-secondary)] transition-colors ${panelOpen ? 'text-[var(--color-accent)]' : ''}`}
        onClick={() => setPanelOpen(!panelOpen)}
      >
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          <span>GitHub</span>
          {(myCount + teamCount) > 0 && <CountBadge count={myCount + teamCount} />}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
            className={`p-0.5 rounded hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors ${loading ? 'animate-spin [animation-direction:reverse]' : ''}`}
            title="Refresh PRs"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
            </svg>
          </button>
          <svg className={`w-3 h-3 transition-transform ${panelOpen ? '' : '-rotate-90'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {/* Inline search results — only when searching */}
      {inlineResults && (filteredMyPRs.length > 0 || filteredTeamPRs.length > 0) && (
        <div>
          {filteredMyPRs.concat(filteredTeamPRs).slice(0, 10).map((pr) => (
            <a
              key={pr.url}
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-white/[0.04] hover:text-[var(--color-text-primary)] transition-colors truncate"
            >
              <svg className={`w-3 h-3 shrink-0 ${
                pr.badge === 'ready-to-merge' ? 'text-green-400' :
                pr.badge === 'tests-failed' ? 'text-red-400' :
                pr.badge === 'needs-review' ? 'text-amber-400' :
                pr.badge === 'draft' ? 'text-gray-500' :
                'text-purple-400'
              }`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 012 2v7M6 9v12"/>
              </svg>
              <span className="truncate">{pr.title}</span>
              {pr.author && <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{pr.author}</span>}
            </a>
          ))}
        </div>
      )}

      {/* Side panel — floating on the right */}
      {panelOpen && (
        <div
          ref={panelRef}
          className="fixed left-[244px] top-0 bottom-0 w-[360px] bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)] z-50 flex flex-col shadow-xl"
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--color-border)]">
            <span className="text-sm font-bold text-[var(--color-accent)]">GitHub PRs</span>
            <button onClick={() => setPanelOpen(false)} className="p-1 rounded hover:bg-white/10">
              <svg className="w-4 h-4 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2">
            {data.error && <div className="px-3 py-1 text-[10px] text-[var(--color-danger)]">{data.error}</div>}

            {/* My PRs */}
            <div className="mb-3">
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                My PRs <span className="text-[var(--color-accent)]">{filteredMyPRs.length || ''}</span>
              </div>
              <PRList prs={filteredMyPRs} onClaudeReview={handleClaudeReview} />
            </div>

            {/* Team PRs */}
            <div className="mb-3">
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Team PRs <span className="text-[var(--color-accent)]">{filteredTeamPRs.length || ''}</span>
              </div>
              <PRList prs={filteredTeamPRs} onClaudeReview={handleClaudeReview} />
            </div>

            {/* Other Review Requests */}
            {filteredReviewPRs.length > 0 && (
              <div className="mb-3">
                <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-400/80">
                  Other Review Requests <span className="text-amber-400">{filteredReviewPRs.length}</span>
                </div>
                <PRList prs={showAllReviews ? filteredReviewPRs : filteredReviewPRs.slice(0, 5)} onClaudeReview={handleClaudeReview} />
                {filteredReviewPRs.length > 5 && !showAllReviews && (
                  <button onClick={() => setShowAllReviews(true)} className="px-3 py-1 text-xs text-[var(--color-accent)] hover:underline">
                    +{filteredReviewPRs.length - 5} more
                  </button>
                )}
                {showAllReviews && filteredReviewPRs.length > 5 && (
                  <button onClick={() => setShowAllReviews(false)} className="px-3 py-1 text-xs text-gray-500 hover:underline">
                    show less
                  </button>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { apiFetch } from '../auth';

const HEALTH_COLOR = {
  implemented: 'text-green-400',
  not_implemented: 'text-[var(--color-text-muted)]',
  broken: 'text-red-400',
};

const TEST_STATUS_COLOR = {
  passing: 'text-green-400',
  fail: 'text-red-400',
  unknown: 'text-[var(--color-text-muted)]',
};

function HealthBadge({ health }) {
  return (
    <span className={`text-[10px] uppercase tracking-wide ${HEALTH_COLOR[health] || 'text-[var(--color-text-muted)]'}`}>
      {health || 'unknown'}
    </span>
  );
}

function PlayIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      className={`w-3.5 h-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

// Console output panel for a single test run — appears under the requirement
// row, can be minimized (collapse to a title bar) or closed (removed).
function ConsolePanel({ run, onClose }) {
  const [minimized, setMinimized] = useState(false);
  return (
    <div className="mt-2 rounded border border-[var(--color-border)] bg-black overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 bg-[var(--color-bg-header)] border-b border-[var(--color-border)]">
        <span className="text-[11px] font-mono text-[var(--color-text-muted)] truncate">
          {run.running ? 'running…' : `exit: ${run.status || 'unknown'}`} · {run.file_path}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setMinimized((v) => !v)}
            className="p-0.5 rounded hover:bg-white/10 text-[var(--color-text-muted)]"
            title={minimized ? 'Restore' : 'Minimize'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
          </button>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-white/10 text-[var(--color-text-muted)]" title="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      {!minimized && (
        <pre className="text-[11px] font-mono text-green-300/90 p-2 overflow-auto whitespace-pre-wrap" style={{ maxHeight: 260 }}>
          {run.running ? 'Running pytest…' : (run.output || '(no output)')}
        </pre>
      )}
    </div>
  );
}

function RequirementRow({ r, consoleState, onRun, onCloseConsole }) {
  const tests = r.tests || [];
  const running = consoleState?.running;

  return (
    <div className="border border-[var(--color-border)] rounded p-2 mb-2 bg-[var(--color-bg-secondary)]/40">
      <div className="flex items-start gap-2">
        <button
          onClick={() => onRun(r)}
          disabled={tests.length === 0 || running}
          title={tests.length === 0 ? 'No test linked to this requirement' : 'Run linked test(s)'}
          className="mt-0.5 p-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-green-400 shrink-0"
        >
          {running
            ? <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M4 12a8 8 0 0 1 8-8" /></svg>
            : <PlayIcon />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] text-[var(--color-text-primary)]">{r.title}</span>
            <HealthBadge health={r.health} />
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
            <span className="text-[var(--color-text-primary)]/70">Given</span> {r.given}, <span className="text-[var(--color-text-primary)]/70">when</span> {r.when}, <span className="text-[var(--color-text-primary)]/70">then</span> {r.then}.
          </p>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] flex-wrap">
            {r.kanban_page_id ? (
              r.kanban_url
                ? <a href={r.kanban_url} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">card</a>
                : <span className="text-[var(--color-text-muted)]">card linked</span>
            ) : (
              <span className="text-red-400">no card</span>
            )}
            {tests.length === 0 ? (
              <span className="text-[var(--color-text-muted)]">no test linked</span>
            ) : tests.map((t) => (
              <span key={t.file_path} className={TEST_STATUS_COLOR[t.last_run_status] || 'text-[var(--color-text-muted)]'}>
                {t.last_run_status} · {t.file_path.split('/').pop()}
              </span>
            ))}
            {r.logger_name && (
              <span className="text-[var(--color-text-muted)]">logs via <code>{r.logger_name}</code></span>
            )}
          </div>
          {consoleState && (
            <ConsolePanel run={consoleState} onClose={() => onCloseConsole(r.requirement_id)} />
          )}
        </div>
      </div>
    </div>
  );
}

// A discovered test with no BDD requirement linked yet — same Play/console
// UX as a RequirementRow, but shown by file name since there's no rule text.
function DiscoveredTestRow({ t, consoleState, onRun, onCloseConsole }) {
  const running = consoleState?.running;
  return (
    <div className="border border-dashed border-[var(--color-border)] rounded p-2 mb-2 bg-[var(--color-bg-secondary)]/20">
      <div className="flex items-start gap-2">
        <button
          onClick={() => onRun(t)}
          disabled={running}
          title="Run this test"
          className="mt-0.5 p-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-green-400 shrink-0"
        >
          {running
            ? <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M4 12a8 8 0 0 1 8-8" /></svg>
            : <PlayIcon />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-mono text-[var(--color-text-primary)]/80 truncate">{t.file_path}</span>
            <span className={`text-[10px] uppercase tracking-wide ${TEST_STATUS_COLOR[t.last_run_status] || 'text-[var(--color-text-muted)]'}`}>
              {t.last_run_status || 'unknown'}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">no rule linked yet</span>
          </div>
          {consoleState && (
            <ConsolePanel run={consoleState} onClose={() => onCloseConsole(t.file_path)} />
          )}
        </div>
      </div>
    </div>
  );
}

function ComponentSection({ slug, name, reqs, discovered, expanded, onToggle, consoles, onRun, onCloseConsole, onRunDiscovered, discoveredConsoles, onCloseDiscoveredConsole }) {
  const healthCounts = reqs.reduce((acc, r) => { acc[r.health] = (acc[r.health] || 0) + 1; return acc; }, {});
  return (
    <div className="mb-2 border border-[var(--color-border)] rounded overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-header)] hover:bg-white/[0.04] text-left"
      >
        <ChevronIcon open={expanded} />
        <span className="text-[13px] font-medium text-[var(--color-text-primary)] flex-1">{name || slug}</span>
        <span className="text-[10px] text-[var(--color-text-muted)]">{reqs.length} requirement{reqs.length !== 1 ? 's' : ''}</span>
        {discovered.length > 0 && <span className="text-[10px] text-[var(--color-text-muted)]">{discovered.length} unlinked test{discovered.length !== 1 ? 's' : ''}</span>}
        {healthCounts.broken > 0 && <span className="text-[10px] text-red-400">{healthCounts.broken} broken</span>}
      </button>
      {expanded && (
        <div className="p-2 bg-[var(--color-bg-primary)]">
          {reqs.map((r) => (
            <RequirementRow
              key={r.requirement_id}
              r={r}
              consoleState={consoles[r.requirement_id]}
              onRun={onRun}
              onCloseConsole={onCloseConsole}
            />
          ))}
          {discovered.length > 0 && (
            <div className="mt-1">
              <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">
                Discovered tests — not yet linked to a rule
              </p>
              {discovered.map((t) => (
                <DiscoveredTestRow
                  key={t.file_path}
                  t={t}
                  consoleState={discoveredConsoles[t.file_path]}
                  onRun={onRunDiscovered}
                  onCloseConsole={onCloseDiscoveredConsole}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Workspace > Tests — the traceability matrix, grouped by component
 * (collapsed by default; expand to see each requirement's Given/When/Then).
 * Each requirement with a linked test case gets a Play button that runs it
 * for real (POST /api/architecture/testcases/run — pytest subprocess,
 * records last_run_status) and shows the console output inline, right under
 * the rule, minimizable/closable.
 */
export default function TestsPanel() {
  const [rows, setRows] = useState([]);
  const [discoveredTests, setDiscoveredTests] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());
  const [consoles, setConsoles] = useState({}); // requirement_id -> { running, status, output, file_path }
  const [discoveredConsoles, setDiscoveredConsoles] = useState({}); // file_path -> { running, status, output }
  const [query, setQuery] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      apiFetch('/api/architecture/matrix').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      apiFetch('/api/architecture/component-tests').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    ])
      .then(([matrix, tests]) => { setRows(matrix); setDiscoveredTests(tests); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggleComponent = (slug) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  const runRequirement = async (r) => {
    const tests = r.tests || [];
    if (tests.length === 0) return;
    // Run each linked test in sequence, showing the last one's console
    // (the common case is one test per requirement).
    for (const t of tests) {
      setConsoles((prev) => ({ ...prev, [r.requirement_id]: { running: true, file_path: t.file_path } }));
      try {
        const res = await apiFetch('/api/architecture/testcases/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_path: t.file_path }),
        });
        const data = await res.json();
        setConsoles((prev) => ({
          ...prev,
          [r.requirement_id]: { running: false, status: data.status, output: data.output, file_path: t.file_path },
        }));
      } catch (e) {
        setConsoles((prev) => ({
          ...prev,
          [r.requirement_id]: { running: false, status: 'error', output: String(e), file_path: t.file_path },
        }));
      }
    }
    load(); // refresh health/test status from the DB now that a run recorded a result
  };

  const closeConsole = (requirementId) => {
    setConsoles((prev) => { const next = { ...prev }; delete next[requirementId]; return next; });
  };

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);

  const runScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await apiFetch('/api/architecture/discovery/run', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.json();
    } catch (e) {
      setScanError(e.message);
    } finally {
      setScanning(false);
      load(); // pick up whatever the scan just found/updated
    }
  };

  const runDiscoveredTest = async (t) => {
    setDiscoveredConsoles((prev) => ({ ...prev, [t.file_path]: { running: true } }));
    try {
      const res = await apiFetch('/api/architecture/testcases/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: t.file_path }),
      });
      const data = await res.json();
      setDiscoveredConsoles((prev) => ({ ...prev, [t.file_path]: { running: false, status: data.status, output: data.output } }));
    } catch (e) {
      setDiscoveredConsoles((prev) => ({ ...prev, [t.file_path]: { running: false, status: 'error', output: String(e) } }));
    }
    load();
  };

  const closeDiscoveredConsole = (filePath) => {
    setDiscoveredConsoles((prev) => { const next = { ...prev }; delete next[filePath]; return next; });
  };

  // Group by root component (topmost ancestor via parent_slug) — "the
  // component of the repository", not whichever narrow leaf a requirement
  // happens to be filed under. root_component_slug/name comes from the
  // matrix; components with no requirements yet (only discovered tests)
  // fall back to their own slug/name.
  const groups = [];
  const bySlug = {};
  const rootBySlug = {};
  for (const r of rows) {
    rootBySlug[r.component_slug] = { slug: r.root_component_slug, name: r.root_component_name };
    const key = r.root_component_slug;
    if (!bySlug[key]) {
      bySlug[key] = { slug: key, name: r.root_component_name, reqs: [], discovered: [] };
      groups.push(bySlug[key]);
    }
    bySlug[key].reqs.push(r);
  }
  for (const t of discoveredTests) {
    if (t.linked) continue; // already shown via its requirement row
    const root = rootBySlug[t.component_slug] || { slug: t.component_slug, name: t.component_name };
    if (!bySlug[root.slug]) {
      bySlug[root.slug] = { slug: root.slug, name: root.name, reqs: [], discovered: [] };
      groups.push(bySlug[root.slug]);
    }
    bySlug[root.slug].discovered.push(t);
  }
  groups.sort((a, b) => (a.slug || '').localeCompare(b.slug || ''));

  // Search across name, rule (given/when/then), component, health/status,
  // logger, linked test file paths, and Kanban link — whatever's relevant.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const matchesQuery = (r) => {
    if (!searching) return true;
    const haystack = [
      r.title, r.given, r.when, r.then, r.component_slug, r.component_name,
      r.logger_name, r.intended_status, r.health, r.kanban_page_id,
      ...(r.tests || []).map((t) => t.file_path),
    ].filter(Boolean).join(' \n ').toLowerCase();
    return haystack.includes(q);
  };

  const matchesDiscovered = (t) => {
    if (!searching) return true;
    return [t.file_path, t.component_slug, t.component_name, t.last_run_status]
      .filter(Boolean).join(' \n ').toLowerCase().includes(q);
  };

  const visibleGroups = groups
    .map((g) => ({ ...g, reqs: g.reqs.filter(matchesQuery), discovered: g.discovered.filter(matchesDiscovered) }))
    .filter((g) => g.reqs.length > 0 || g.discovered.length > 0);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-header)] shrink-0 space-y-2">
        <span className="text-xs text-[var(--color-text-muted)] block">
          Traceability matrix — ask → build → test → observe. Expand a component to see its rules and run its tests.
        </span>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1">
            <SearchIcon />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, rule, component, logger, test file, card…"
              className="flex-1 bg-transparent text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
            />
            {searching && (
              <button onClick={() => setQuery('')} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]" title="Clear search">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
          <button
            onClick={runScan}
            disabled={scanning}
            title="Scan test_base_path directories and refresh the catalog from what's actually in each component's tests — same thing the periodic Architecture Test Discovery task does, run now."
            className="shrink-0 flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] hover:bg-white/[0.06] disabled:opacity-50 text-xs text-[var(--color-text-primary)]"
          >
            <RefreshIcon spinning={scanning} />
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>
        {scanError && <div className="text-[11px] text-red-400">Scan failed: {scanError}</div>}
      </div>
      <div className="flex-1 overflow-auto p-2">
        {loading && <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading…</div>}
        {error && <div className="p-4 text-xs text-red-400">Failed to load matrix: {error}</div>}
        {!loading && !error && visibleGroups.length === 0 && (
          <div className="p-4 text-xs text-[var(--color-text-muted)] text-center">
            {searching ? `No matches for "${query}".` : 'No requirements documented yet.'}
          </div>
        )}
        {!loading && !error && visibleGroups.map((g) => (
          <ComponentSection
            key={g.slug}
            slug={g.slug}
            name={g.name}
            reqs={g.reqs}
            discovered={g.discovered}
            expanded={searching || expanded.has(g.slug)}
            onToggle={() => toggleComponent(g.slug)}
            consoles={consoles}
            onRun={runRequirement}
            onCloseConsole={closeConsole}
            discoveredConsoles={discoveredConsoles}
            onRunDiscovered={runDiscoveredTest}
            onCloseDiscoveredConsole={closeDiscoveredConsole}
          />
        ))}
      </div>
    </div>
  );
}

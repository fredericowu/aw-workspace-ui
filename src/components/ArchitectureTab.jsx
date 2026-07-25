import { useEffect, useState } from 'react';

const HEALTH_COLOR = {
  implemented: 'text-green-400',
  not_implemented: 'text-[var(--color-text-muted)]',
  broken: 'text-red-400',
};

function HealthBadge({ health }) {
  return (
    <span className={`text-[10px] uppercase tracking-wide ${HEALTH_COLOR[health] || 'text-[var(--color-text-muted)]'}`}>
      {health || 'unknown'}
    </span>
  );
}

function ComponentList({ components, onSelect }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
          <th className="py-2 px-3">Component</th>
          <th className="py-2 px-3">Repo</th>
          <th className="py-2 px-3">Layer</th>
          <th className="py-2 px-3">Technologies</th>
          <th className="py-2 px-3">Health</th>
        </tr>
      </thead>
      <tbody>
        {components.map((c) => (
          <tr
            key={c.slug}
            onClick={() => onSelect(c.slug)}
            className="border-b border-[var(--color-border)]/50 hover:bg-white/5 cursor-pointer"
          >
            <td className="py-2 px-3 text-[var(--color-text-primary)]">{c.name}</td>
            <td className="py-2 px-3 text-[var(--color-text-muted)]">{c.repo || '—'}</td>
            <td className="py-2 px-3 text-[var(--color-text-muted)]">{c.layer || '—'}</td>
            <td className="py-2 px-3 text-[var(--color-text-muted)]">{(c.technologies || []).join(', ') || '—'}</td>
            <td className="py-2 px-3"><HealthBadge health={c.health} /></td>
          </tr>
        ))}
        {components.length === 0 && (
          <tr><td colSpan={5} className="py-6 text-center text-[var(--color-text-muted)]">No components registered yet.</td></tr>
        )}
      </tbody>
    </table>
  );
}

function ComponentDetail({ slug, onBack }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/architecture/components/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [slug]);

  if (error) return <div className="p-4 text-xs text-red-400">Failed to load {slug}: {error}</div>;
  if (!detail) return <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading…</div>;

  return (
    <div className="p-4 text-xs space-y-4 overflow-y-auto h-full">
      <button onClick={onBack} className="text-[var(--color-accent)] hover:underline">← Back to catalog</button>
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-[var(--color-text-primary)]">{detail.name}</h3>
          <HealthBadge health={detail.health} />
        </div>
        <p className="text-[var(--color-text-muted)] mt-1">{detail.description || 'No description yet.'}</p>
        <p className="text-[var(--color-text-muted)] mt-1">
          repo: {detail.repo || '—'} · layer: {detail.layer || '—'} · tech: {(detail.technologies || []).join(', ') || '—'}
        </p>
      </div>

      <div>
        <h4 className="text-[var(--color-text-primary)] font-medium mb-1">Requirements ({(detail.requirements || []).length})</h4>
        {(detail.requirements || []).length === 0 && <p className="text-[var(--color-text-muted)]">None documented.</p>}
        {(detail.requirements || []).map((r) => (
          <div key={r.id} className="border border-[var(--color-border)] rounded p-2 mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-text-primary)]">{r.title}</span>
              <HealthBadge health={r.health} />
            </div>
            <p className="text-[var(--color-text-muted)] mt-1">
              Given {r.gherkin_given}, when {r.gherkin_when}, then {r.gherkin_then}.
            </p>
            {r.tests?.length > 0 && (
              <p className="text-[var(--color-text-muted)] mt-1">Tests: {r.tests.map((t) => t.file_path).join(', ')}</p>
            )}
            {r.bugs?.length > 0 && (
              <p className="text-[var(--color-text-muted)] mt-1">
                Bugs: {r.bugs.filter((b) => !b.resolved_at).length} open / {r.bugs.length} total
              </p>
            )}
            {r.logger_name && (
              <p className="text-[var(--color-text-muted)] mt-1">Logs via: <code>{r.logger_name}</code></p>
            )}
            {r.kanban_page_id ? (
              <p className="text-[var(--color-text-muted)] mt-1">
                Kanban: {r.kanban_url ? <a href={r.kanban_url} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">{r.kanban_page_id}</a> : r.kanban_page_id}
              </p>
            ) : (
              <p className="text-red-400 mt-1">No Kanban card linked</p>
            )}
          </div>
        ))}
      </div>

      <div>
        <h4 className="text-[var(--color-text-primary)] font-medium mb-1">Connections ({(detail.connections || []).length})</h4>
        {(detail.connections || []).map((c, i) => (
          <p key={i} className="text-[var(--color-text-muted)]">→ {c.to_slug} ({c.kind}) {c.description || ''}</p>
        ))}
      </div>

      <div>
        <h4 className="text-[var(--color-text-primary)] font-medium mb-1">MCP tools ({(detail.tools || []).length})</h4>
        {(detail.tools || []).map((t, i) => (
          <p key={i} className="text-[var(--color-text-muted)]">{t.name} — {t.description || ''}</p>
        ))}
      </div>
    </div>
  );
}

export default function ArchitectureTab() {
  const [components, setComponents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/architecture/components')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => { setComponents(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-header)] shrink-0">
        <span className="text-xs text-[var(--color-text-muted)]">
          Architecture Namespace — live catalog of components, requirements, tests, and connections (backed by Postgres)
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading…</div>}
        {error && <div className="p-4 text-xs text-red-400">Failed to load architecture catalog: {error}</div>}
        {!loading && !error && (
          selected
            ? <ComponentDetail slug={selected} onBack={() => setSelected(null)} />
            : <div className="p-2"><ComponentList components={components} onSelect={setSelected} /></div>
        )}
      </div>
    </div>
  );
}

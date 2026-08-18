// AppSearchResults — the Apps view's cross-category search result list.
//
// The category tabs (UI / Services / Runnables / Tools) are a good way to
// browse but a bad way to *find*: you don't know which bucket an app landed
// in, so finding one meant clicking every tab in turn. Typing in the search
// box replaces the tab content with this single flat list spanning ALL
// categories at once — one row per app, each carrying the category it came
// from as a badge, so the grouping is still visible without being a filter.
//
// Rows are the same `.applt-installed-row` language as the Runnables list, and
// the per-app controls are literally InstalledActions from InstalledApps.jsx,
// so a search hit does everything a browsed row does (open, configure,
// pin/rollback, uninstall, update).
import AppIcon from './AppIcon';
import { InstalledActions } from './InstalledApps';
import { matchesQuery } from '../apps/appSearch';
import { semverGt } from '../apps/semver';
import { colorForApp } from '../apps/appColor';

function ResultRow({ entry, busy, catalogVersions, onOpen, onConfig, onVersion, onUninstall, onUpdate }) {
  const { app, kind, category, openable } = entry;
  const name = kind === 'legacy' ? app.label : app.name;
  const catalogVersion = kind === 'framework' ? catalogVersions?.[app.slug] : undefined;
  const hasUpdate = !!catalogVersion && semverGt(catalogVersion, app.version);
  const open = openable ? () => onOpen(entry) : undefined;

  return (
    <li
      className={`applt-installed-row applt-search-row ${open ? 'applt-installed-row-openable' : 'applt-installed-row-command'}`}
      onClick={open}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      aria-label={open ? `Open ${name}` : undefined}
      onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}
    >
      <span className="applt-installed-icon" style={kind === 'framework' ? { background: colorForApp(app.slug) } : undefined}>
        <AppIcon icon={app.icon} label={name} size={20} />
      </span>
      <div className="applt-installed-text">
        <span className="applt-installed-name">
          {name}
          <span className="applt-tag applt-tag-cat">{category}</span>
          {kind === 'framework' && !app.signed && (
            <span className="applt-tag applt-tag-dev" title="side-loaded / unsigned">dev</span>
          )}
          {hasUpdate && (
            <span className="applt-tag applt-tag-update" data-testid={`update-badge-${app.slug}`}>
              {`Update available v${catalogVersion}`}
            </span>
          )}
        </span>
        <span className="applt-installed-meta">
          {kind === 'legacy'
            ? (app.hasStatus ? (app.running ? 'Running now' : 'Stopped') : 'Workspace app')
            : `${app.slug} · v${app.version}`}
        </span>
        {kind === 'framework' && app.description && (
          <span className="applt-search-desc">{app.description}</span>
        )}
      </div>
      {kind === 'framework' && (
        <InstalledActions
          app={app} busy={busy} hasUpdate={hasUpdate} catalogVersion={catalogVersion}
          onConfig={onConfig} onVersion={onVersion} onUninstall={onUninstall} onUpdate={onUpdate}
        />
      )}
    </li>
  );
}

export default function AppSearchResults({ query, index, busy, catalogVersions, onOpen, onConfig, onVersion, onUninstall, onUpdate }) {
  const results = index.filter((e) => matchesQuery(e, query));

  if (results.length === 0) {
    return (
      <p className="applt-installed-empty" data-testid="search-empty">
        {`No app matches “${query.trim()}”.`}
      </p>
    );
  }

  return (
    <>
      <p className="applt-search-count" data-testid="search-count">
        {`${results.length} ${results.length === 1 ? 'app' : 'apps'} across all categories`}
      </p>
      <ul className="applt-installed applt-search-results" data-testid="search-results">
        {results.map((entry) => (
          <ResultRow
            key={entry.key} entry={entry} busy={busy} catalogVersions={catalogVersions}
            onOpen={onOpen} onConfig={onConfig} onVersion={onVersion}
            onUninstall={onUninstall} onUpdate={onUpdate}
          />
        ))}
      </ul>
    </>
  );
}

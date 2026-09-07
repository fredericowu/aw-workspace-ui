// Pure search helpers behind the Apps view's cross-category search box. Kept
// out of AppSearchResults.jsx so that file only exports a component (the
// react-refresh lint rule), and because the matching rule is the part worth
// unit-testing on its own.

// Whitespace-separated terms, ALL of which must appear somewhere in the row's
// searchable text (AND, not OR) — typing "git hub" narrows, it doesn't widen.
// Case-insensitive substring, not fuzzy: a launcher that guesses is worse than
// one that doesn't, and slugs are short enough that prefixes are plenty.
export function matchesQuery(entry, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return false;
  const hay = entry.haystack;
  return terms.every((t) => hay.includes(t));
}

// Lower is more relevant. Only decides ORDER among entries that already
// passed matchesQuery above — an app named for the query (e.g. "Browser")
// should never rank below one that merely mentions it in a long description
// (e.g. Blender's "3D in the browser...").
function relevanceRank(entry, query) {
  const q = query.trim().toLowerCase();
  const name = entry.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (entry.slug.toLowerCase().includes(q)) return 3;
  return 4;
}

// Stable sort (ties keep the incoming category order: UI, Services,
// Runnables, Tools) by relevance rank.
export function sortByRelevance(entries, query) {
  return entries
    .map((entry, index) => ({ entry, index, rank: relevanceRank(entry, query) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ entry }) => entry);
}

// Flattens the four category buckets AppLauncher already computes into one
// normalized, searchable list. Two shapes exist behind it and both have to
// stay openable: framework apps from GET /api/apps (slug/name/version) and the
// legacy aw.json workspace_apps (id/label, backed by a docker component), which
// is why every entry carries its own `open` thunk instead of the caller
// branching on kind at render time.
export function buildSearchIndex({ uiApps, legacyApps, servicesFrameworkApps, runnableApps, toolsApps }) {
  const framework = (list, category) => (list || []).map((app) => ({
    key: `f:${app.slug}`,
    kind: 'framework',
    category,
    app,
    name: app.name || app.slug,
    slug: app.slug,
    openable: !!app.has_windows,
    haystack: [app.name, app.slug, app.description, category].filter(Boolean).join(' ').toLowerCase(),
  }));
  return [
    ...framework(uiApps, 'UI'),
    ...(legacyApps || []).map((app) => ({
      key: `l:${app.id}`,
      kind: 'legacy',
      category: 'Services',
      app,
      name: app.label || app.id,
      slug: app.id,
      openable: true,
      haystack: [app.label, app.id, 'Services'].filter(Boolean).join(' ').toLowerCase(),
    })),
    ...framework(servicesFrameworkApps, 'Services'),
    ...framework(runnableApps, 'Runnables'),
    ...framework(toolsApps, 'Tools'),
  ];
}

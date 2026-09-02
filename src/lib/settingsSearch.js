// Pure search index + matching for the Settings NEW sidebar search box.
//
// Deliberately its own module, not an extension of src/apps/appSearch.js —
// that module's entry shape (four flat category buckets) and matching
// signature (matchesQuery(entry, query) -> boolean) don't fit a sidebar row
// that also needs to report WHERE inside an app's own settings a query
// matched, and it carries zero unit tests today, so reusing it would risk a
// silent regression in the Apps launcher for a feature that has nothing to
// do with it.
//
// Never indexes app.config (live values, including secrets) — only schema
// labels: property key, title, description.

function norm(value) {
  return String(value || '').toLowerCase();
}

function terms(query) {
  return norm(query).trim().split(/\s+/).filter(Boolean);
}

// One searchable field per config_schema property, skipping framework-owned
// ones (auto_start, auth_required, public — manifest.py's
// effective_config_schema stamps these with x-framework: true) so search
// results aren't cluttered by every managed app "matching" on the same three
// lifecycle toggles.
function buildFields(app) {
  const props = app?.config_schema?.properties || {};
  return Object.entries(props)
    .filter(([, spec]) => !(spec && spec['x-framework'] === true))
    .map(([key, spec]) => {
      const label = spec?.title || key;
      const hay = norm([key, spec?.title, spec?.description].filter(Boolean).join(' '));
      return { key, label, hay };
    });
}

// `base` is the name/description haystack a plain sidebar-row match is
// judged against; `fields` are what let a query also reach into an app's own
// settings form. `fullHay` is the pre-joined base+fields haystack the AND
// match runs against — all precomputed here (memoized on [apps] by the
// caller) so a query keystroke only re-runs the cheap match, not this scan.
export function buildSettingsIndex(sections, apps) {
  const entries = [];
  for (const s of sections || []) {
    const base = norm([s.label, s.description].filter(Boolean).join(' '));
    entries.push({ group: 'general', key: s.key, item: s, base, fields: [], fullHay: base });
  }
  for (const a of apps || []) {
    const base = norm([a.name, a.description].filter(Boolean).join(' '));
    const fields = buildFields(a);
    const fullHay = [base, ...fields.map((f) => f.hay)].filter(Boolean).join(' ');
    entries.push({ group: 'apps', key: a.slug, item: a, base, fields, fullHay });
  }
  return entries;
}

// Whitespace-separated terms, ALL of which must appear somewhere in the
// entry's fullHay (AND, not OR) — same substring/AND rule as appSearch's
// matchesQuery, kept consistent across the two search boxes on purpose.
//
// An empty query always returns matches: false — callers MUST gate
// filtering on their own "is the user actually searching" flag rather than
// trusting this, or the sidebar renders blank on first paint before any
// query has been typed.
//
// Match provenance (the "Matches X" hint) is computed here, per call, not
// stored on the index entry — it depends on the query, not just the entry.
export function matchSettingsEntry(entry, query) {
  const qTerms = terms(query);
  if (qTerms.length === 0) return { matches: false, hint: null };
  if (!qTerms.every((t) => entry.fullHay.includes(t))) return { matches: false, hint: null };

  // Terms not satisfied by the base (name/description) alone are what made
  // this a "deep" match — used to name where the hit actually is.
  const residual = qTerms.filter((t) => !entry.base.includes(t));
  if (residual.length === 0) return { matches: true, hint: null };

  // Every residual term inside a single field -> name that field. Residual
  // terms only satisfied when scattered across two or more different
  // fields -> no single field to point at, so fall back to a generic hint.
  const hitField = entry.fields.find((f) => residual.every((t) => f.hay.includes(t)));
  return {
    matches: true,
    hint: hitField ? `Matches "${hitField.label}"` : 'Matches a settings field',
  };
}

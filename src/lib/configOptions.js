// x-options resolver — turns a config_schema field's `x-options` block into
// `[{value, label}]` for AppConfigBody's <select>, against a small fixed set
// of core-owned data sources. Adding a source later is one line in SOURCES;
// the app manifest never says how to fetch, only which named source to use.
import { fetchRemoteHosts } from './networkingApi';

export const SOURCES = {
  'remote-hosts': fetchRemoteHosts,
};

function fillTemplate(template, row) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (row?.[key] ?? ''));
}

// A template's fields must ALL be non-empty for it to win — "{id} ({friendly_name})"
// is not allowed to render as "abc123 ()" when friendly_name is unset.
function templateIsSatisfied(template, row) {
  const keys = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  return keys.every((key) => {
    const v = row?.[key];
    return v !== undefined && v !== null && String(v).trim() !== '';
  });
}

function labelFor(row, templates) {
  const winner = templates.find((t) => templateIsSatisfied(t, row)) || templates[templates.length - 1];
  return fillTemplate(winner, row);
}

function matchesFilter(row, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([key, want]) => row?.[key] === want);
}

/**
 * Resolve a `config_schema` field's `x-options` into `[{value, label}]`.
 * `spec` is the field's own schema object (the one carrying `x-options`).
 *
 * `rows`, when passed, are used as-is instead of calling the source's
 * fetcher again — how a caller with several fields on the same `source`
 * (e.g. two `remote-hosts` fields) fetches it once and reuses the rows.
 * Omit it to fetch fresh, which is what a caller with a single field wants.
 *
 * Returns `null` for an unrecognised `source` — the caller falls back to a
 * plain text input rather than rendering a dropdown with no way to fill it.
 * Lets a fetch failure THROW rather than swallowing it — `fetchRemoteHosts`
 * throws on a non-ok response, and the caller decides what "the fetch
 * failed" means for the field (fall back to text, keep the saved value).
 */
export async function resolveOptions(spec, rows) {
  const options = spec?.['x-options'];
  const source = options?.source;
  const fetcher = SOURCES[source];
  if (!fetcher) return null;

  const data = rows || await fetcher();
  const filtered = data.filter((row) => matchesFilter(row, options.filter));
  const templates = Array.isArray(options.label) ? options.label : [options.label];
  const valueKey = options.value;

  return filtered.map((row) => ({
    value: row?.[valueKey],
    label: labelFor(row, templates),
  }));
}

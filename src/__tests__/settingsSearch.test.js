import { describe, it, expect } from 'vitest';
import { buildSettingsIndex, matchSettingsEntry } from '../lib/settingsSearch';

const SECTIONS = [
  { key: 'users', label: 'Users', ready: true, description: 'Guest logins scoped to a fixed list of apps.' },
  { key: 'backup', label: 'Backup', ready: false, description: 'Back up and restore workspace state.' },
];

const APPS = [
  {
    slug: 'crispal',
    name: 'Crispal',
    description: 'Store assistant for Sapataria Crispal.',
    config_schema: {
      properties: {
        api_token: { type: 'string', title: 'API token', description: 'WordPress REST token.' },
        webhook_url: { type: 'string', title: 'Webhook URL', description: 'Where order events post to.' },
        auto_start: { type: 'boolean', title: 'Auto-start', description: 'Start automatically.', 'x-framework': true },
      },
    },
  },
  {
    slug: 'kali',
    name: 'Kali Linux',
    description: 'Pentesting toolbox.',
    config_schema: { properties: {} },
  },
];

describe('buildSettingsIndex', () => {
  const index = buildSettingsIndex(SECTIONS, APPS);

  it('one entry per section and per app', () => {
    expect(index).toHaveLength(SECTIONS.length + APPS.length);
    expect(index.find((e) => e.group === 'general' && e.key === 'users')).toBeTruthy();
    expect(index.find((e) => e.group === 'apps' && e.key === 'crispal')).toBeTruthy();
  });

  // A16 — x-framework properties (manifest.py's managed-app lifecycle
  // toggles) are noise every managed app would otherwise "match" on, so they
  // never make it into the searchable fields.
  it('cuts x-framework properties out of an app entry fields', () => {
    const crispal = index.find((e) => e.key === 'crispal');
    expect(crispal.fields.map((f) => f.key)).toEqual(['api_token', 'webhook_url']);
    expect(crispal.fields.map((f) => f.key)).not.toContain('auto_start');
  });

  it('never indexes app.config, only schema labels', () => {
    const appWithLiveConfig = {
      slug: 'secret-app',
      name: 'Secret App',
      description: 'Has secrets.',
      config: { api_key: 'sk-super-secret-value' },
      config_schema: { properties: {} },
    };
    const entry = buildSettingsIndex([], [appWithLiveConfig])[0];
    expect(entry.fullHay).not.toContain('sk-super-secret-value');
  });
});

describe('matchSettingsEntry', () => {
  const index = buildSettingsIndex(SECTIONS, APPS);
  const byKey = (group, key) => index.find((e) => e.group === group && e.key === key);

  // A14 — an empty query must never read as a match; callers gate filtering
  // on their own `searching` flag, not on this returning true for everything.
  it('never matches an empty query', () => {
    expect(matchSettingsEntry(byKey('general', 'users'), '')).toEqual({ matches: false, hint: null });
    expect(matchSettingsEntry(byKey('general', 'users'), '   ')).toEqual({ matches: false, hint: null });
  });

  // A3 — substring, and every term must match (AND, not OR).
  it('matches a name/description substring, and requires every term', () => {
    expect(matchSettingsEntry(byKey('general', 'users'), 'gue').matches).toBe(true);
    expect(matchSettingsEntry(byKey('general', 'users'), 'guest apps').matches).toBe(true);
    expect(matchSettingsEntry(byKey('general', 'users'), 'guest nonexistent').matches).toBe(false);
  });

  it('a base-level match carries no hint', () => {
    expect(matchSettingsEntry(byKey('general', 'users'), 'guest')).toEqual({ matches: true, hint: null });
  });

  // A6 — a query that only matches inside a schema field (not the app's own
  // name/description) still matches the entry, and names the field.
  it('matches deep inside a schema field and names it', () => {
    const result = matchSettingsEntry(byKey('apps', 'crispal'), 'wordpress');
    expect(result.matches).toBe(true);
    expect(result.hint).toBe('Matches "API token"');
  });

  // Mixed query: one term from the app name, one term only found in a field.
  it('matches a mixed name+field query and hints only the field part', () => {
    const result = matchSettingsEntry(byKey('apps', 'crispal'), 'crispal token');
    expect(result.matches).toBe(true);
    expect(result.hint).toBe('Matches "API token"');
  });

  // Residual terms that are individually satisfied but never by the SAME
  // field fall back to a generic hint instead of naming the wrong one.
  it('falls back to a generic hint when residual terms are scattered across fields', () => {
    const result = matchSettingsEntry(byKey('apps', 'crispal'), 'token webhook');
    expect(result.matches).toBe(true);
    expect(result.hint).toBe('Matches a settings field');
  });

  it('does not match an app with no fields and no base hit', () => {
    expect(matchSettingsEntry(byKey('apps', 'kali'), 'nonexistent').matches).toBe(false);
  });

  it('an x-framework-only term never matches (it was cut from the index)', () => {
    expect(matchSettingsEntry(byKey('apps', 'crispal'), 'auto-start').matches).toBe(false);
  });
});

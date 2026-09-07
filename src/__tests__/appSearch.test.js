import { describe, it, expect } from 'vitest';
import { buildSearchIndex, matchesQuery, sortByRelevance } from '../apps/appSearch';

const UI_APPS = [
  {
    slug: 'browser',
    name: 'Browser',
    description: 'A simple embedded web browser.',
    has_windows: true,
  },
  {
    slug: 'blender',
    name: 'Blender',
    description: 'Blender 3D in the browser, full desktop.',
    has_windows: true,
  },
  {
    slug: 'travel',
    name: 'Travel',
    description: 'Search flights and browse hotel deals.',
    has_windows: true,
  },
];

describe('sortByRelevance', () => {
  const index = buildSearchIndex({ uiApps: UI_APPS });
  const matches = index.filter((e) => matchesQuery(e, 'browser'));

  it('ranks a name match above description-only matches for the same query', () => {
    const sorted = sortByRelevance(matches, 'browser');
    expect(sorted[0].app.slug).toBe('browser');
  });

  it('keeps a description-only match in the result set, just lower-ranked', () => {
    const sorted = sortByRelevance(matches, 'browser');
    const slugs = sorted.map((e) => e.app.slug);
    expect(slugs).toEqual(['browser', 'blender']);
  });

  it('is stable (preserves incoming order) among equally-ranked entries', () => {
    const tied = buildSearchIndex({
      uiApps: [
        { slug: 'aaa-tool', name: 'AAA Tool', description: 'does stuff', has_windows: true },
        { slug: 'zzz-tool', name: 'ZZZ Tool', description: 'does stuff', has_windows: true },
      ],
    });
    const sorted = sortByRelevance(tied, 'tool');
    expect(sorted.map((e) => e.app.slug)).toEqual(['aaa-tool', 'zzz-tool']);
  });

  it('ranks an exact name match above a mere name-prefix match', () => {
    const both = buildSearchIndex({
      uiApps: [
        { slug: 'git', name: 'Git', description: 'version control', has_windows: true },
        { slug: 'github', name: 'GitHub', description: 'code hosting', has_windows: true },
      ],
    });
    const sorted = sortByRelevance(both, 'git');
    expect(sorted.map((e) => e.app.slug)).toEqual(['git', 'github']);
  });
});

import { describe, it, expect } from 'vitest';
import { resolveSelection, ABOUT_SELECTION } from '../lib/settingsSelection';

const keys = ['users', 'backup', 'about'];
const apps = [{ slug: 'proxy' }];

describe('resolveSelection', () => {
  it('keeps About and current General sections', () => {
    expect(resolveSelection({ group: 'general', key: 'about' }, keys, apps, true)).toEqual(ABOUT_SELECTION);
    const sel = { group: 'general', key: 'backup' };
    expect(resolveSelection(sel, keys, apps, true)).toBe(sel);
  });
  it('keeps an installed app, and defers judgement until the list loads', () => {
    const sel = { group: 'apps', key: 'proxy' };
    expect(resolveSelection(sel, keys, apps, true)).toBe(sel);
    expect(resolveSelection({ group: 'apps', key: 'x' }, keys, [], false)).toEqual({ group: 'apps', key: 'x' });
  });
  it.each([
    [{ group: 'general', key: 'mcp' }],
    [{ group: 'general', key: 'proxy' }],
    [{ group: 'general', key: 'feed-subscriber' }],
    [{ group: 'apps', key: 'gone' }],
    [null],
    ['junk'],
  ])('resolves %j to About', (sel) => {
    expect(resolveSelection(sel, keys, apps, true)).toEqual(ABOUT_SELECTION);
  });
});

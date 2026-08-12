import { describe, it, expect, beforeEach } from 'vitest';
import {
  APP_WINDOWS_KEY,
  appWindowKey,
  identityForKey,
  isAppWindowKey,
  parseAppWindowKey,
  persistAppWindows,
  readPersistedAppWindows,
} from '../apps/appWindowKeys';

describe('appWindowKey / parseAppWindowKey', () => {
  it('round-trips a singleton window key', () => {
    const key = appWindowKey('whiteboard.main');
    expect(key).toBe('appwin:whiteboard.main');
    expect(parseAppWindowKey(key)).toEqual({ windowId: 'whiteboard.main', instanceId: undefined });
  });

  // The regression this module exists for: the old rehydrate passed the whole
  // `<windowId>:<instanceId>` tail to findWindowSpec, matched nothing, and left
  // a blank "App" window on screen after every reload.
  it('round-trips a multi-instance window key without swallowing the instance id', () => {
    const key = appWindowKey('diff-tool.viewer', 'e1a24b238adf');
    expect(key).toBe('appwin:diff-tool.viewer:e1a24b238adf');
    expect(parseAppWindowKey(key)).toEqual({
      windowId: 'diff-tool.viewer',
      instanceId: 'e1a24b238adf',
    });
  });

  it('splits on the FIRST colon, so a colon-bearing instance id survives', () => {
    expect(parseAppWindowKey('appwin:notes.viewer:a:b:c')).toEqual({
      windowId: 'notes.viewer',
      instanceId: 'a:b:c',
    });
  });

  it('rejects keys that are not app windows', () => {
    expect(isAppWindowKey('terminal:abc')).toBe(false);
    expect(parseAppWindowKey('terminal:abc')).toBeNull();
    expect(parseAppWindowKey('appwin:')).toBeNull();
  });
});

describe('persistAppWindows / readPersistedAppWindows', () => {
  beforeEach(() => localStorage.clear());

  it('persists identity only — never the resolved contribution spec', () => {
    persistAppWindows({
      'appwin:diff-tool.viewer:abc': {
        id: 'diff-tool.viewer',
        instanceId: 'abc',
        title: 'Diff Tool — titlebar',
        // Resolved server-side from the manifest: goes stale on app update,
        // so it must not survive the reload.
        spec: { layout: 'stack' },
        body: { type: 'component' },
      },
    });

    const raw = JSON.parse(localStorage.getItem(APP_WINDOWS_KEY));
    expect(raw['appwin:diff-tool.viewer:abc']).toEqual({
      windowId: 'diff-tool.viewer',
      instanceId: 'abc',
      title: 'Diff Tool — titlebar',
    });
  });

  it('prunes closed windows by deriving the record from the live specs', () => {
    persistAppWindows({ 'appwin:tasks.main': { id: 'tasks.main', title: 'Tasks' } });
    persistAppWindows({});
    expect(readPersistedAppWindows()).toEqual({});
  });

  it('reads back an empty map when storage is absent or corrupt', () => {
    expect(readPersistedAppWindows()).toEqual({});
    localStorage.setItem(APP_WINDOWS_KEY, 'not json');
    expect(readPersistedAppWindows()).toEqual({});
    localStorage.setItem(APP_WINDOWS_KEY, '["an","array"]');
    expect(readPersistedAppWindows()).toEqual({});
  });
});

describe('identityForKey', () => {
  it('prefers the persisted identity, which carries the per-instance title', () => {
    const persisted = {
      'appwin:diff-tool.viewer:abc': {
        windowId: 'diff-tool.viewer', instanceId: 'abc', title: 'Diff Tool — titlebar',
      },
    };
    expect(identityForKey('appwin:diff-tool.viewer:abc', persisted).title)
      .toBe('Diff Tool — titlebar');
  });

  // openWindows written by a build older than this record survives an upgrade;
  // the record does not. Those windows restore untitled rather than not at all.
  it('falls back to parsing the key when nothing was persisted', () => {
    expect(identityForKey('appwin:diff-tool.viewer:abc', {})).toEqual({
      windowId: 'diff-tool.viewer', instanceId: 'abc', title: undefined,
    });
  });
});

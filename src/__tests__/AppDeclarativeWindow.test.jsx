import { describe, it, expect } from 'vitest';

import { specFromManagedWindow } from '../components/AppDeclarativeWindow';

describe('AppDeclarativeWindow managed_app contract', () => {
  it('turns a managed app window declaration into a core-owned app iframe spec', () => {
    const spec = specFromManagedWindow({
      app: 'browser',
      title: 'Browser',
      body: {
        type: 'managed_app',
        kind: 'browser',
        path: '/vnc.html?autoconnect=true&resize=remote',
      },
    });

    expect(spec).toEqual({
      layout: 'stack',
      regions: [{
        id: 'main',
        widgets: [{
          type: 'app_iframe',
          title: 'Browser',
          app_id: 'browser',
          path: '/vnc.html?autoconnect=true&resize=remote',
        }],
      }],
    });
  });

  it('returns null for non-managed declarative windows', () => {
    expect(specFromManagedWindow({
      app: 'git',
      body: { type: 'declarative', spec_data: { regions: [] } },
    })).toBeNull();
  });
});

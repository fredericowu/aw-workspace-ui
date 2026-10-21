import { describe, it, expect, vi, beforeEach } from 'vitest';

const subscribe = vi.hoisted(() => vi.fn());
vi.mock('../lib/appEventsSocket', () => ({ subscribeAppEvents: subscribe }));

import { wireAppEventHooks } from '../apps/appEventHooks';

describe('manifest app event hooks', () => {
  beforeEach(() => subscribe.mockReset());

  it('matches stamped app + event and dispatches the allowlisted action', () => {
    let listener;
    const release = vi.fn();
    subscribe.mockImplementation((_app, fn) => { listener = fn; return release; });
    const onAction = vi.fn();
    const dispose = wireAppEventHooks({ event_hooks: [{
      app: 'editor', event: 'open_file',
      action: { type: 'open_window', window: 'editor.main', url_field: 'url' },
    }] }, onAction);

    expect(subscribe).toHaveBeenCalledWith('editor', expect.any(Function));
    listener({ app: 'editor', event: 'other', url: '/wrong' });
    expect(onAction).not.toHaveBeenCalled();
    listener({ app: 'editor', event: 'open_file', url: '/file.txt' });
    expect(onAction).toHaveBeenCalledWith({
      type: 'open_window', app: 'editor', window: 'editor.main', url: '/file.txt',
    });
    dispose();
    expect(release).toHaveBeenCalledOnce();
  });

  it('ignores unknown action types from stale or hand-crafted responses', () => {
    wireAppEventHooks({ event_hooks: [{
      app: 'bad', event: 'run', action: { type: 'javascript', code: 'alert(1)' },
    }] }, vi.fn());
    expect(subscribe).not.toHaveBeenCalled();
  });
});

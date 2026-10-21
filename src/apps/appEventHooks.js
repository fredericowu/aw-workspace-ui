import { subscribeAppEvents } from '../lib/appEventsSocket';

// Install the manifest-declared event handlers as one central dispatcher.
// The action vocabulary is intentionally tiny; validation belongs to core,
// while these guards keep a stale/hand-crafted response fail-closed.
export function wireAppEventHooks(contributions, onAction) {
  const hooks = Array.isArray(contributions?.event_hooks) ? contributions.event_hooks : [];
  const byApp = new Map();
  for (const hook of hooks) {
    if (!hook?.app || !hook?.event || hook?.action?.type !== 'open_window') continue;
    const appHooks = byApp.get(hook.app) || [];
    appHooks.push(hook);
    byApp.set(hook.app, appHooks);
  }

  const releases = [];
  for (const [appId, appHooks] of byApp) {
    releases.push(subscribeAppEvents(appId, (data) => {
      for (const hook of appHooks) {
        if (hook.event !== data.event) continue;
        const action = hook.action;
        const url = action.url_field && typeof data[action.url_field] === 'string'
          ? data[action.url_field]
          : undefined;
        onAction?.({ type: 'open_window', app: appId, window: action.window, url });
      }
    }));
  }
  return () => releases.forEach((release) => release());
}

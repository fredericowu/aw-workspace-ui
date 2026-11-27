// Pure resolver for "which Settings section is open".
//
// A selection is {group, key}. It is valid when it is About, a current General
// section, or (once the installed-app list has loaded) an installed app with
// settings. Anything else -- a removed General topic from an old deep link, an
// app that was uninstalled, junk -- resolves to About, the default.
export const ABOUT_SELECTION = { group: 'general', key: 'about' };

export function resolveSelection(selection, generalKeys, apps, appsLoaded) {
  if (!selection || typeof selection !== 'object') return ABOUT_SELECTION;
  const { group, key } = selection;
  if (group === 'general' && generalKeys.includes(key)) return selection;
  if (group === 'apps') {
    // Before the app list arrives an app selection cannot be judged; keep it
    // so a deep link into an app is not discarded by the first render.
    if (!appsLoaded) return selection;
    if (apps.some((a) => a.slug === key)) return selection;
  }
  return ABOUT_SELECTION;
}

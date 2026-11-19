export const SETTINGS_WINDOW_KEY = 'panel:settings-new';
export const LEGACY_SETTINGS_WINDOW_KEY = 'panel:settings';

export function normalizeSettingsWindowKey(key) {
  return key === LEGACY_SETTINGS_WINDOW_KEY ? SETTINGS_WINDOW_KEY : key;
}

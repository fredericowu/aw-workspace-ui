import { useEffect } from 'react';

const LEGACY_TABS = new Map([
  ['aw', 'aw'],
  ['integrations', 'integrations'],
  ['users', 'users'],
  ['tcp-proxy', 'tcp-proxy'],
  ['vpn', 'workspace-vpn'],
  ['local-dns', 'local-dns'],
  ['backup', 'backup'],
  ['skills', 'skills'],
]);

const LEGACY_PREFIX = '#settings/';

export function isLegacySettingsLink(hash) {
  return hash.startsWith(LEGACY_PREFIX);
}

export default function useLegacySettingsLink(openSettings) {
  useEffect(() => {
    const handleHash = () => {
      const url = new URL(window.location.href);
      const { hash } = url;
      if (!isLegacySettingsLink(hash)) return;

      const key = LEGACY_TABS.get(hash.slice(LEGACY_PREFIX.length));
      openSettings(key ? { group: 'general', key } : null);
      url.hash = '';
      window.history.replaceState(window.history.state, '', url);
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [openSettings]);
}

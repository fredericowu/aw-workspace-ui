import { useState } from 'react';
import AwConfigTab from './AwConfigTab';
import TcpProxyTab from './TcpProxyTab';
import VpnTab from './VpnTab';
import SkillsTab from './SkillsTab';
import McpServersTab from './McpServersTab';
import ProxyTab from './ProxyTab';
import BackupTab from './BackupTab';
import UsersTab from './UsersTab';
import IntegrationsTab from './IntegrationsTab';
import FeedSubscriberTab from './FeedSubscriberTab';
// Appearance used to be a top-level tab; it now lives inside
// AW → General as a collapsible section so the top tab strip stays
// focused on infrastructure / integrations rather than UI prefs.
const TABS = [
  { id: 'aw', label: 'AW' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'users', label: 'Users' },
  { id: 'tcp-proxy', label: 'TCP Proxy' },
  { id: 'vpn', label: 'VPN' },
  { id: 'proxy', label: 'Cookies' },
  { id: 'feed-subscriber', label: 'Feed Subscriber' },
  { id: 'backup', label: 'Backup' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcp', label: 'MCP Servers' },
];

export default function SettingsPanel() {
  const [activeTab, setActiveTab] = useState(() => {
    const match = window.location.hash.match(/^#settings\/(.+)$/);
    return TABS.some((tab) => tab.id === match?.[1]) ? match[1] : 'aw';
  });

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg-primary)] overflow-hidden">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-header)] shrink-0">
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 text-xs rounded transition-colors ${activeTab === tab.id
              ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-white/5'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'aw' && <AwConfigTab />}
        {activeTab === 'integrations' && <IntegrationsTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'tcp-proxy' && <TcpProxyTab />}
        {activeTab === 'vpn' && <VpnTab />}
        {activeTab === 'proxy' && <ProxyTab />}
        {activeTab === 'feed-subscriber' && <FeedSubscriberTab />}
        {activeTab === 'backup' && <BackupTab />}
        {activeTab === 'skills' && <SkillsTab />}
        {activeTab === 'mcp' && <McpServersTab />}
      </div>
    </div>
  );
}

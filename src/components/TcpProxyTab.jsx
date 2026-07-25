import { useState, useEffect } from 'react';
import { getAwConfig, saveAwConfig } from '../hooks/useComponentStatus';

export default function TcpProxyTab() {
  const [fullConfig, setFullConfig] = useState(null);
  const [proxies, setProxies] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getAwConfig().then((cfg) => {
      setFullConfig(cfg);
      setProxies(cfg.tcp_proxies || []);
    });
  }, []);

  const showMessage = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleChange = (index, field, value) => {
    setProxies((prev) => {
      const next = [...prev];
      const portFields = ['src_port', 'dst_port'];
      next[index] = { ...next[index], [field]: portFields.includes(field) ? Number(value) || 0 : value };
      return next;
    });
  };

  const handleToggle = (index) => {
    setProxies((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], enabled: next[index].enabled === false };
      return next;
    });
  };

  const handleAdd = () => {
    setProxies((prev) => [...prev, { name: '', proxy_host: '', src_port: 0, dst_port: 0, enabled: true }]);
  };

  const handleRemove = (index) => {
    setProxies((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await saveAwConfig({ ...fullConfig, tcp_proxies: proxies });
      if (!res.success) {
        showMessage(res.error || 'Error saving');
        return;
      }
      const caddy = res.reload?.caddy;
      if (caddy?.reloaded) showMessage('Saved — Caddy reloaded');
      else if (caddy?.changed) showMessage('Saved — Caddy updated (reload failed)');
      else showMessage('Saved — no Caddy changes');
    } finally {
      setSaving(false);
    }
  };

  if (!fullConfig) return <div className="p-6 text-[var(--color-text-muted)]">Loading...</div>;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">TCP Proxy</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">Caddy layer4 tunnels — RDP, SSH, or any raw TCP port exposed by hostname</p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className="text-xs text-[var(--color-text-muted)]">{message}</span>}
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {proxies.map((p, i) => (
          <div key={i} className="bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 grid grid-cols-2 gap-3">
                <Field label="Name" value={p.name} onChange={(v) => handleChange(i, 'name', v)} placeholder="Windows RDP" />
                <Field label="Upstream Host" value={p.proxy_host} onChange={(v) => handleChange(i, 'proxy_host', v)} placeholder="aw-windows" />
                <Field label="Src Port" value={p.src_port ?? p.tcp_port ?? ''} onChange={(v) => handleChange(i, 'src_port', v)} type="number" placeholder="3389" />
                <Field label="Dst Port" value={p.dst_port ?? p.tcp_port ?? ''} onChange={(v) => handleChange(i, 'dst_port', v)} type="number" placeholder="3389" />
              </div>
              <div className="flex items-center gap-2 shrink-0 pb-1.5">
                <button
                  onClick={() => handleToggle(i)}
                  title={p.enabled !== false ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                  className={`relative w-9 h-5 rounded-full transition-colors ${p.enabled !== false ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`}>
                  <span className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-transform ${p.enabled !== false ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
                <button onClick={() => handleRemove(i)}
                  className="p-1.5 rounded hover:bg-[var(--color-danger)]/20 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-colors"
                  title="Remove">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ))}
        {proxies.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">No TCP proxies configured.</p>
        )}
      </div>

      <button onClick={handleAdd}
        className="mt-3 px-4 py-1.5 text-xs rounded border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors">
        + Add TCP Proxy
      </button>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full bg-[var(--color-bg-primary)] text-sm text-[var(--color-text-primary)] border border-[var(--color-border)] rounded px-2 py-1.5 outline-none focus:border-[var(--color-accent)] transition-colors"
      />
    </label>
  );
}

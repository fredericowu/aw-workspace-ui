import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth';

function pretty(data) {
  return JSON.stringify(data || { mcpServers: {} }, null, 2);
}

function sourceLabel(source) {
  if (!source) return 'unknown';
  if (source.source === 'custom') return 'custom';
  return source.app ? `scanned: ${source.app}` : 'scanned';
}

export default function McpGatewayConfigEditor({ onSaved }) {
  const [data, setData] = useState(null);
  const [customText, setCustomText] = useState(pretty({ mcpServers: {} }));
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const finalServers = data?.final?.mcpServers || {};
  const sources = data?.sources || {};
  const selectedSpec = selected ? finalServers[selected] : null;
  const selectedSource = selected ? sources[selected] : null;

  const orderedServers = useMemo(() => Object.keys(finalServers).sort(), [finalServers]);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/apps/mcp-gateway/admin/config')
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.error) throw new Error(body.error || `Load failed (${res.status})`);
        if (!alive) return;
        setData(body);
        setCustomText(pretty(body.custom));
        setSelected(Object.keys(body.final?.mcpServers || {}).sort()[0] || '');
      })
      .catch((err) => {
        if (alive) setMessage({ ok: false, text: String(err.message || err) });
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(customText || '{}');
      const res = await apiFetch('/api/apps/mcp-gateway/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom: parsed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body.error || `Save failed (${res.status})`);
      setData(body);
      setCustomText(pretty(body.custom));
      setSelected((prev) => prev && body.final?.mcpServers?.[prev]
        ? prev
        : Object.keys(body.final?.mcpServers || {}).sort()[0] || '');
      setMessage({ ok: true, text: body.restart_required ? 'Saved. Restart MCP Gateway to load new upstreams.' : 'Saved' });
      onSaved?.(body);
    } catch (err) {
      setMessage({ ok: false, text: String(err.message || err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mcpgw" data-testid="mcpgw-editor">
      <div className="mcpgw-head">
        <div>
          <h4>MCP configuration</h4>
          <p>Scanned app mcp.json files are merged with mcp.custom.json into the generated mcp.json.</p>
        </div>
      </div>

      {loading ? (
        <div className="appcfg-loading" data-testid="mcpgw-loading">
          <span className="appcfg-spinner" aria-hidden="true" />
          <span>Loading MCP configuration...</span>
        </div>
      ) : (
        <>
          {message && (
            <div className={`mcpgw-msg ${message.ok ? 'is-ok' : 'is-err'}`} data-testid="mcpgw-msg">
              {message.text}
            </div>
          )}

          <div className="mcpgw-grid">
            <div className="mcpgw-list" aria-label="Final MCP servers">
              {orderedServers.length === 0 ? (
                <p className="mcpgw-empty">No MCP servers configured.</p>
              ) : orderedServers.map((name) => (
                <button
                  type="button"
                  key={name}
                  className={`mcpgw-row ${selected === name ? 'is-selected' : ''}`}
                  onClick={() => setSelected(name)}
                >
                  <span className="mcpgw-row-name">{name}</span>
                  <span className={`mcpgw-badge ${sources[name]?.source === 'custom' ? 'is-custom' : ''}`}>
                    {sourceLabel(sources[name])}
                  </span>
                </button>
              ))}
            </div>

            <div className="mcpgw-detail">
              {selectedSpec ? (
                <>
                  <div className="mcpgw-detail-title">
                    <strong>{selected}</strong>
                    <span className="mcpgw-badge">{sourceLabel(selectedSource)}</span>
                  </div>
                  <pre>{pretty(selectedSpec)}</pre>
                </>
              ) : (
                <p className="mcpgw-empty">Select a server to inspect its final definition.</p>
              )}
            </div>
          </div>

          <label className="mcpgw-editor-label" htmlFor="mcpgw-custom-json">
            Custom MCP JSON
          </label>
          <textarea
            id="mcpgw-custom-json"
            className="mcpgw-json"
            value={customText}
            spellCheck="false"
            onChange={(e) => setCustomText(e.target.value)}
          />

          <div className="appcfg-actions">
            <button type="button" className="appcfg-save" disabled={saving} onClick={save}>
              {saving ? 'Saving...' : 'Save custom MCPs'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// JsonConfigEditor — raw-JSON settings editor for apps that opt out of the
// generated config_schema form (AppConfigWindow's `isMcpTools`-style special
// cases). Parses + validates the JSON client-side before POSTing, surfacing
// the parse error inline instead of sending malformed config to the backend.
import { useState } from 'react';
import { apiFetch } from '../auth';

function pretty(data) {
  return JSON.stringify(data || {}, null, 2);
}

export default function JsonConfigEditor({ app, onSaved }) {
  const [text, setText] = useState(() => pretty(app?.config));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setMessage({ ok: false, text: `Invalid JSON: ${err.message}` });
      setSaving(false);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setMessage({ ok: false, text: 'Config must be a JSON object.' });
      setSaving(false);
      return;
    }

    try {
      const slug = encodeURIComponent(app.slug);
      const res = await apiFetch(`/api/apps/${slug}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: parsed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body.error || `Save failed (${res.status})`);
      setText(pretty(body.config ?? parsed));
      setMessage({ ok: true, text: 'Saved' });
      onSaved?.(body);
    } catch (err) {
      setMessage({ ok: false, text: String(err.message || err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="appcfg-json" data-testid="appcfg-json-editor">
      <label className="mcpgw-editor-label" htmlFor="appcfg-json-text">Config (JSON)</label>
      <textarea
        id="appcfg-json-text"
        className="mcpgw-json"
        value={text}
        spellCheck="false"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="appcfg-actions">
        {message && (
          <span className={`appcfg-msg ${message.ok ? 'is-ok' : 'is-err'}`} data-testid="appcfg-msg">
            {message.text}
          </span>
        )}
        <button type="button" className="appcfg-save" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}

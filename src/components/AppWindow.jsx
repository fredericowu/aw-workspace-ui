// AppWindow — the generic declarative window-body renderer (ADR Decision 3b,
// mode "declarative"). F1 scope: render a window spec JSON shipped by a
// hot-installed app (no app code enters the SPA), driving a small set of
// widgets and wiring their actions to the app's own backend under
// /api/apps/<slug>/*. The full frontend plugin runtime (component/iframe
// bundles, slot registry) is F5 — this is deliberately minimal.
//
// Kept self-contained (no App.jsx / WindowManager coupling) so it doesn't
// collide with the in-flight top-bar work; it renders a spec object it's
// handed and calls fetch() (rewritten to the BYOD api host by apiBase.js).
import { useState } from 'react';
import { marked } from 'marked';

// Parse a declarative action "GET /api/apps/hello/" into { method, path }.
function parseCall(call) {
  if (!call || typeof call !== 'string') return null;
  const [method, ...rest] = call.trim().split(/\s+/);
  return { method: (method || 'GET').toUpperCase(), path: rest.join(' ') };
}

function Widget({ widget }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  switch (widget.type) {
    case 'markdown':
      return (
        <div
          className="appwin-markdown"
          dangerouslySetInnerHTML={{ __html: marked.parse(widget.value || '') }}
        />
      );

    case 'list':
      return (
        <div className="appwin-list">
          {widget.title && <h4>{widget.title}</h4>}
          <ul>
            {(widget.items || []).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      );

    case 'button': {
      const call = parseCall(widget.action && widget.action.call);
      const onClick = async () => {
        if (!call) return;
        setBusy(true);
        try {
          const res = await fetch(call.path, { method: call.method });
          const body = await res.json().catch(() => ({}));
          setResult({ ok: res.ok, status: res.status, body });
        } catch (e) {
          setResult({ ok: false, error: String(e) });
        } finally {
          setBusy(false);
        }
      };
      return (
        <div className="appwin-button">
          <button type="button" onClick={onClick} disabled={busy || !call}>
            {busy ? '…' : widget.label || 'Run'}
          </button>
          {result && (
            <pre className="appwin-result" data-testid="appwin-result">
              {JSON.stringify(result.body ?? result, null, 2)}
            </pre>
          )}
        </div>
      );
    }

    case 'iframe':
      return (
        <iframe
          className="appwin-iframe"
          title={widget.title || 'app'}
          src={widget.src}
          sandbox="allow-scripts allow-forms allow-same-origin"
        />
      );

    default:
      return (
        <div className="appwin-unknown">Unsupported widget: {widget.type}</div>
      );
  }
}

// spec: a parsed windows/main.json ({ title, regions: [{ id, widgets: [] }] }).
export default function AppWindow({ spec }) {
  if (!spec) return null;
  const regions = spec.regions || [];
  return (
    <div className="app-window" data-app-window>
      {spec.title && <h3 className="app-window-title">{spec.title}</h3>}
      {regions.map((region) => (
        <section key={region.id} className="app-window-region" data-region={region.id}>
          {(region.widgets || []).map((widget, i) => (
            <Widget key={i} widget={widget} />
          ))}
        </section>
      ))}
    </div>
  );
}

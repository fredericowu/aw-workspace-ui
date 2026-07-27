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
//
// Widget vocabulary (windows/*.json "regions[].widgets[]"):
//   markdown  { value }                     — rendered via `marked`.
//   list      { title?, items: [] }
//   iframe    { title?, src }
//   button    { label, action: { call } }   — call is "METHOD /path"; on
//             click, fetches it once and shows the JSON body.
//
//   button + auto-poll — a button's `action` can carry an optional `poll`
//   block to turn a two-step "click, then click again to check status"
//   flow (e.g. an OAuth device-flow login) into one auto-polling click:
//     action: {
//       call: "POST /api/apps/<slug>/device/start",
//       poll: {
//         call: "POST /api/apps/<slug>/device/poll",   // polled endpoint
//         interval_ms: 3000,                            // default 3000
//         timeout_ms: 900000,                           // default 300000
//         done_field: "status",                         // default "status"
//         done_values: ["success", "expired_token", "access_denied", "error"],
//         pending_text: "Waiting for authorization…",   // shown while polling
//         timeout_text: "Timed out — try again.",       // shown on timeout
//       },
//     }
//   Once the initial `call` succeeds, the widget calls `poll.call` every
//   `interval_ms` and shows `poll.pending_text` until the JSON response's
//   `done_field` matches one of `done_values` (terminal state) or
//   `timeout_ms` elapses (shows `poll.timeout_text`) — no second widget or
//   manual "check status" click needed.
import { useEffect, useRef, useState } from 'react';
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
  const [polling, setPolling] = useState(false);
  const pollState = useRef({ timer: null, deadline: 0 });

  useEffect(() => () => clearTimeout(pollState.current.timer), []);

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
      const pollCfg = widget.action && widget.action.poll;
      const pollCall = pollCfg && parseCall(pollCfg.call);

      const stopPolling = () => {
        clearTimeout(pollState.current.timer);
        pollState.current.timer = null;
        setPolling(false);
      };

      const runPoll = async () => {
        if (Date.now() > pollState.current.deadline) {
          setResult({ ok: false, timedOut: true, body: { message: pollCfg.timeout_text || 'Timed out' } });
          stopPolling();
          return;
        }
        const doneField = pollCfg.done_field || 'status';
        const doneValues = pollCfg.done_values || [];
        try {
          const res = await fetch(pollCall.path, { method: pollCall.method });
          const body = await res.json().catch(() => ({}));
          setResult({ ok: res.ok, status: res.status, body });
          if (doneValues.includes(body[doneField])) {
            stopPolling();
            return;
          }
        } catch (e) {
          setResult({ ok: false, error: String(e) });
          stopPolling();
          return;
        }
        pollState.current.timer = setTimeout(runPoll, pollCfg.interval_ms || 3000);
      };

      const onClick = async () => {
        if (!call) return;
        setBusy(true);
        try {
          const res = await fetch(call.path, { method: call.method });
          const body = await res.json().catch(() => ({}));
          setResult({ ok: res.ok, status: res.status, body });
          if (res.ok && pollCall) {
            pollState.current.deadline = Date.now() + (pollCfg.timeout_ms || 300000);
            setPolling(true);
            pollState.current.timer = setTimeout(runPoll, pollCfg.interval_ms || 3000);
          }
        } catch (e) {
          setResult({ ok: false, error: String(e) });
        } finally {
          setBusy(false);
        }
      };
      return (
        <div className="appwin-button">
          <button type="button" onClick={onClick} disabled={busy || polling || !call}>
            {busy ? '…' : widget.label || 'Run'}
          </button>
          {polling && pollCfg.pending_text && (
            <p className="appwin-poll-pending" data-testid="appwin-poll-pending">
              {pollCfg.pending_text}
            </p>
          )}
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

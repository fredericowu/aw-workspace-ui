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
//
//   collapsible { title, collapsed?, widgets: [] } — hides `widgets` behind
//   a native <details>/<summary> disclosure, collapsed by default unless
//   `collapsed: false`. Used for an "Advanced" section so a window's default
//   view can stay to a single action, with manual/rare fields tucked away.
//
//   form { id, fields: [], submit: { call }, submit_label? } — a set of
//   inputs with local state, posted as one JSON object to `submit.call` on
//   submit. Each field: { key, label, input: "text"|"password"|"select"|
//   "checkbox", options?, default?, placeholder?, description?,
//   visible_when?: { field, equals } }. `visible_when` hides a field unless
//   another field in the *same form* currently equals the given value — the
//   vocabulary's conditional-visibility primitive (e.g. only show a token
//   input when an auth_method select is set to "token").
//
//   auth_status { bind, logout_action?, loading_text?, logged_in_text?,
//   logged_out_text? } — fetches `bind` (a "METHOD /path" GET) on mount and
//   shows a one-line login state. The response is expected to carry
//   `logged_in` (bool) and optionally `username`; `logged_in_text` is a
//   template with a `{username}` placeholder. When logged in and
//   `logout_action` is set, renders a "Logout" button that calls it and
//   re-fetches `bind` on success.
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

    case 'collapsible':
      return (
        <details className="appwin-collapsible" open={widget.collapsed === false}>
          <summary className="appwin-collapsible-title">{widget.title || 'Advanced'}</summary>
          <div className="appwin-collapsible-body">
            {(widget.widgets || []).map((child, i) => (
              <Widget key={i} widget={child} />
            ))}
          </div>
        </details>
      );

    case 'form':
      return <Form widget={widget} />;

    case 'auth_status':
      return <AuthStatus widget={widget} />;

    default:
      return (
        <div className="appwin-unknown">Unsupported widget: {widget.type}</div>
      );
  }
}

function fieldInputType(field) {
  return field.input || 'text';
}

function Form({ widget }) {
  const fields = widget.fields || [];
  const [values, setValues] = useState(() => {
    const init = {};
    for (const field of fields) {
      if (field.default !== undefined) init[field.key] = field.default;
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const setValue = (key, v) => setValues((prev) => ({ ...prev, [key]: v }));

  const isVisible = (field) => {
    const cond = field.visible_when;
    if (!cond) return true;
    return values[cond.field] === cond.equals;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const call = parseCall(widget.submit && widget.submit.call);
    if (!call) return;
    setSaving(true);
    try {
      const res = await fetch(call.path, {
        method: call.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => ({}));
      setResult({ ok: res.ok, status: res.status, body });
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="appwin-form" onSubmit={onSubmit}>
      {fields.filter(isVisible).map((field) => {
        const id = `appwin-form-${widget.id || 'f'}-${field.key}`;
        const type = fieldInputType(field);
        return (
          <div className="appwin-form-field" key={field.key}>
            <label htmlFor={id}>{field.label || field.key}</label>
            {field.description && <p className="appwin-form-desc">{field.description}</p>}
            {type === 'select' ? (
              <select
                id={id}
                value={values[field.key] ?? ''}
                onChange={(e) => setValue(field.key, e.target.value)}
              >
                {(field.options || []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : type === 'checkbox' ? (
              <input
                id={id}
                type="checkbox"
                checked={!!values[field.key]}
                onChange={(e) => setValue(field.key, e.target.checked)}
              />
            ) : (
              <input
                id={id}
                type={type === 'password' ? 'password' : 'text'}
                placeholder={field.placeholder}
                value={values[field.key] ?? ''}
                autoComplete={type === 'password' ? 'new-password' : 'off'}
                onChange={(e) => setValue(field.key, e.target.value)}
              />
            )}
          </div>
        );
      })}
      <button type="submit" disabled={saving}>
        {saving ? '…' : widget.submit_label || 'Save'}
      </button>
      {result && (
        <pre className="appwin-result" data-testid="appwin-form-result">
          {JSON.stringify(result.body ?? result, null, 2)}
        </pre>
      )}
    </form>
  );
}

function AuthStatus({ widget }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [loggingOut, setLoggingOut] = useState(false);

  const bindCall = parseCall(widget.bind);
  const logoutCall = parseCall(widget.logout_action && widget.logout_action.call);

  const refresh = async () => {
    if (!bindCall) return;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch(bindCall.path, { method: bindCall.method });
      const body = await res.json().catch(() => ({}));
      setState({ loading: false, data: body, error: null });
    } catch (err) {
      setState({ loading: false, data: null, error: String(err) });
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLogout = async () => {
    if (!logoutCall) return;
    setLoggingOut(true);
    try {
      await fetch(logoutCall.path, { method: logoutCall.method });
    } finally {
      setLoggingOut(false);
      refresh();
    }
  };

  if (state.loading) {
    return <p className="appwin-auth-status" data-testid="appwin-auth-status">{widget.loading_text || 'Checking…'}</p>;
  }
  if (state.error || !state.data) {
    return null;
  }
  if (state.data.logged_in) {
    const text = (widget.logged_in_text || 'Logged in as {username}').replace(
      '{username}',
      state.data.username || 'GitHub',
    );
    return (
      <div className="appwin-auth-status" data-testid="appwin-auth-status">
        <span>{text}</span>
        {logoutCall && (
          <button type="button" onClick={onLogout} disabled={loggingOut}>
            {loggingOut ? '…' : 'Logout'}
          </button>
        )}
      </div>
    );
  }
  if (widget.logged_out_text) {
    return (
      <p className="appwin-auth-status" data-testid="appwin-auth-status">
        {widget.logged_out_text}
      </p>
    );
  }
  return null;
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

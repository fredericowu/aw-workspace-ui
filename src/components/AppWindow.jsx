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
//   iframe    { title?, src }               — src is a same-origin `/api/*`
//             path, rewritten to the BYOD api host by apiUrl().
//   app_iframe { title?, app_id, path? }    — src is the app's OWN external
//             subdomain (`<app_id>.app.<slug>.workspace.<apex>`, derived from
//             window.location via appSubdomainUrl()) + optional `path`
//             (leading-slash path+query on that host), not `/api/apps/<slug>/*`
//             — for an app that's reachable directly under its own Caddy-routed
//             host rather than proxied through this workspace's api origin
//             (e.g. the AW Browser container's noVNC screen). No-ops (renders
//             nothing) on a non-workspace host, where there's no slug to
//             derive the subdomain from.
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
//   Any widget may also carry `hide_when_logged_in: true` — it renders
//   normally until the nearest `auth_status` widget in this window resolves
//   `logged_in: true`, at which point it disappears (e.g. hiding the "Sign in
//   with GitHub" section once already signed in, so it doesn't sit right next
//   to a "Logged in as …" line). Stays visible while the auth state is still
//   loading/unknown, so nothing flashes away before the first fetch resolves.
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
//   error_text?, logged_out_text? } — fetches `bind` (a "METHOD /path" GET)
//   on mount and shows a one-line login state. The response is expected to
//   carry `logged_in` (bool) and optionally `username`; `logged_in_text` is
//   a template interpolating any scalar field of the response (not just
//   {username}). When logged in and `logout_action` is set, renders a
//   "Logout" button that calls it and re-fetches `bind` on success.
//   `error_text` (optional, same {field} interpolation) renders instead of
//   `logged_out_text` when the response carries `configured: true` but
//   `logged_in: false` — a credential that's saved but not usable (expired,
//   revoked, wrong scope), distinct from never having configured one at
//   all. Omit it and behavior is unchanged: only `logged_out_text` (static,
//   no interpolation) is shown for both cases, as before.
//
//   toggle { bind, field, action: { call }, label?, on_text?, off_text?,
//   offline_field?, offline_text?, loading_text? } — a bind-backed switch.
//   Fetches `bind` (a "METHOD /path" GET) on mount and on the shared
//   RefreshContext bump, same lifecycle as `auth_status`. The bound
//   response may come wrapped as `{ ok, result }` (the leaf-tool bridge's
//   shape) — `result` is unwrapped automatically when present. If the
//   (unwrapped) response's `offline_field` (default "offline") is truthy,
//   `offline_text` (markdown) renders INSTEAD of the switch — the bridge
//   answers this way when the backing app's container isn't running, so a
//   stopped app shows an explanation rather than a dead control. Otherwise
//   a checkbox renders bound to `field` (default "enabled"); flipping it
//   POSTs `action.call` with body `{ <field>: <newValue> }`, applies the
//   (unwrapped) response as the new state, and bumps the shared refresh
//   counter. `on_text`/`off_text` render below the switch, {field}-
//   interpolated against the current response like `auth_status`'s texts.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { apiUrl, appSubdomainUrl } from '../apiBase';

// Parse a declarative action "GET /api/apps/hello/" into { method, path }.
function parseCall(call) {
  if (!call || typeof call !== 'string') return null;
  const [method, ...rest] = call.trim().split(/\s+/);
  return { method: (method || 'GET').toUpperCase(), path: rest.join(' ') };
}

// Renders markdown for widget content, forcing links to open in a new tab —
// this window usually renders inside a floating settings panel, so an
// in-page navigation (e.g. clicking the github.com/login/device link) would
// blow away the panel instead of just opening a reference in a new tab.
// A local string-replace instead of configuring `marked`'s renderer, since
// `marked` is a shared singleton module and mutating it globally would
// affect unrelated markdown elsewhere.
//
// Same-origin `/api/*` hrefs are ALSO rewritten to the workspace API origin
// (like the `iframe` widget's `src` already is via `apiUrl()`) — a markdown
// link is a real browser navigation, not a `fetch()`, so it never passes
// through the global fetch shim that rewrites every other same-origin call
// site. Without this, a link such as an OAuth "Connect" button pointing at
// this app's own `/api/apps/<slug>/oauth/start` 404s on a BYOD deployment,
// where the SPA host has no same-origin backend of its own.
function renderMarkdown(text, inline = false) {
  const html = inline ? marked.parseInline(text || '') : marked.parse(text || '');
  return html.replace(/<a href="([^"]*)"/g, (_match, href) => {
    const resolved = href.startsWith('/api/') ? apiUrl(href) : href;
    return `<a target="_blank" rel="noopener noreferrer" href="${resolved}"`;
  });
}

// Shared refresh signal for the whole window: bumped whenever a button/poll/
// form action completes successfully, so sibling `auth_status` widgets (which
// otherwise only fetch once on mount) pick up the new state — e.g. the
// "Logged in as …" line updating right after a device-flow login succeeds,
// without the user having to close and reopen the settings panel.
// loggedIn: null (unknown/loading) | true | false — set by whichever
// `auth_status` widget in this window resolves first (there's normally at
// most one per window).
const RefreshContext = createContext({
  counter: 0, bump: () => {}, loggedIn: null,
  onFocus: () => {}, isFocused: true,
});

function Widget({ widget }) {
  const { loggedIn } = useContext(RefreshContext);
  if (widget.hide_when_logged_in && loggedIn === true) return null;
  return <WidgetBody widget={widget} />;
}

function WidgetBody({ widget }) {
  const [result, setResult] = useState(null);
  // Holds the *initial* action response (e.g. the OAuth device-flow `start`
  // body with `user_code`/`verification_uri`). Kept separate from `result` so
  // the subsequent poll responses don't clobber the code the user must enter.
  const [startBody, setStartBody] = useState(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollState = useRef({ timer: null, deadline: 0, intervalMs: null });
  const { bump, onFocus, isFocused } = useContext(RefreshContext);

  useEffect(() => () => clearTimeout(pollState.current.timer), []);

  switch (widget.type) {
    case 'markdown':
      return (
        <div
          className="appwin-markdown"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(widget.value) }}
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
          if (doneValues.includes(body[doneField])) {
            setStartBody(null); // login resolved — retire the code block
            setResult({ ok: res.ok, status: res.status, body });
            stopPolling();
            bump(); // let sibling auth_status widgets refetch now that this resolved
            return;
          }
          // Intermediate poll (authorization_pending / slow_down): keep the code
          // block up, don't surface the churn to the user. A "slow_down"
          // response carries a bumped `interval` (seconds, OAuth device-flow
          // spec) that MUST be honored for the next poll — ignoring it (i.e.
          // always falling back to the configured interval_ms) makes the
          // client keep polling too fast forever, so the server keeps
          // replying slow_down and never surfaces "success" even after the
          // user has actually authorized on github.com. Use it when present.
          if (typeof body.interval === 'number' && body.interval > 0) {
            pollState.current.intervalMs = body.interval * 1000;
          }
        } catch (e) {
          setResult({ ok: false, error: String(e) });
          stopPolling();
          return;
        }
        pollState.current.timer = setTimeout(
          runPoll,
          pollState.current.intervalMs || pollCfg.interval_ms || 3000,
        );
      };

      const onClick = async () => {
        if (!call) return;
        setBusy(true);
        try {
          const res = await fetch(call.path, { method: call.method });
          const body = await res.json().catch(() => ({}));
          if (res.ok && pollCall) {
            // Auto-poll flow (e.g. OAuth device flow): the START body carries
            // the code the user must enter (user_code + verification_uri). Pin
            // it so it stays visible while we poll; poll responses land in
            // `result` and never overwrite the code.
            setStartBody(body);
            setResult(null);
            pollState.current.deadline = Date.now() + (pollCfg.timeout_ms || 300000);
            pollState.current.intervalMs = null; // reset — don't inherit a slow_down bump from a previous attempt
            setPolling(true);
            pollState.current.timer = setTimeout(runPoll, pollCfg.interval_ms || 3000);
          } else {
            setResult({ ok: res.ok, status: res.status, body });
            if (res.ok) bump();
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
          {startBody && startBody.user_code && (
            <div
              className="appwin-devicecode"
              data-testid="appwin-devicecode"
              style={{ margin: '0.75rem 0', padding: '0.75rem 1rem', border: '1px solid var(--color-border, #333)', borderRadius: 8, textAlign: 'center' }}
            >
              <p className="appwin-devicecode-lead" style={{ margin: '0 0 0.5rem', opacity: 0.85, fontSize: '0.9rem' }}>
                Enter this code at{' '}
                <a
                  href={startBody.verification_uri || 'https://github.com/login/device'}
                  target="_blank"
                  rel="noreferrer"
                >
                  {(startBody.verification_uri || 'github.com/login/device').replace(/^https?:\/\//, '')}
                </a>
                :
              </p>
              <code
                className="appwin-devicecode-code"
                style={{ display: 'inline-block', fontSize: '1.6rem', fontWeight: 700, letterSpacing: '0.15em', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              >
                {startBody.user_code}
              </code>
            </div>
          )}
          {polling && pollCfg.pending_text && (
            <p
              className="appwin-poll-pending"
              data-testid="appwin-poll-pending"
              // pending_text supports inline markdown (e.g. a `[label](url)`
              // link to the verification page) — parseInline avoids wrapping
              // it in a <p>, since we already render our own.
              dangerouslySetInnerHTML={{ __html: renderMarkdown(pollCfg.pending_text, true) }}
            />
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
      // Rewrite a same-origin `/api/*` src to the BYOD api host (like the fetch
      // shim does for fetch) — an iframe loads from the SPA origin, which
      // file-serves no /api, so a relative src would 404. apiUrl() leaves
      // absolute/non-/api srcs untouched. Lets a container app embed its own UI
      // (e.g. the AW Browser's noVNC screen at /api/apps/browser/…).
      //
      // The invisible overlay (only present while !isFocused) is what makes
      // a click land on the window at all — mousedown INSIDE an iframe's own
      // document never reaches the parent page's listeners (separate
      // document), so without this a click on the window BODY (title bar
      // excluded) silently did nothing (reported live 2026-08-05). Same
      // pattern as WindowManager.jsx's AppIframe/DebuggerIframe.
      return (
        <div className="appwin-iframe-wrap relative w-full h-full" onMouseDown={onFocus}>
          <iframe
            className="appwin-iframe"
            title={widget.title || 'app'}
            src={apiUrl(widget.src)}
            sandbox="allow-scripts allow-forms allow-same-origin"
            allow={widget.allow || undefined}
          />
          {!isFocused && <div className="absolute inset-0 z-10" onMouseDown={onFocus} />}
        </div>
      );

    case 'app_iframe': {
      const base = appSubdomainUrl(widget.app_id);
      if (!base) return null; // non-workspace host — no slug to derive the subdomain from
      return (
        <div className="appwin-iframe-wrap relative w-full h-full" onMouseDown={onFocus}>
          <iframe
            className="appwin-iframe"
            title={widget.title || 'app'}
            src={widget.path ? `${base}${widget.path}` : base}
            sandbox="allow-scripts allow-forms allow-same-origin"
            allow={widget.allow || undefined}
          />
          {!isFocused && <div className="absolute inset-0 z-10" onMouseDown={onFocus} />}
        </div>
      );
    }

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

    case 'toggle':
      return <Toggle widget={widget} />;

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
  const { bump } = useContext(RefreshContext);
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
      if (res.ok) bump();
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
  const { counter, setLoggedIn } = useContext(RefreshContext);
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
      setLoggedIn?.(!!body.logged_in);
    } catch (err) {
      setState({ loading: false, data: null, error: String(err) });
      setLoggedIn?.(null);
    }
  };

  // Re-fetches on mount AND whenever another widget in this window (e.g. the
  // device-flow login button) reports a completed action via `counter` —
  // otherwise this only ever fetched once, so "Logged in as …" stayed stale
  // even after a successful GitHub sign-in until the panel was reopened.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counter]);

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
    // Interpolate ANY scalar field of the bound response, not just
    // {username}: a credential panel needs to show more than a name (which
    // token is in place, what it can actually do), and hard-coding one
    // placeholder forced every such detail into a separate widget or a
    // custom UI. Unknown placeholders fall back to '—' rather than being
    // left as literal braces in the rendered text.
    const text = interpolate(widget.logged_in_text || 'Logged in as {username}', state.data, 'username', 'GitHub');
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
  // A token can be saved and still not be usable (expired, revoked, wrong
  // scope) — "configured" true / "logged_in" false is that state. Opt-in via
  // `error_text` so existing windows that only ever set `logged_out_text`
  // (no distinction between "never configured" and "configured but broken")
  // keep rendering exactly as before.
  if (widget.error_text && state.data.configured) {
    return (
      <p className="appwin-auth-status appwin-auth-status-error" data-testid="appwin-auth-status">
        {interpolate(widget.error_text, state.data)}
      </p>
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

// The leaf-tool bridge wraps a successful call as { ok, result } — unwrap
// when present so the widget always works off the plain status object,
// whether it came from the bind GET or a toggle action's POST response.
function unwrapResult(body) {
  return body && body.result !== undefined ? body.result : body;
}

function Toggle({ widget }) {
  const { counter, bump } = useContext(RefreshContext);
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [busy, setBusy] = useState(false);

  const bindCall = parseCall(widget.bind);
  const actionCall = parseCall(widget.action && widget.action.call);
  const field = widget.field || 'enabled';
  const offlineField = widget.offline_field || 'offline';

  const refresh = async () => {
    if (!bindCall) return;
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch(bindCall.path, { method: bindCall.method });
      const body = await res.json().catch(() => ({}));
      setState({ loading: false, data: unwrapResult(body), error: null });
    } catch (err) {
      setState({ loading: false, data: null, error: String(err) });
    }
  };

  // Re-fetches on mount AND whenever another widget in this window completes
  // an action (shared `counter`) — same reasoning as `auth_status`.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counter]);

  const onToggle = async () => {
    if (!actionCall || !state.data || busy) return;
    const next = !state.data[field];
    setBusy(true);
    try {
      const res = await fetch(actionCall.path, {
        method: actionCall.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      await res.json().catch(() => ({}));
      // Re-fetch `bind` for the up-to-date status (e.g. `effective` /
      // `proxy_reachable`, not just the field we flipped) rather than
      // trusting the action response — `bump()` drives this widget's own
      // refetch via the `counter` effect below, same as any sibling widget.
      bump();
    } catch (err) {
      setState((prev) => ({ ...prev, error: String(err) }));
    } finally {
      setBusy(false);
    }
  };

  if (state.loading) {
    return <p className="appwin-toggle" data-testid="appwin-toggle">{widget.loading_text || 'Checking…'}</p>;
  }
  if (state.error || !state.data) {
    return null;
  }
  if (state.data[offlineField]) {
    return (
      <div className="appwin-toggle appwin-toggle-offline" data-testid="appwin-toggle">
        {widget.label && <p className="appwin-toggle-label">{widget.label}</p>}
        <p
          className="appwin-toggle-offline-text"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(widget.offline_text || 'This setting is unavailable right now.', true),
          }}
        />
      </div>
    );
  }

  const checked = !!state.data[field];
  const text = checked ? widget.on_text : widget.off_text;
  return (
    <div className="appwin-toggle" data-testid="appwin-toggle">
      <label className="appwin-toggle-row">
        <input type="checkbox" checked={checked} disabled={busy} onChange={onToggle} />
        <span>{widget.label || ''}</span>
      </label>
      {text && <p className="appwin-toggle-text">{interpolate(text, state.data)}</p>}
    </div>
  );
}

// Replaces {key} placeholders with the matching scalar field off `data`.
// `fallbackKey`/`fallbackValue` special-case one placeholder's empty value
// (e.g. {username} -> 'GitHub') — every other unknown/empty placeholder
// renders as '—' rather than being left as a literal brace in the text.
function interpolate(template, data, fallbackKey, fallbackValue) {
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = data[key];
    if (value === undefined || value === null || value === '') {
      return key === fallbackKey ? fallbackValue : '—';
    }
    return Array.isArray(value) ? value.join(', ') : String(value);
  });
}

// spec: a parsed windows/main.json ({ title, regions: [{ id, widgets: [] }] }).
// onFocus/isFocused: threaded through context (not props) so any widget
// nested arbitrarily deep (e.g. inside a "collapsible") can reach them
// without prop-drilling every level — see the iframe/app_iframe cases
// below, the ones that actually need it.
export default function AppWindow({ spec, onFocus, isFocused = true }) {
  const [counter, setCounter] = useState(0);
  const [loggedIn, setLoggedIn] = useState(null);
  const bump = () => setCounter((c) => c + 1);
  if (!spec) return null;
  const regions = spec.regions || [];
  return (
    <RefreshContext.Provider value={{ counter, bump, loggedIn, setLoggedIn, onFocus, isFocused }}>
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
    </RefreshContext.Provider>
  );
}

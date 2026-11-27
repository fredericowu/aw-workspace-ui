// Earliest-possible error capture so the desktop-on-iPhone blank-screen
// issue leaves a breadcrumb in localStorage that survives reloads.
// Temporary — remove with the rest of the devctl/viewdbg plumbing.
;(function () {
  try {
    const buf = [];
    const save = () => { try { localStorage.setItem('aw_console_errs', JSON.stringify(buf.slice(-50))); } catch {} };
    const orig = console.error.bind(console);
    console.error = (...args) => {
      try {
        buf.push({ t: Date.now(), kind: 'console.error', msg: args.map(a => (a && a.stack) ? a.stack : (typeof a === 'object' ? (() => { try { return JSON.stringify(a).slice(0, 800); } catch { return String(a); } })() : String(a))).join(' ') });
        save();
      } catch {}
      orig(...args);
    };
    window.addEventListener('error', (e) => {
      buf.push({ t: Date.now(), kind: 'window.error', msg: e.message, src: e.filename, line: e.lineno, col: e.colno, stack: e.error && e.error.stack });
      save();
    });
    window.addEventListener('unhandledrejection', (e) => {
      buf.push({ t: Date.now(), kind: 'unhandledrejection', reason: String((e.reason && e.reason.stack) || e.reason) });
      save();
    });
  } catch {}
})()

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { installApiBaseShims } from './apiBase'
import { initApiKey } from './auth'

import App from './App.jsx'
import BootStatusChip from './components/BootStatusChip.jsx'
import { startViewdbg } from './lib/viewdbgClient'
import { installKbdModeSweep } from './lib/keyboardMode'
import { initOtel } from './otel.js'
import { initLaunchDarkly } from './launchdarkly.js'

// Browser tracing → SigNoz via the awserv OTLP proxy (/api/otlp/v1/traces).
initOtel()

// LaunchDarkly — feature flags + session replay + observability
// VITE_LAUNCHDARKLY_CLIENT_KEY is injected at build time from GHA var LAUNCHDARKLY_CLIENT_KEY.
const _ldClientKey = import.meta.env.VITE_LAUNCHDARKLY_CLIENT_KEY
initLaunchDarkly(_ldClientKey)

// Read api-key from URL params, save to localStorage, strip from URL
initApiKey()

// Temporary: iPhone Safari pinch-zoom-out viewport telemetry.
// Activates on `?viewdbg=1`.  Remove once the bug is diagnosed.
startViewdbg()

// Apply "suppress on-screen keyboard" state (if enabled) to all xterm
// helper textareas, and watch for new terminals via MutationObserver.
// The top-bar toggle in App.jsx writes to localStorage and dispatches
// the change event this sweep listens to.
installKbdModeSweep()

// Three-plane split: when served as the cloud SPA at <ws>.workspace.<domain>,
// route same-origin /api and /ws calls to the BYOD workspace API (no-op on the
// single-tenant dashboard). Installed LAST, AFTER initOtel()/initLaunchDarkly():
// OpenTelemetry's fetch instrumentation and LaunchDarkly Observability each
// replace window.fetch capturing the *native* fetch, so a shim installed before
// them gets bypassed. Installing last makes our rewrite the outermost wrapper —
// it rewrites the URL first, then delegates to the observability chain. Still
// before createRoot(), i.e. before the app issues its first /api/auth/status.
installApiBaseShims()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <BootStatusChip />
  </StrictMode>,
)

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch, wsUrl } from '../auth';
import { asArray } from '../lib/asArray';
import { GITHUB_PRS_PATH, GITHUB_REFRESH_PATH } from '../lib/githubApi';

const API_BASE = '';


export function useComponentStatus() {
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const wsRef = useRef(null);
  const reconnectTimeout = useRef(null);
  // Track whether we've already received at least one init message so we can
  // distinguish a first-load init (do nothing extra) from a reconnect init
  // (server just restarted — signal all terminal windows to reconnect).
  const hasConnectedOnceRef = useRef(false);

  const connect = useCallback(() => {
    const ws = new WebSocket(wsUrl('/ws/status'));
    wsRef.current = ws;

    ws.onmessage = (event) => {
      // This channel is JSON-text only, but the browser's default
      // `binaryType` is 'blob' — if a binary frame ever lands here (e.g. a
      // stray frame from a misrouted/reused connection), `event.data` is a
      // Blob, and JSON.parse throws synchronously with no useful message.
      // Drop it rather than let an uncaught exception skip whatever else
      // was queued in this handler run.
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.type === 'init') {
        setComponents(asArray(data.components));
        setLoading(false);
        // Backend now sends the full terminal list in the init message so
        // every new tab/browser gets an immediate snapshot without needing
        // a separate REST fetch.  Dispatch it through the same channel as
        // live terminal_update broadcasts — App.jsx's handler will call
        // applyTerminalUpdate() and prune stale openWindows entries.
        if (Array.isArray(data.terminals) && data.terminals.length > 0) {
          window.dispatchEvent(new CustomEvent('aw-terminals-update', {
            detail: { action: 'snapshot', terminals: data.terminals }
          }));
        }
        // After a server restart the terminal WebSocket connections may have
        // exhausted their auto-retry budget while the server was down.  Emit a
        // dedicated event so App.jsx can bump every terminal's reconnectSignal
        // and reset the retry counter, ensuring terminals come back to life
        // when the server does — regardless of how long the restart took.
        if (hasConnectedOnceRef.current) {
          window.dispatchEvent(new CustomEvent('aw-server-reconnected'));
        }
        hasConnectedOnceRef.current = true;
      } else if (data.type === 'terminal_update') {
        window.dispatchEvent(new CustomEvent('aw-terminals-update', {
          detail: { action: data.action, session_id: data.session_id, terminal: data.terminal, terminals: data.terminals }
        }));
      } else if (data.type === 'test_state_update') {
        window.dispatchEvent(new CustomEvent('aw-test-state-update', { detail: data.state }));
      } else if (data.type === 'prompt_notification') {
        window.dispatchEvent(new CustomEvent('aw-prompt-notification', {
          detail: data
        }));
      } else if (data.type === 'agent_sessions_update') {
        window.dispatchEvent(new CustomEvent('aw-agent-sessions-update', { detail: data }));
      } else if (data.type === 'task_update') {
        window.dispatchEvent(new CustomEvent('aw-task-update', { detail: data }));
      } else if (data.type === 'vscode_open_request') {
        // Server-pushed "open this file in code-server" — emitted by
        // POST /api/code-server/open when broadcast=true (the default,
        // used by the aw-vscode MCP). The App-level listener turns this
        // into window.open(url, popup_target, popup_features), the same
        // call Settings → Skills makes on its button click.
        window.dispatchEvent(new CustomEvent('aw-vscode-open', { detail: data }));
      } else if (data.type === 'vpn_update') {
        // Pushed by VpnPoller (every 10s + on mutation). Replaces the
        // setInterval-based polling that VpnNav and VpnTab used to do.
        // Listeners receive the full status payload as event.detail.
        window.dispatchEvent(new CustomEvent('aw-vpn-update', { detail: data }));
      } else if (data.type === 'procs_update') {
        // Pushed by ProcsWatchdog every 5s — replaces TerminalWindow's
        // per-window setInterval poll of /api/terminals/{id}/procs.
        // detail.procs is keyed by session_id (with per-process cpu%);
        // each TerminalWindow filters out its own slice.
        window.dispatchEvent(new CustomEvent('aw-procs-update', { detail: data }));
      } else if (data.type === 'aw_config_changed') {
        // Pushed by POST /api/aw-config/reload (used by the App Builder
        // MCP after it mutates aw.json). We re-emit the existing
        // window event that AwConfigTab fires on save so all the
        // listeners (AppsNav, MobileApp, PromptNotifications) refetch
        // /api/settings/aw and update live — no browser refresh, no
        // awserv restart. data.added / .removed / .changed list the
        // component-key diff if any consumer wants to act on it.
        window.dispatchEvent(new CustomEvent('aw-config-changed', { detail: data }));
        // Brand-new components need to show up in the components state too.
        // Re-fetch /api/components so the docker:aw-custom-* entries land
        // before the user clicks Start on them. We do this inline (rather
        // than calling refetch()) because the ws onmessage closure was
        // created before refetch was defined — capturing it would be a
        // forward-reference dance for no real win.
        apiFetch(`${API_BASE}/api/components`)
          .then((r) => r.json())
          .then((d) => setComponents(asArray(d)))
          .catch(() => {});
      } else if (data.type === 'notification') {
        // Server-pushed toast — e.g. a backend logger.error bridged by
        // NotificationLogHandler (src/api/log_broadcast.py). Reuse the same
        // aw-notification stack as client-side notifications so silent
        // server-side failures (like a frozen _save()) actually reach the user.
        window.dispatchEvent(new CustomEvent('aw-notification', {
          detail: { level: data.level || 'error', title: data.title, message: data.message },
        }));
      } else if (data.type === 'app_reload') {
        // Pushed by AppWatcher when a dev_mode-enabled app's watched
        // files change (debounced ~500ms). AppProxyWindow listens for
        // `aw-app-reload` events and remounts the iframe whose `appId`
        // matches `detail.app_id`, so the user sees their AI-built UI
        // refresh without touching the title-bar Reload button.
        window.dispatchEvent(new CustomEvent('aw-app-reload', { detail: data }));
      } else if (data.key) {
        setComponents((prev) => prev.map((c) =>
          c.key === data.key ? { ...c, ...data } : c
        ));
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      reconnectTimeout.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);
  const refetch = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/components`);
      const data = await res.json();
      setComponents(asArray(data));
    } catch {  }
  }, []);

  return { components, loading, refetch };
}

export async function startComponent(key) {
  const res = await apiFetch(`${API_BASE}/api/components/${key}/start`, { method: 'POST' });
  return res.json();
}

export async function stopComponent(key) {
  const res = await apiFetch(`${API_BASE}/api/components/${key}/stop`, { method: 'POST' });
  return res.json();
}

export async function restartComponent(key) {
  const res = await apiFetch(`${API_BASE}/api/components/${key}/restart`, { method: 'POST' });
  return res.json();
}

export async function getAwConfig() {
  const res = await apiFetch(`${API_BASE}/api/settings/aw`);
  return res.json();
}

export async function saveAwConfig(data) {
  const res = await apiFetch(`${API_BASE}/api/settings/aw`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function getGitHubPRs() {
  const res = await apiFetch(`${API_BASE}${GITHUB_PRS_PATH}`);
  return res.json();
}

export async function refreshGitHubPRs() {
  const res = await apiFetch(`${API_BASE}${GITHUB_REFRESH_PATH}`, { method: 'POST' });
  return res.json();
}


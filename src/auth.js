
let _popupView = null;

export function initAuth() {
  const params = new URLSearchParams(window.location.search);
  _popupView = params.get('view') || null;
  // Clean legacy api-key from URL if present (backward compat)
  if (params.has('api-key')) {
    params.delete('api-key');
    const clean = params.toString();
    const newUrl = window.location.pathname + (clean ? '?' + clean : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
  }
}

export function getPopupView() {
  return _popupView;
}

/** Check auth state with the server. Returns {authenticated, mode}. */
export async function getAuthStatus() {
  try {
    const res = await fetch('/api/auth/status', { credentials: 'include' });
    if (res.ok) return await res.json();
  } catch {
    // network error
  }
  return { authenticated: false, mode: 'password' };
}

/** Login with password. Returns true on success, error string on failure. */
export async function login(password) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) return true;
    const data = await res.json().catch(() => ({}));
    return data.message || 'Login failed';
  } catch {
    return 'Network error';
  }
}

/** Login as a scoped guest user. Returns {ok, apps, message}. */
export async function guestLogin(username, password) {
  try {
    const res = await fetch('/api/auth/guest-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, apps: data.apps || [] };
    return { ok: false, message: data.message || 'Login failed' };
  } catch {
    return { ok: false, message: 'Network error' };
  }
}

/** Logout — clears the JWT cookie server-side. */
export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function apiFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (res.status === 401) {
    window.dispatchEvent(new Event('aw-auth-failed'));
  }
  return res;
}

export function wsUrl(path) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  // Cookies are sent automatically on same-origin WS upgrade — no api-key needed
  return `${proto}//${host}${path}`;
}

// ---- Legacy stubs (kept so old callers compile) ----
export function getApiKey() { return ''; }
export function setApiKey() {}
export function clearApiKey() {}
export function initApiKey() { return initAuth(); }

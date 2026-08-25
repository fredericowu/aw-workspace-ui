import { useState, useEffect, useRef } from 'react';
import { getAwConfig } from '../hooks/useComponentStatus';
import { apiFetch } from '../auth';

/**
 * Settings > Users — scoped guest logins.
 *
 * A guest is a username/password pair (stored in Postgres, `guest_users`
 * table — never in aw.json, so it can't be clobbered by the Settings
 * page's full-file save) restricted to a fixed list of app ids. Guests
 * sign in at /guest-login and get a JWT that only unlocks their allowed
 * app subdomains — never the dashboard, never any other app, never
 * internal/API routes. See src/api/guest_auth.py + app_auth_gate.py +
 * caddy_template.py for the enforcement pipeline.
 */

// Tag/chip input: type an app id, press Enter/comma to add it as a chip,
// click the × on a chip to remove it. Suggests from the known app list.
function AppChipsInput({ value, onChange, knownApps }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const addChip = (raw) => {
    const id = raw.trim().toLowerCase();
    if (!id || value.includes(id)) return;
    onChange([...value, id]);
    setDraft('');
  };

  const removeChip = (id) => onChange(value.filter((a) => a !== id));

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addChip(draft);
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      removeChip(value[value.length - 1]);
    }
  };

  const suggestions = knownApps.filter(
    (a) => !value.includes(a.id) && (!draft || a.id.includes(draft.toLowerCase()))
  );

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 p-2 border border-[var(--color-border)] rounded bg-[var(--color-bg-secondary)] min-h-[38px]">
        {value.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
          >
            {id}
            <button
              type="button"
              onClick={() => removeChip(id)}
              className="hover:text-[var(--color-danger)] leading-none"
              aria-label={`Remove ${id}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => draft && addChip(draft)}
          placeholder={value.length === 0 ? 'app id, e.g. crispal' : ''}
          className="flex-1 min-w-[100px] bg-transparent text-xs text-[var(--color-text-primary)] outline-none py-0.5"
        />
      </div>
      {draft && suggestions.length > 0 && (
        <div className="mt-1 border border-[var(--color-border)] rounded bg-[var(--color-bg-secondary)] max-h-32 overflow-y-auto">
          {suggestions.slice(0, 8).map((a) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); addChip(a.id); }}
              className="block w-full text-left px-2 py-1 text-xs text-[var(--color-text-primary)] hover:bg-white/5"
            >
              {a.id} <span className="text-[var(--color-text-muted)]">— {a.label || a.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function UsersTab() {
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [knownApps, setKnownApps] = useState([]);
  const [loginUrl, setLoginUrl] = useState('');
  const [message, setMessage] = useState('');

  // New-user form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newApps, setNewApps] = useState([]);
  const [creating, setCreating] = useState(false);

  const showMessage = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const load = async () => {
    const res = await apiFetch('/api/guest-users');
    if (!res.ok) {
      setLoadError(`Failed to load users (HTTP ${res.status})`);
      setUsers([]);
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      setLoadError('Failed to load users: server returned an unexpected response');
      setUsers([]);
      return;
    }
    setLoadError('');
    setUsers(data);
  };

  useEffect(() => {
    load();
    getAwConfig().then((cfg) => {
      setKnownApps(cfg?.workspace_apps || []);
      if (cfg?.public_url) {
        setLoginUrl(`${cfg.public_url.replace(/\/$/, '')}/guest-login`);
      }
    });
  }, []);

  const createUser = async (e) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) {
      showMessage('Username and password are required');
      return;
    }
    setCreating(true);
    try {
      const res = await apiFetch('/api/guest-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          allowed_apps: newApps,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showMessage(data.detail || 'Failed to create user');
      } else {
        showMessage(`Created ${data.username}`);
        setNewUsername('');
        setNewPassword('');
        setNewApps([]);
        load();
      }
    } catch {
      showMessage('Network error');
    } finally {
      setCreating(false);
    }
  };

  const updateApps = async (id, apps) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, allowed_apps: apps } : u)));
    const res = await apiFetch(`/api/guest-users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_apps: apps }),
    });
    if (!res.ok) {
      showMessage('Failed to update scope');
      load();
    }
  };

  const deleteUser = async (id, username) => {
    const res = await apiFetch(`/api/guest-users/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showMessage(`Removed ${username}`);
      load();
    } else {
      showMessage('Failed to remove user');
    }
  };

  if (!users) {
    return <div className="p-6 text-[var(--color-text-muted)]">Loading…</div>;
  }

  return (
    <div className="p-4 max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Users</h2>
        {message && <span className="text-xs text-[var(--color-text-muted)]">{message}</span>}
      </div>
      {loadError && (
        <p
          data-testid="users-load-error"
          role="alert"
          className="text-xs text-[var(--color-danger)] mb-3"
        >
          {loadError}
        </p>
      )}
      <p className="text-xs text-[var(--color-text-muted)] mb-1">
        Scoped guest logins — a username/password limited to specific apps. A guest can
        never reach the dashboard, any other app, or internal APIs — only the apps you list here.
      </p>
      {loginUrl && (
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          Guests sign in at{' '}
          <a href={loginUrl} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] font-mono">
            {loginUrl}
          </a>
        </p>
      )}

      {/* Existing users */}
      {users.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)] italic mb-4">No guest users yet.</p>
      ) : (
        <div className="border border-[var(--color-border)] rounded overflow-hidden mb-6">
          {users.map((u, i) => (
            <div
              key={u.id}
              className={`px-4 py-3 ${i !== users.length - 1 ? 'border-b border-[var(--color-border)]' : ''}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">{u.username}</span>
                <button
                  onClick={() => deleteUser(u.id, u.username)}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                >
                  Remove
                </button>
              </div>
              <AppChipsInput
                value={u.allowed_apps || []}
                onChange={(apps) => updateApps(u.id, apps)}
                knownApps={knownApps}
              />
            </div>
          ))}
        </div>
      )}

      {/* New user form */}
      <form onSubmit={createUser} className="border border-[var(--color-border)] rounded p-4 space-y-3">
        <h3 className="text-xs font-semibold text-[var(--color-text-primary)]">Add guest user</h3>
        <div className="flex gap-2">
          <input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="Username"
            className="flex-1 bg-[var(--color-bg-secondary)] text-xs text-[var(--color-text-primary)] border border-[var(--color-border)] rounded px-2 py-1.5 outline-none focus:border-[var(--color-accent)]"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Password"
            className="flex-1 bg-[var(--color-bg-secondary)] text-xs text-[var(--color-text-primary)] border border-[var(--color-border)] rounded px-2 py-1.5 outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <AppChipsInput value={newApps} onChange={setNewApps} knownApps={knownApps} />
        <button
          type="submit"
          disabled={creating}
          className="px-3 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Add user'}
        </button>
      </form>
    </div>
  );
}

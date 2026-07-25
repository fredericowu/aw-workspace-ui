import { useState } from 'react';
import { login, guestLogin } from '../auth';

export default function AuthScreen({ onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRoot, setIsRoot] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestApps, setGuestApps] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password || (!isRoot && !username)) return;
    setLoading(true);
    setError('');

    if (isRoot) {
      const result = await login(password);
      setLoading(false);
      if (result === true) {
        onAuthenticated();
      } else if (result === 'No password set. Run ./aw set-pass first.') {
        setError('No password configured. Run ./aw set-pass in the terminal.');
      } else {
        setError(typeof result === 'string' ? result : 'Invalid password');
      }
      return;
    }

    const result = await guestLogin(username, password);
    setLoading(false);
    if (!result.ok) {
      setError(result.message || 'Invalid username or password');
      return;
    }
    if (result.apps.length === 1) {
      window.location.href = `https://${result.apps[0]}.app.${window.location.hostname}`;
      return;
    }
    setGuestApps(result.apps);
  };

  if (guestApps !== null) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
        <div className="w-80 text-center">
          <span className="text-2xl font-bold tracking-wide text-[var(--color-accent)]">AW</span>
          {guestApps.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] mt-4">
              Signed in, but no apps are in your scope yet — ask your admin.
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--color-text-muted)] mt-4 mb-2">Choose an app:</p>
              {guestApps.map((app) => (
                <p key={app}>
                  <a
                    className="text-[var(--color-accent)] hover:underline"
                    href={`https://${app}.app.${window.location.hostname}`}
                  >
                    {app}
                  </a>
                </p>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
      <div className="w-80">
        <div className="text-center mb-6">
          <span className="text-2xl font-bold tracking-wide text-[var(--color-accent)]">AW</span>
          <p className="text-sm text-[var(--color-text-muted)] mt-2">
            {isRoot ? 'Enter your password to continue' : 'Sign in to continue'}
          </p>
        </div>
        <form onSubmit={handleSubmit}>
          {!isRoot && (
            <input
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              placeholder="Username"
              autoComplete="username"
              autoFocus
              disabled={loading}
              className="w-full bg-[var(--color-bg-secondary)] text-sm text-[var(--color-text-primary)] border border-[var(--color-border)] focus:border-[var(--color-accent)] rounded px-3 py-2 outline-none transition-colors mb-2"
            />
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            placeholder="Password"
            autoComplete="current-password"
            autoFocus={isRoot}
            disabled={loading}
            className={`w-full bg-[var(--color-bg-secondary)] text-sm text-[var(--color-text-primary)] border rounded px-3 py-2 outline-none transition-colors ${
              error ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)] focus:border-[var(--color-accent)]'
            }`}
          />
          {error && (
            <p className="text-xs text-[var(--color-danger)] mt-1">{error}</p>
          )}
          <label className="flex items-center gap-2 mt-3 text-xs text-[var(--color-text-muted)] select-none cursor-pointer">
            <input
              type="checkbox"
              checked={isRoot}
              onChange={(e) => { setIsRoot(e.target.checked); setError(''); }}
              disabled={loading}
              className="cursor-pointer"
            />
            Root account
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-3 px-4 py-2 text-sm rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

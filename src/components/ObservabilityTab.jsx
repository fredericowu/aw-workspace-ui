import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth';

// Settings > Observability — where THIS workspace sends OTLP telemetry.
// Mirrors aw-workspace's src/api/observability.py: four explicit states
// (never "blank field = auto-or-off, guess which", which is ambiguous once
// aw-app-signoz is installed — does blank mean "don't export" or "use the
// local one"?).
//
// - auto (default) — exports to this workspace's own aw-app-signoz WHILE
//   it's installed, exports nothing while it isn't. No manual step either
//   way: install the app and telemetry just appears.
// - off — an explicit opt-out. Unlike auto, installing aw-app-signoz later
//   does not turn this back on.
// - local — an explicit opt-in, only selectable while aw-app-signoz is
//   installed; endpoint + key are resolved server-side, nothing typed here.
//   Differs from auto only in what happens if the app disappears: this one
//   falls back to Desligado and stays there (see the warning banner below).
// - custom — endpoint + key typed by hand, e.g. pointing at the
//   aw-app-signoz of a *different* workspace of the same owner.

const MODES = [
  {
    key: 'auto',
    label: 'Auto',
    hint: 'Uses this workspace’s own aw-app-signoz automatically while it’s installed; exports nothing otherwise.',
  },
  { key: 'off', label: 'Desligado', hint: 'Nothing is exported, even if aw-app-signoz is installed.' },
  {
    key: 'local',
    label: 'Local (fixed)',
    hint: 'Same as Auto, but if aw-app-signoz is later uninstalled this falls back to Desligado instead of resuming automatically.',
  },
  {
    key: 'custom',
    label: 'Custom',
    hint: 'Point at any OTLP/HTTP collector — e.g. the aw-app-signoz of another workspace.',
  },
];

function maskKey(key) {
  if (!key) return '';
  return '•'.repeat(Math.min(key.length, 40));
}

export default function ObservabilityTab() {
  const [data, setData] = useState(null);
  const [selectedMode, setSelectedMode] = useState(null);
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [pushWarning, setPushWarning] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/settings/observability');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.detail || `Load failed (${res.status})`);
      setData(body);
      setSelectedMode(body.mode);
      setCustomEndpoint(body.custom?.endpoint || '');
      setCustomApiKey(body.custom?.api_key || '');
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (mode, endpointOverride, apiKeyOverride) => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/settings/observability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          custom: {
            endpoint: endpointOverride ?? customEndpoint,
            api_key: apiKeyOverride ?? customApiKey,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.detail || `Save failed (${res.status})`);
      setData(body);
      setSelectedMode(body.mode);
      // The setting itself always persisted at this point (a push failure
      // never fails the PUT) — this only flags that AP-MT didn't get the
      // new target. No auto-retry: clicking Save again is the retry.
      setPushWarning(body.push && body.push.ok === false
        ? `Config saved locally, but reaching AP-MT failed (${body.push.reason || 'unknown error'}) — save again to retry.`
        : null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }, [customEndpoint, customApiKey]);

  const pickMode = (mode) => {
    setSelectedMode(mode);
    // Off/Local need no extra input, so persist immediately. Custom waits
    // for the user to fill the form and hit Save — nothing to send yet.
    if (mode !== 'custom') save(mode);
  };

  if (loading) {
    return <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading...</div>;
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Observability</h2>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Where this workspace sends OTLP telemetry (traces/metrics/logs). Read by other
          components of this workspace (and, for a future card, the Agents Platform control
          plane) via <code className="bg-white/10 px-1 rounded">GET /api/settings/observability</code>.
        </p>
      </div>

      {error && <div className="text-xs text-red-400 mb-3">{error}</div>}
      {data?.warning && (
        <div className="text-xs text-amber-400 mb-3 px-2.5 py-1.5 rounded bg-amber-500/10 border border-amber-500/30">
          {data.warning}
        </div>
      )}
      {pushWarning && (
        <div
          className="text-xs text-amber-400 mb-3 px-2.5 py-1.5 rounded bg-amber-500/10 border border-amber-500/30"
          data-testid="observability-push-warning"
        >
          {pushWarning}
        </div>
      )}

      <div className="max-w-2xl rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 space-y-4">
        <div role="radiogroup" aria-label="Observability mode" className="space-y-2">
          {MODES.map((m) => {
            const disabled = m.key === 'local' && !data?.local_available;
            return (
              <label
                key={m.key}
                className={`flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition-colors ${
                  selectedMode === m.key
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-border)] hover:bg-white/5'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="observability-mode"
                  value={m.key}
                  aria-label={m.label}
                  checked={selectedMode === m.key}
                  disabled={disabled || saving}
                  onChange={() => pickMode(m.key)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="text-xs font-medium text-[var(--color-text-primary)]">{m.label}</div>
                  <div className="text-[11px] text-[var(--color-text-muted)]">
                    {disabled ? 'Requires aw-app-signoz installed in this workspace.' : m.hint}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {(selectedMode === 'local' || selectedMode === 'auto') && data?.resolved && (
          <div className="pt-2 border-t border-[var(--color-border)] space-y-1.5">
            <div className="text-[11px] text-[var(--color-text-muted)]">Resolved endpoint</div>
            <code
              className="block px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                text-[var(--color-text-primary)] font-mono truncate"
              data-testid="observability-resolved-endpoint"
            >
              {data.resolved.endpoint}
            </code>
          </div>
        )}

        {selectedMode === 'custom' && (
          <div className="pt-2 border-t border-[var(--color-border)] space-y-3">
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-primary)] block mb-1">
                OTLP endpoint
              </label>
              <input
                type="text"
                value={customEndpoint}
                onChange={(e) => setCustomEndpoint(e.target.value)}
                placeholder="https://signoz.app.other-workspace.workspace.example.com"
                className="w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                  text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-[var(--color-accent)]/60"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-primary)] block mb-1">
                API key
              </label>
              <div className="flex items-center gap-2">
                <input
                  type={keyVisible ? 'text' : 'password'}
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  placeholder="that workspace's X-Api-Key"
                  className="flex-1 px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                    text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-[var(--color-accent)]/60"
                />
                <button
                  type="button"
                  onClick={() => setKeyVisible((v) => !v)}
                  className="px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  {keyVisible ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <button
              onClick={() => save('custom')}
              disabled={saving || !customEndpoint.trim()}
              className="px-4 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="max-w-2xl pt-3 text-[10px] text-[var(--color-text-muted)]">
        Persisted in this workspace's own settings table (key <code>observability</code>).
        If <code>aw-app-signoz</code> is uninstalled while Local is selected, this falls back
        to Desligado and shows a warning here rather than silently keeping a dead endpoint.
        This workspace's own core process (logs + traces) already exports itself under Auto
        and Local. aw-backend and mcp-gateway are not instrumented yet — a working config
        here has nothing to export from them until that happens separately.
      </div>
    </div>
  );
}

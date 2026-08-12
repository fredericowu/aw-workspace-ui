// Settings → General → Marketplace. Manage the marketplaces the app catalog
// is merged from, including private ones.
//
// Two things this screen is deliberately explicit about:
//  - The token is write-only. We can never render it back (the API only
//    reports `has_credential`), so the field shows a "saved" state and an
//    explicit Remove rather than pretending to round-trip a value.
//  - The credential is bound to a host. Users paste GitHub PATs; a token
//    silently attached to every source would mean adding someone else's
//    catalog URL leaks it. The host is shown, not hidden, so the binding is
//    visible at the moment the token is entered.
import { useState, useEffect, useCallback } from 'react';
import {
  listSources, createSource, updateSource, deleteSource, clearCredential, testSource,
} from '../api/marketplaceApi';

const AUTH_TYPES = [
  { value: 'none', label: 'Public (no auth)' },
  { value: 'github_pat', label: 'GitHub token (PAT)' },
  { value: 'bearer', label: 'Bearer token' },
];

const EMPTY = {
  id: '', name: '', url: '', enabled: true, priority: 100,
  auth_type: 'none', auth_host: '', credential: '',
};

function hostOf(url) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) {
    try { return new URL(url).hostname; } catch { return ''; }
  }
  return 'github.com';
}

function Field({ label, hint, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-[11px] font-medium text-[var(--color-text-secondary)] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-[var(--color-text-muted)] mt-1">{hint}</span>}
    </label>
  );
}

const INPUT_CLS =
  'w-full px-2 py-1.5 text-[12px] rounded bg-[var(--color-bg-primary)] border ' +
  'border-[var(--color-border)] text-[var(--color-text-primary)] ' +
  'focus:outline-none focus:border-[var(--color-accent)]';

function SourceForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...EMPTY, ...initial, credential: '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isEdit = Boolean(initial?.id);
  const boundHost = form.auth_host || hostOf(form.url);

  return (
    <form
      className="border border-[var(--color-border)] rounded p-3 mb-3 bg-[var(--color-bg-header)]"
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}
    >
      <Field label="Catalog URL" hint="owner/repo, owner/repo@ref, or a full https:// URL to the catalog JSON.">
        <input
          className={INPUT_CLS} value={form.url} required
          placeholder="tekflox/aw-marketplace-private@master"
          onChange={(e) => set('url', e.target.value)}
        />
      </Field>

      <Field label="Name" hint="Shown in the Marketplace panel. Defaults to the id.">
        <input
          className={INPUT_CLS} value={form.name}
          placeholder="Private marketplace"
          onChange={(e) => set('name', e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Authentication">
          <select
            className={INPUT_CLS} value={form.auth_type}
            onChange={(e) => set('auth_type', e.target.value)}
          >
            {AUTH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Priority" hint="Lower merges first; first source wins on duplicate app ids.">
          <input
            type="number" className={INPUT_CLS} value={form.priority}
            onChange={(e) => set('priority', e.target.value)}
          />
        </Field>
      </div>

      {form.auth_type !== 'none' && (
        <>
          <Field
            label={isEdit && initial?.has_credential ? 'Token (leave blank to keep the saved one)' : 'Token'}
            hint={`Stored encrypted and never shown again. Sent only to ${boundHost || 'the source host'} — never to any other host.`}
          >
            <input
              type="password" className={INPUT_CLS} value={form.credential}
              autoComplete="new-password"
              placeholder={isEdit && initial?.has_credential ? '•••••••• saved' : 'ghp_… / github_pat_…'}
              onChange={(e) => set('credential', e.target.value)}
            />
          </Field>
          <Field label="Credential host" hint="The only host this token may be sent to. Change it only for a self-hosted catalog.">
            <input
              className={INPUT_CLS} value={form.auth_host}
              placeholder={hostOf(form.url)}
              onChange={(e) => set('auth_host', e.target.value)}
            />
          </Field>
        </>
      )}

      <label className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)] mb-3">
        <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        Enabled
      </label>

      <div className="flex gap-2">
        <button
          type="submit" disabled={saving}
          className="px-3 py-1.5 text-[12px] rounded bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : isEdit ? 'Save' : 'Add marketplace'}
        </button>
        <button
          type="button" onClick={onCancel}
          className="px-3 py-1.5 text-[12px] rounded border border-[var(--color-border)] text-[var(--color-text-secondary)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SourceRow({ source, onEdit, onDelete, onClearCredential, onTest, testResult, busy }) {
  return (
    <div className="border border-[var(--color-border)] rounded px-3 py-2 mb-2">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${source.enabled ? 'bg-green-400' : 'bg-gray-500'}`} />
        <span className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">{source.name}</span>
        {source.auth_type !== 'none' && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 shrink-0"
            title={`Token sent only to ${source.auth_host}`}
          >
            {source.has_credential ? `auth · ${source.auth_host}` : 'token missing'}
          </span>
        )}
        <span className="ml-auto text-[10px] text-[var(--color-text-muted)] shrink-0">#{source.priority}</span>
      </div>
      <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5 truncate">{source.url}</div>

      {testResult && (
        <div className={`text-[11px] mt-1 ${testResult.ok ? 'text-green-400' : 'text-[var(--color-danger)]'}`}>
          {testResult.ok
            ? `OK — ${testResult.app_count} app(s) found.`
            : `Failed — ${testResult.error}`}
        </div>
      )}

      <div className="flex gap-3 mt-1.5">
        <button className="text-[11px] text-[var(--color-accent)]" onClick={() => onTest(source)} disabled={busy}>
          Test
        </button>
        <button className="text-[11px] text-[var(--color-text-secondary)]" onClick={() => onEdit(source)}>
          Edit
        </button>
        {source.has_credential && (
          <button className="text-[11px] text-[var(--color-text-secondary)]" onClick={() => onClearCredential(source)}>
            Remove token
          </button>
        )}
        <button className="text-[11px] text-[var(--color-danger)] ml-auto" onClick={() => onDelete(source)}>
          Delete
        </button>
      </div>
    </div>
  );
}

export default function MarketplaceTab() {
  const [sources, setSources] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // source object, or {} for "new"
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState({});
  const [busyId, setBusyId] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    return listSources()
      .then((d) => { setSources(d.sources || []); setError(null); })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const save = async (form) => {
    setSaving(true);
    try {
      const payload = { ...form, priority: Number(form.priority) || 100 };
      if (!payload.credential) delete payload.credential;
      if (editing?.id) await updateSource(editing.id, payload);
      else await createSource(payload);
      setEditing(null);
      await reload();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`Remove marketplace "${s.name}"? Apps already installed from it stay installed.`)) return;
    try { await deleteSource(s.id); await reload(); } catch (e) { setError(String(e.message || e)); }
  };

  const dropCredential = async (s) => {
    try { await clearCredential(s.id); await reload(); } catch (e) { setError(String(e.message || e)); }
  };

  const runTest = async (s) => {
    setBusyId(s.id);
    try {
      const r = await testSource(s.id);
      setTests((t) => ({ ...t, [s.id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [s.id]: { ok: false, error: String(e.message || e) } }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-xl">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">Marketplace</h3>
      <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
        Sources the app catalog is merged from. Private marketplaces authenticate with their own
        token, which is stored encrypted and only ever sent to the host it is bound to.
      </p>

      {error && (
        <div className="mb-3 px-2 py-1.5 text-[11px] rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {editing !== null && (
        <SourceForm
          initial={editing.id ? editing : null}
          onSave={save}
          onCancel={() => setEditing(null)}
          saving={saving}
        />
      )}

      {loading && <div className="text-[12px] text-[var(--color-text-muted)]">Loading…</div>}

      {!loading && sources.length === 0 && (
        <div className="text-[12px] text-[var(--color-text-muted)] italic mb-3">
          No marketplace configured here yet — the built-in public catalog is still used.
        </div>
      )}

      {sources.map((s) => (
        <SourceRow
          key={s.id}
          source={s}
          testResult={tests[s.id]}
          busy={busyId === s.id}
          onEdit={setEditing}
          onDelete={remove}
          onClearCredential={dropCredential}
          onTest={runTest}
        />
      ))}

      {editing === null && (
        <button
          onClick={() => setEditing({})}
          className="mt-2 px-3 py-1.5 text-[12px] rounded border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-white/5"
        >
          + Add marketplace
        </button>
      )}
    </div>
  );
}

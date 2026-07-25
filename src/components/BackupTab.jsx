import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../auth';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const DEFAULT_BACKUP = {
  enabled: true,
  storage: {
    type: 's3',
    bucket: 'tekflox-aw-backup',
    prefix: 'aw',
  },
  rotation: {
    mode: 'weekday',
    slots: WEEKDAYS,
  },
  rules: [
    {
      id: 'postgres-default',
      enabled: true,
      name: 'Postgres logical dump',
      type: 'postgres',
      schedule: { kind: 'daily', time: '02:00' },
      targets: ['aw-postgres', 'aw-pgvector'],
      output: 'postgres/daily/{weekday}.tgz',
      excludes: [],
    },
  ],
};

function newRule(type = 'directory') {
  const stamp = Date.now().toString(36);
  return {
    id: `${type}-${stamp}`,
    enabled: true,
    name: type === 'postgres' ? 'Postgres dump' : type === 'file' ? 'File backup' : 'Directory backup',
    type,
    schedule: { kind: 'daily', time: '02:00' },
    paths: type === 'directory' ? ['data/home'] : type === 'file' ? ['.env'] : [],
    targets: type === 'postgres' ? ['aw-postgres'] : [],
    excludes: [],
    output: type === 'postgres' ? 'postgres/daily/{weekday}.tgz' : `${type}/daily/{weekday}.tgz`,
  };
}

function linesToArray(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

function arrayToLines(items) {
  return (items || []).join('\n');
}

function inputClass(extra = '') {
  return `w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)]/50 focus:outline-none focus:border-[var(--color-accent)]/70 ${extra}`;
}

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-[var(--color-accent)]' : 'bg-white/10'}`}
      aria-pressed={value}
    >
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function RuleEditor({ rule, onChange, onRemove }) {
  const patch = (data) => onChange({ ...rule, ...data });
  const isPostgres = rule.type === 'postgres';
  const listField = isPostgres ? 'targets' : 'paths';

  return (
    <div className="border border-[var(--color-border)] rounded bg-[var(--color-bg-secondary)]/60 p-3">
      <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-center mb-3">
        <Toggle value={rule.enabled !== false} onChange={(enabled) => patch({ enabled })} />
        <input
          value={rule.name || ''}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Rule name"
          className={inputClass('font-medium')}
        />
        <button
          type="button"
          onClick={onRemove}
          className="px-2 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:border-[var(--color-danger)]/60"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <label>
          <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">Type</span>
          <select
            value={rule.type || 'directory'}
            onChange={(e) => {
              const base = newRule(e.target.value);
              patch({
                type: base.type,
                paths: base.paths,
                targets: base.targets,
                output: base.output,
              });
            }}
            className={inputClass()}
          >
            <option value="postgres">Postgres</option>
            <option value="directory">Directory</option>
            <option value="file">File</option>
          </select>
        </label>

        <label>
          <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">Schedule</span>
          <select
            value={rule.schedule?.kind || 'daily'}
            onChange={(e) => patch({ schedule: { ...(rule.schedule || {}), kind: e.target.value } })}
            className={inputClass()}
          >
            <option value="manual">Manual</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>

        <label>
          <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">Time</span>
          <input
            type="time"
            value={rule.schedule?.time || '02:00'}
            onChange={(e) => patch({ schedule: { ...(rule.schedule || {}), time: e.target.value } })}
            className={inputClass()}
          />
        </label>

        <label>
          <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">Output key</span>
          <input
            value={rule.output || ''}
            onChange={(e) => patch({ output: e.target.value })}
            placeholder={`${rule.type || 'directory'}/daily/{weekday}.tgz`}
            className={inputClass('font-mono')}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <label>
          <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">
            {isPostgres ? 'Postgres containers' : 'Paths'}
          </span>
          <textarea
            value={arrayToLines(rule[listField])}
            onChange={(e) => patch({ [listField]: linesToArray(e.target.value) })}
            placeholder={isPostgres ? 'aw-postgres\naw-pgvector' : 'data/home\n.env'}
            rows={4}
            className={inputClass('font-mono resize-y')}
          />
        </label>

        <label>
          <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">Excludes</span>
          <textarea
            value={arrayToLines(rule.excludes)}
            onChange={(e) => patch({ excludes: linesToArray(e.target.value) })}
            placeholder={'**/.cache/**\n**/node_modules/**\n**/*.log'}
            rows={4}
            className={inputClass('font-mono resize-y')}
          />
        </label>
      </div>
    </div>
  );
}

export default function BackupTab() {
  const [config, setConfig] = useState(null);
  const [backup, setBackup] = useState(DEFAULT_BACKUP);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch('/api/settings/aw')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setConfig(data);
        setBackup({
          ...DEFAULT_BACKUP,
          ...(data.backup || {}),
          storage: { ...DEFAULT_BACKUP.storage, ...(data.backup?.storage || {}) },
          rotation: { ...DEFAULT_BACKUP.rotation, ...(data.backup?.rotation || {}) },
          rules: data.backup?.rules?.length ? data.backup.rules : DEFAULT_BACKUP.rules,
        });
      })
      .catch((err) => setMessage(`Load failed: ${err.message}`))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const patchBackup = useCallback((patch) => {
    setBackup((prev) => ({ ...prev, ...patch }));
  }, []);

  const patchStorage = useCallback((patch) => {
    setBackup((prev) => ({ ...prev, storage: { ...(prev.storage || {}), ...patch } }));
  }, []);

  const save = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    setMessage('');
    try {
      const updated = { ...config, backup };
      const res = await apiFetch('/api/settings/aw', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (!res.ok) throw new Error(await res.text());
      setConfig(updated);
      setMessage('Saved');
      window.dispatchEvent(new Event('aw-config-changed'));
    } catch (err) {
      setMessage(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [backup, config]);

  const dryRunCommand = useMemo(() => {
    const bucket = backup.storage?.bucket || DEFAULT_BACKUP.storage.bucket;
    const prefix = backup.storage?.prefix || DEFAULT_BACKUP.storage.prefix;
    return `AW_BACKUP_S3_BUCKET=${bucket} AW_BACKUP_S3_PREFIX=${prefix} ./aw backup postgres --dry-run`;
  }, [backup.storage?.bucket, backup.storage?.prefix]);

  if (loading) {
    return <div className="p-4 text-sm text-[var(--color-text-muted)]">Loading backup settings...</div>;
  }

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">Backup</h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Configure S3 storage, rotation, databases, files, directories, and exclusions.</p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {message && (
        <div className="text-xs rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text-muted)]">
          {message}
        </div>
      )}

      <section className="border border-[var(--color-border)] rounded bg-[var(--color-bg-secondary)]/50 p-3">
        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_1fr_180px] gap-3 items-end">
          <label className="flex items-center gap-2 pb-1">
            <Toggle value={backup.enabled !== false} onChange={(enabled) => patchBackup({ enabled })} />
            <span className="text-xs text-[var(--color-text-primary)]">Enabled</span>
          </label>
          <label>
            <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">S3 bucket</span>
            <input
              value={backup.storage?.bucket || ''}
              onChange={(e) => patchStorage({ bucket: e.target.value })}
              className={inputClass('font-mono')}
            />
          </label>
          <label>
            <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">S3 prefix</span>
            <input
              value={backup.storage?.prefix || ''}
              onChange={(e) => patchStorage({ prefix: e.target.value })}
              className={inputClass('font-mono')}
            />
          </label>
          <label>
            <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">Rotation</span>
            <select
              value={backup.rotation?.mode || 'weekday'}
              onChange={(e) => patchBackup({ rotation: { ...(backup.rotation || {}), mode: e.target.value } })}
              className={inputClass()}
            >
              <option value="weekday">Weekday slots</option>
              <option value="date">Date slots</option>
              <option value="timestamp">Timestamped</option>
            </select>
          </label>
        </div>
        <div className="mt-3 text-[11px] text-[var(--color-text-muted)] font-mono truncate">{dryRunCommand}</div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-[var(--color-text-primary)] flex-1">Rules</h2>
          <button type="button" onClick={() => patchBackup({ rules: [...(backup.rules || []), newRule('postgres')] })}
            className="px-2.5 py-1 text-xs rounded border border-[var(--color-border)] hover:bg-white/5">Add Postgres</button>
          <button type="button" onClick={() => patchBackup({ rules: [...(backup.rules || []), newRule('directory')] })}
            className="px-2.5 py-1 text-xs rounded border border-[var(--color-border)] hover:bg-white/5">Add Directory</button>
          <button type="button" onClick={() => patchBackup({ rules: [...(backup.rules || []), newRule('file')] })}
            className="px-2.5 py-1 text-xs rounded border border-[var(--color-border)] hover:bg-white/5">Add File</button>
        </div>

        {(backup.rules || []).map((rule, index) => (
          <RuleEditor
            key={rule.id || index}
            rule={rule}
            onChange={(next) => patchBackup({ rules: backup.rules.map((r, i) => (i === index ? next : r)) })}
            onRemove={() => patchBackup({ rules: backup.rules.filter((_, i) => i !== index) })}
          />
        ))}
      </section>
    </div>
  );
}

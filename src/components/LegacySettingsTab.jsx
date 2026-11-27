// Legacy settings: exactly two fixed whole-document JSON editors, one per
// settings row URL. Keys and paths are constants here, never props or derived
// from the URL, and every request is a relative path through apiFetch so each
// workspace talks only to its own store. These rows are NOT the MCP Tools or
// Feed Subscriber configuration, and nothing here copies between them.
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../auth';
import { listInstalledApps } from '../apps/appsApi';
import {
  LEGACY_PATHS, classifyGet, canonical, parseDraft, validateDocument,
  buildPutBody, putSucceeded, snapshotOf, describeState,
} from '../lib/legacySettings';

const SPECS = Object.freeze({
  mcp: { key: 'mcp', title: 'MCP legacy row', path: LEGACY_PATHS.mcp },
  aw: { key: 'aw', title: 'AW legacy row', path: LEGACY_PATHS.aw },
});

async function readRow(spec) {
  const res = await apiFetch(spec.path);
  const body = await res.json().catch(() => null);
  return classifyGet(spec.key, res.status, body);
}

function LegacyEditor({ spec, onNavigate, mcpToolsInstalled }) {
  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [cls, setCls] = useState(null);
  const [errStatus, setErrStatus] = useState(null);
  const [text, setText] = useState('{}');
  const [loadedSnap, setLoadedSnap] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const apply = useCallback((c) => {
    if (c.kind === 'error') { setErrStatus(c.status); setPhase('error'); return; }
    setCls(c);
    setLoadedSnap(snapshotOf(c));
    setText(JSON.stringify(c.exists ? c.document : {}, null, 2));
    setPhase('ready');
  }, []);

  const [reloadTick, setReloadTick] = useState(0);
  const load = useCallback(() => {
    setPhase('loading');
    setMessage(null);
    setReloadTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    readRow(spec)
      .then((c) => { if (alive) apply(c); })
      .catch(() => { if (alive) { setErrStatus('network'); setPhase('error'); } });
    return () => { alive = false; };
  }, [apply, spec, reloadTick]);

  if (phase === 'loading') return <p className="text-[12px] text-[var(--color-text-muted)]">Loading {spec.path}…</p>;
  if (phase === 'error') {
    return (
      <div data-testid={`legacy-${spec.key}`}>
        <h4 className="text-[13px] font-semibold">{spec.title}</h4>
        <p className="text-[12px] text-[var(--color-danger)]">Could not read {spec.path} (status {String(errStatus)}).</p>
        <button type="button" className="appcfg-save" onClick={load}>Reload</button>
      </div>
    );
  }

  const kind = cls.kind;
  const backendLabel = kind === 'workspace' ? 'workspace store' : 'aw-backend document';

  if (kind === 'backend' && spec.key === 'aw') {
    return (
      <section data-testid="legacy-aw" className="mb-6">
        <h4 className="text-[13px] font-semibold">{spec.title}</h4>
        <p className="text-[11px] text-[var(--color-text-muted)]">{spec.path} · answered by the {backendLabel}</p>
        <p className="text-[12px] my-2">
          This host serves the full AW configuration document, which carries credentials and restarts
          services when saved. It is edited in General &gt; AW, not here.
        </p>
        <button type="button" className="appcfg-save" onClick={() => onNavigate('general', 'aw')}>Open General &gt; AW</button>
      </section>
    );
  }

  const parsed = parseDraft(text);
  const guard = parsed.ok ? validateDocument(kind, spec.key, parsed.value) : null;
  const invalid = !parsed.ok ? parsed.error : guard;
  const baseline = loadedSnap === 'unset' ? canonical({}) : loadedSnap;
  const dirty = parsed.ok && canonical(parsed.value) !== baseline;
  const canSave = !saving && !invalid && dirty;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setMessage(null);
    try {
      const current = await readRow(spec);
      if (current.kind === 'error' || snapshotOf(current) !== loadedSnap) {
        setMessage({ ok: false, text: 'The stored document changed since it was loaded. Reload before saving.', stale: true });
        return;
      }
      const res = await apiFetch(spec.path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPutBody(parsed.value)),
      });
      const body = await res.json().catch(() => null);
      if (!putSucceeded(kind, res.ok, body)) {
        setMessage({ ok: false, text: `Save failed (status ${res.status}${kind === 'backend' ? ', no success reported' : ''}).` });
        return;
      }
      apply(await readRow(spec));
      setMessage({ ok: true, text: 'Saved. Showing the stored copy.' });
    } catch {
      setMessage({ ok: false, text: 'Save failed (network error).' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-testid={`legacy-${spec.key}`} className="mb-6">
      <h4 className="text-[13px] font-semibold">{spec.title}</h4>
      <p className="text-[11px] text-[var(--color-text-muted)]">{spec.path} · answered by the {backendLabel}</p>
      <p className="text-[12px] my-1" data-testid={`legacy-${spec.key}-state`}>{describeState(kind, spec.key, cls)}</p>
      {kind === 'workspace' && spec.key === 'mcp' && (
        <p className="text-[11px] text-[var(--color-text-muted)] mb-1">
          This is not the MCP Tools configuration and does not add or remove gateway upstreams.
          {mcpToolsInstalled && (
            <> <button type="button" className="underline" onClick={() => onNavigate('apps', 'mcp-tools')}>Open Settings &gt; Apps &gt; MCP Tools</button></>
          )}
        </p>
      )}
      {kind === 'workspace' && spec.key === 'aw' && (
        <p className="text-[11px] text-[var(--color-text-muted)] mb-1">
          This is not Feed Subscriber configuration: Feed Subscriber cards live in the Feed Subscriber app.
        </p>
      )}
      <label className="mcpgw-editor-label" htmlFor={`legacy-${spec.key}-text`}>Document (JSON)</label>
      <textarea
        id={`legacy-${spec.key}-text`}
        className="mcpgw-json"
        value={text}
        spellCheck="false"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="appcfg-actions">
        {(invalid || message) && (
          <span className={`appcfg-msg ${!invalid && message?.ok ? 'is-ok' : 'is-err'}`} data-testid={`legacy-${spec.key}-msg`}>
            {invalid || message.text}
          </span>
        )}
        {message?.stale && <button type="button" className="appcfg-save" onClick={load}>Reload</button>}
        <button type="button" className="appcfg-save" disabled={!canSave} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}

export default function LegacySettingsTab({ onNavigate }) {
  const [mcpToolsInstalled, setInstalled] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.resolve(listInstalledApps())
      .then((apps) => { if (alive && Array.isArray(apps)) setInstalled(apps.some((a) => a.slug === 'mcp-tools')); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const go = onNavigate || (() => {});
  return (
    <div className="max-w-4xl">
      <h3 className="text-sm font-semibold mb-1">Legacy settings</h3>
      <p className="text-[11px] text-[var(--color-text-muted)] mb-3">
        Two stored legacy settings rows, edited as whole JSON documents. They are not MCP Tools or
        Feed Subscriber configuration, and nothing is copied between them and any app.
      </p>
      <LegacyEditor spec={SPECS.mcp} onNavigate={go} mcpToolsInstalled={mcpToolsInstalled} />
      <LegacyEditor spec={SPECS.aw} onNavigate={go} mcpToolsInstalled={mcpToolsInstalled} />
    </div>
  );
}

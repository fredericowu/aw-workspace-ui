import { useState, useEffect, useRef } from 'react';
import { getAwConfig, saveAwConfig } from '../hooks/useComponentStatus';
import { apiFetch } from '../auth';
import AppearanceTab from './AppearanceTab';
import MetaDisplayGlassesSection from './MetaDisplayTab';
import WhatsAppSection from './WhatsAppTab';

// Textarea for newline-separated arrays. Keeps local text state so Enter
// works naturally; commits to parent only on blur or when the external
// value changes from outside this component.
function ArrayTextarea({ value, onChange, rows = 4, className, placeholder }) {
  const [text, setText] = useState((value || []).join('\n'));
  const externalRef = useRef(value);
  useEffect(() => {
    // Only sync from outside when the parent value actually changed
    if (externalRef.current !== value) {
      externalRef.current = value;
      setText((value || []).join('\n'));
    }
  }, [value]);
  const commit = (raw) => {
    const arr = raw.split('\n').map(s => s.trim()).filter(Boolean);
    externalRef.current = arr;
    onChange(arr);
  };
  return (
    <textarea
      rows={rows}
      value={text}
      placeholder={placeholder}
      className={className}
      onChange={e => setText(e.target.value)}
      onBlur={e => commit(e.target.value)}
    />
  );
}

// ---------------------------------------------------------------------------
// Workspace Agent API helpers
// ---------------------------------------------------------------------------
async function fetchAgentStatus() {
  try {
    const r = await apiFetch('/api/workspace-agent/status');
    return await r.json();
  } catch { return null; }
}
async function fetchAgentSessions() {
  try {
    const r = await apiFetch('/api/workspace-agent/sessions');
    return (await r.json()).sessions || [];
  } catch { return []; }
}
async function deleteAgentSession(source, chatId) {
  return apiFetch(
    `/api/workspace-agent/sessions/${encodeURIComponent(source)}/${encodeURIComponent(chatId)}`,
    { method: 'DELETE' }
  );
}
async function resetAllAgentSessions() {
  return apiFetch('/api/workspace-agent/sessions/reset-all', { method: 'POST' });
}

// Default model lists per CLI — used when aw.json doesn't override them.
// Users can customise these in Settings → Workspace Agent → Model Lists.
const DEFAULT_CLI_MODELS = {
  claude:  ['sonnet', 'opus', 'haiku', 'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],
  gemini:  ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  codex:   ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
  copilot: ['claude-sonnet-4-5', 'gpt-4o', 'o3-mini'],
  cursor:  ['claude-sonnet-4-5', 'gpt-4o', 'o3-mini'],
};
// Keep backward compat alias
const CLAUDE_MODELS = DEFAULT_CLI_MODELS.claude;

const CATEGORIES = ['Tools', 'APIs', 'Platform', 'Apps', 'System'];

// Curated IANA timezone list — the long tail is in /usr/share/zoneinfo, but
// these cover ~99% of users and avoid bundling a 600-entry dropdown. Add
// more here if needed; aw.json accepts any IANA string the host's tzdata
// recognizes (validated container-side by the entrypoint).
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Zurich',
  'Europe/Rome',
  'Europe/Athens',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

// ---------------------------------------------------------------------------
// Reusable input
// ---------------------------------------------------------------------------
function Field({ value, placeholder, type = 'text', onChange, className = '' }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
      className={`bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full ${className}`}
    />
  );
}

// ---------------------------------------------------------------------------
// iPhone-style toggle
// ---------------------------------------------------------------------------
function Toggle({ value, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${value ? 'bg-[var(--color-accent)]' : 'bg-white/10'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper — collapsible
// ---------------------------------------------------------------------------
function Section({ title, description, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4 border border-[var(--color-border)] rounded overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[var(--color-bg-header)] hover:bg-white/5 transition-colors text-left"
      >
        <div>
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
          {description && <span className="text-xs text-[var(--color-text-muted)] ml-3">{description}</span>}
        </div>
        <span className="text-[var(--color-text-muted)] text-xs">{open ? '\u25BC' : '\u25B6'}</span>
      </button>
      {open && <div className="border-t border-[var(--color-border)]">{children}</div>}
    </div>
  );
}

function parseDepends(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  return value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

function dependsToText(value) {
  if (Array.isArray(value)) return value.join(' ');
  if (typeof value === 'string') return value;
  return '';
}

function normalizeDependsForSave(config) {
  const components = {};
  for (const [name, cfg] of Object.entries(config.components || {})) {
    const nextCfg = { ...cfg };
    if (typeof nextCfg.depends === 'string') {
      nextCfg.depends = parseDepends(nextCfg.depends);
    } else if (nextCfg.depends && typeof nextCfg.depends === 'object' && !Array.isArray(nextCfg.depends)) {
      nextCfg.depends = Object.fromEntries(
        Object.entries(nextCfg.depends).map(([mode, value]) => [mode, parseDepends(value)])
      );
    }

    if (nextCfg.modes) {
      nextCfg.modes = Object.fromEntries(
        Object.entries(nextCfg.modes).map(([modeName, modeCfg]) => {
          const nextMode = { ...modeCfg };
          if (typeof nextMode.depends === 'string') {
            nextMode.depends = parseDepends(nextMode.depends);
          }
          return [modeName, nextMode];
        })
      );
    }

    components[name] = nextCfg;
  }
  return { ...config, components };
}

// ---------------------------------------------------------------------------
// Components table (existing logic, refined)
// ---------------------------------------------------------------------------
function ComponentRow({ name, cfg, onChange }) {
  const modes = cfg.modes || {};
  const hasModes = Object.keys(modes).length > 0;
  const [expanded, setExpanded] = useState(false);

  const field = (key, placeholder, type = 'text') => (
    <Field value={cfg[key]} placeholder={placeholder} type={type}
      onChange={(v) => onChange(name, key, v)} />
  );

  const modeField = (modeName, key, placeholder, type = 'text') => (
    <Field value={modes[modeName]?.[key]} placeholder={placeholder} type={type}
      onChange={(v) => onChange(name, `modes.${modeName}.${key}`, v)} />
  );

  // Dependencies are edited as space-separated text and normalized on save.
  const deps = cfg.depends;
  const depsIsDict = deps && typeof deps === 'object' && !Array.isArray(deps);
  const depsStr = dependsToText(deps);

  const handleDepsChange = (value) => {
    onChange(name, 'depends', value || '');
  };

  const handleModeDepsChange = (modeName, value) => {
    onChange(name, `modes.${modeName}.depends`, value || '');
  };

  // For dict depends, handle per-mode
  const handleDictDepsChange = (modeName, value) => {
    const newDeps = { ...(deps || {}), [modeName]: value || '' };
    onChange(name, 'depends', newDeps);
  };

  return (
    <>
      <tr className="border-b border-[var(--color-border)] hover:bg-white/5">
        <td className="px-3 py-2 text-xs font-mono font-semibold text-[var(--color-accent)] whitespace-nowrap">
          {hasModes && (
            <button onClick={() => setExpanded(!expanded)} className="mr-1 text-[var(--color-text-muted)]">
              {expanded ? '\u25BC' : '\u25B6'}
            </button>
          )}
          {name}
        </td>
        <td className="px-2 py-1">{field('description', 'Description')}</td>
        <td className="px-2 py-1">
          <select value={cfg.category || ''} onChange={(e) => onChange(name, 'category', e.target.value)}
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-1 py-1 text-xs text-[var(--color-text-primary)] w-full">
            <option value="">-</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </td>
        {hasModes ? (
          <>
            <td className="px-2 py-1"></td>
            <td className="px-2 py-1"></td>
            <td className="px-2 py-1"></td>
            <td className="px-2 py-1"></td>
          </>
        ) : (
          <>
            <td className="px-2 py-1">{field('default_port', 'port')}</td>
            <td className="px-2 py-1">{field('debugpy_port', 'dbg', 'number')}</td>
            <td className="px-2 py-1">{field('venv', 'venv')}</td>
            <td className="px-2 py-1">{field('python', 'py')}</td>
          </>
        )}
        <td className="px-2 py-1">{field('log_ready_pattern', 'pattern')}</td>
        <td className="px-2 py-1">
          {!hasModes && !depsIsDict && (
            <Field value={depsStr} placeholder="depends"
              onChange={handleDepsChange} />
          )}
        </td>
        <td className="px-2 py-1 text-center">
          <Toggle value={!!cfg.auto_start} onChange={(v) => onChange(name, 'auto_start', v)} />
        </td>
      </tr>
      {hasModes && expanded && Object.entries(modes).map(([modeName]) => {
        // Mode-level depends: either from modes.X.depends or from parent depends dict
        const modeDeps = modes[modeName]?.depends;
        const dictDeps = depsIsDict ? (deps[modeName] || []) : null;
        const modeDepStr = dependsToText(modeDeps) || dependsToText(dictDeps);
        const onDepChange = depsIsDict
          ? (v) => handleDictDepsChange(modeName, v)
          : (v) => handleModeDepsChange(modeName, v);

        return (
          <tr key={`${name}:${modeName}`} className="border-b border-[var(--color-border)] bg-white/[0.02]">
            <td className="px-3 py-1 text-xs font-mono text-[var(--color-text-muted)] pl-8">:{modeName}</td>
            <td className="px-2 py-1">{modeField(modeName, 'description', 'Description')}</td>
            <td className="px-2 py-1"></td>
            <td className="px-2 py-1">{modeField(modeName, 'default_port', 'port')}</td>
            <td className="px-2 py-1">{modeField(modeName, 'debugpy_port', 'dbg', 'number')}</td>
            <td className="px-2 py-1">{modeField(modeName, 'venv', 'venv')}</td>
            <td className="px-2 py-1">{modeField(modeName, 'python', 'py')}</td>
            <td className="px-2 py-1"></td>
            <td className="px-2 py-1">
              <Field value={modeDepStr} placeholder="depends" onChange={onDepChange} />
            </td>
            <td className="px-2 py-1"></td>
          </tr>
        );
      })}
    </>
  );
}

function ResizableHeader({ children }) {
  return (
    <th className="px-2 py-2 font-medium relative group" style={{ overflow: 'hidden' }}>
      {children}
      <div
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize bg-transparent hover:bg-[var(--color-accent)]/50"
        onMouseDown={(e) => {
          e.preventDefault();
          const th = e.target.parentElement;
          const table = th.closest('table');
          const idx = Array.from(th.parentElement.children).indexOf(th);
          const col = table.querySelector('colgroup').children[idx];
          const startX = e.clientX;
          const startW = th.offsetWidth;
          const onMove = (ev) => { col.style.width = Math.max(30, startW + ev.clientX - startX) + 'px'; };
          const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
      />
    </th>
  );
}

function ComponentsSection({ components, onChange }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 145 }} />
          <col style={{ width: 180 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 52 }} />
          <col />
          <col />
          <col style={{ width: 52 }} />
        </colgroup>
        <thead>
          <tr className="bg-[var(--color-bg-header)] text-[var(--color-text-muted)] text-left">
            <ResizableHeader>Component</ResizableHeader>
            <ResizableHeader>Description</ResizableHeader>
            <ResizableHeader>Category</ResizableHeader>
            <ResizableHeader>Port</ResizableHeader>
            <ResizableHeader>Debugpy</ResizableHeader>
            <ResizableHeader>Venv</ResizableHeader>
            <ResizableHeader>Python</ResizableHeader>
            <ResizableHeader>Log Pattern</ResizableHeader>
            <ResizableHeader>Dependencies</ResizableHeader>
            <ResizableHeader>Auto</ResizableHeader>
          </tr>
        </thead>
        <tbody>
          {Object.entries(components).map(([name, cfg]) => (
            <ComponentRow key={name} name={name} cfg={cfg} onChange={onChange} />
          ))}
        </tbody>
      </table>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Knowledge Base section
// ---------------------------------------------------------------------------
function KnowledgeBaseSection({ mapPaths = [], onChange }) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const p = input.trim();
    if (!p || mapPaths.includes(p)) return;
    onChange([...mapPaths, p]);
    setInput('');
  };

  const handleRemove = (path) => onChange(mapPaths.filter((p) => p !== path));

  return (
    <div className="p-4 space-y-3">
      <div className="space-y-1">
        {mapPaths.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)] italic">No paths configured.</p>
        )}
        {mapPaths.map((p) => (
          <div key={p} className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text-primary)] font-mono truncate">
              {p}
            </code>
            <button
              onClick={() => handleRemove(p)}
              className="px-2 py-1 text-xs text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 rounded transition-colors"
              title="Remove path"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          placeholder='Path to map (e.g. "." or "/some/repo")'
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="flex-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)]"
        />
        <button
          onClick={handleAdd}
          className="px-3 py-1 text-xs rounded bg-[var(--color-bg-header)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-white/10 transition-colors"
        >
          Add path
        </button>
      </div>
      <p className="text-[10px] text-[var(--color-text-muted)]">
        Paths are used by the Knowledge Base build manager (KB panel → Manage) to extract code structure
        and index it into pgvector. Use <code>.</code> for the workspace root.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// General section — top-level string/number fields
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Docker services
// ---------------------------------------------------------------------------
const DOCKER_FIELDS = [
  { key: 'name',        label: 'Name',        placeholder: 'redis',            span: 1 },
  { key: 'image',       label: 'Image',       placeholder: 'redis:7-alpine',   span: 2 },
  { key: 'description', label: 'Description', placeholder: 'Redis cache',      span: 3 },
  { key: 'port',        label: 'Port',        placeholder: '6379',             span: 1 },
];

function DockerServiceRow({ svc, index, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(false);

  const updateField = (key, val) => onChange(index, { ...svc, [key]: val });

  const updateArrayField = (key, raw) => {
    const arr = raw.split('\n').map(s => s.trim()).filter(Boolean);
    onChange(index, { ...svc, [key]: arr });
  };

  const updateEnvField = (raw) => {
    const env = {};
    raw.split('\n').forEach(line => {
      const [k, ...rest] = line.split('=');
      if (k.trim()) env[k.trim()] = rest.join('=').trim();
    });
    onChange(index, { ...svc, environment: env });
  };

  return (
    <div className="border-b border-[var(--color-border)] last:border-b-0">
      <div className="flex items-center gap-2 px-4 py-2">
        <button onClick={() => setExpanded(!expanded)} className="text-[var(--color-text-muted)] text-xs w-4 shrink-0">
          {expanded ? '▼' : '▶'}
        </button>
        <span className="text-xs font-mono text-[var(--color-text-primary)] w-24 shrink-0">{svc.name || '(unnamed)'}</span>
        <span className="text-xs text-[var(--color-text-muted)] flex-1 truncate">{svc.image}</span>
        <span className="text-xs text-[var(--color-text-muted)]">:{svc.port}</span>
        <button
          onClick={() => updateField('menu_display', svc.menu_display === false ? undefined : false)}
          title={svc.menu_display === false ? 'Hidden from sidebar — click to show' : 'Visible in sidebar — click to hide'}
          className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer shrink-0 ${
            svc.menu_display === false
              ? 'bg-white/10 text-[var(--color-text-muted)] hover:bg-white/20'
              : 'bg-white/5 text-[var(--color-text-muted)] hover:bg-white/10'
          }`}
        >
          {svc.menu_display === false ? 'hidden' : 'visible'}
        </button>
        <button onClick={() => onRemove(index)}
          className="ml-1 text-[var(--color-danger)] text-xs opacity-0 group-hover:opacity-100 hover:opacity-100 cursor-pointer px-1">✕</button>
      </div>
      {expanded && (
        <div className="px-4 pb-3 grid grid-cols-3 gap-2">
          {DOCKER_FIELDS.map(f => (
            <div key={f.key} className={`col-span-${f.span}`}>
              <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">{f.label}</label>
              <Field value={svc[f.key]} placeholder={f.placeholder} onChange={v => updateField(f.key, v)} />
            </div>
          ))}
          <div className="col-span-1">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Restart</label>
            <select value={svc.restart || ''} onChange={e => updateField('restart', e.target.value || undefined)}
              className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full">
              <option value="">none</option>
              <option value="unless-stopped">unless-stopped</option>
              <option value="always">always</option>
              <option value="on-failure">on-failure</option>
            </select>
          </div>
          <div className="col-span-1">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">SHM Size</label>
            <Field value={svc.shm_size} placeholder="4g" onChange={v => updateField('shm_size', v || undefined)} />
          </div>
          <div className="col-span-1">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">CPUs</label>
            <Field value={svc.cpus} placeholder="4" type="number" onChange={v => updateField('cpus', v || undefined)} />
          </div>
          <div className="col-span-3">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Ports (one per line: 127.0.0.1:6379:6379)</label>
            <ArrayTextarea rows={2} value={svc.ports || []} onChange={arr => onChange(index, { ...svc, ports: arr })}
              className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full font-mono resize-none" />
          </div>
          <div className="col-span-3">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Volumes (one per line: redis_data:/data)</label>
            <ArrayTextarea rows={4} value={svc.volumes || []} onChange={arr => onChange(index, { ...svc, volumes: arr })}
              className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full font-mono resize-y" />
          </div>
          <div className="col-span-3">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Environment (KEY=VALUE, one per line)</label>
            <textarea rows={3} value={Object.entries(svc.environment || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
              onChange={e => updateEnvField(e.target.value)}
              className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full font-mono resize-none" />
          </div>
          <div className="col-span-3">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Entrypoint</label>
            <Field value={svc.entrypoint} placeholder="/opt/entrypoint.sh" onChange={v => updateField('entrypoint', v || undefined)} />
          </div>
          <div className="col-span-3">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Args after image (one per line, e.g. <span className="font-mono">--auth</span> then <span className="font-mono">none</span>)</label>
            <ArrayTextarea rows={2} value={svc.args || []} onChange={arr => onChange(index, { ...svc, args: arr })}
              className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full font-mono resize-none" />
          </div>
          <div className="col-span-1">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">User (--user)</label>
            <Field value={svc.user} placeholder="1000:1000" onChange={v => updateField('user', v || undefined)} />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Group add (one per line, e.g. 0 for docker.sock)</label>
            <textarea rows={1} value={(svc.group_add || []).join('\n')} onChange={e => updateArrayField('group_add', e.target.value)}
              className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full font-mono resize-none" />
          </div>
          <div className="col-span-3">
            <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">
              Dependencies <span className="font-normal">(space-separated: proxy docker:aw-redis)</span>
            </label>
            <Field
              value={Array.isArray(svc.depends) ? svc.depends.join(' ') : (svc.depends || '')}
              placeholder="proxy docker:aw-postgres"
              onChange={v => updateField('depends', v ? v.split(/\s+/).filter(Boolean) : [])}
            />
          </div>
          <div className="col-span-3 flex items-center gap-2 pt-1">
            <Toggle value={!!svc.auto_start} onChange={v => updateField('auto_start', v)} />
            <span className="text-xs text-[var(--color-text-primary)]">Auto-start with awserv</span>
            <span className="text-[10px] text-[var(--color-text-muted)]">Start this container automatically when <code>./aw start awserv</code> runs</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DockerServicesSection({ services = [], onChange }) {
  const handleChange = (index, updated) => {
    const next = [...services];
    next[index] = updated;
    onChange(next);
  };
  const handleRemove = (index) => onChange(services.filter((_, i) => i !== index));
  const handleAdd = () => onChange([...services, { name: '', image: '', port: '', ports: [], volumes: [], args: [] }]);

  return (
    <div>
      <div className="divide-y divide-[var(--color-border)]">
        {services.map((svc, i) => (
          <div key={i} className="group">
            <DockerServiceRow svc={svc} index={i} onChange={handleChange} onRemove={handleRemove} />
          </div>
        ))}
      </div>
      <div className="px-4 py-2">
        <button onClick={handleAdd}
          className="text-xs text-[var(--color-accent)] hover:underline cursor-pointer">+ Add service</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LLM Proxy panel — API key and status.
function LlmProxySection({ config = {}, onChange }) {
  const update = (key, value) => onChange({ ...config, [key]: value });
  const apiKey = config.api_key || '';
  const enabled = config.enabled !== false;
  const externalBase = 'https://dev.tekflox.com';

  return (
    <div className="p-4 space-y-5">
      <div className="text-xs font-semibold text-[var(--color-text-primary)]">LLM Proxy</div>
      <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
        OpenAI-compatible proxy over AW CLI runners. Base URL:&nbsp;
        <code className="font-mono bg-[var(--color-bg-secondary)] px-1 rounded">{externalBase}/v1</code>
      </p>

      <div className="flex items-center gap-3">
        <span className="text-xs text-[var(--color-text-muted)] w-20">Enabled</span>
        <button
          onClick={() => update('enabled', !enabled)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-[var(--color-text-muted)]">API Key (Bearer token)</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={apiKey}
            onChange={e => update('api_key', e.target.value)}
            className="flex-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs font-mono text-[var(--color-text-primary)]"
            placeholder="aw-llm-..."
          />
          <button
            onClick={() => {
              const chars = 'abcdef0123456789';
              const rand = Array.from({length: 48}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
              update('api_key', 'aw-llm-' + rand);
            }}
            className="px-2 py-1 text-xs rounded bg-[var(--color-bg-header)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title="Generate new key"
          >↺</button>
        </div>
      </div>

      <div className="space-y-1 text-[11px] text-[var(--color-text-muted)]">
        <div className="font-medium text-xs text-[var(--color-text-primary)]">Endpoints</div>
        {[
          ['GET', '/v1/models'],
          ['POST', '/v1/sessions'],
          ['GET', '/v1/sessions'],
          ['DELETE', '/v1/sessions/{id}'],
          ['POST', '/v1/chat/completions'],
        ].map(([method, path]) => (
          <div key={path} className="flex gap-2 font-mono">
            <span className="w-12 text-right opacity-60">{method}</span>
            <span>{externalBase}{path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice & STT subsection — provider toggles, OpenAI key, voice picker.
//
// The dispatcher picks the actual TTS voice at reply time from
// ``edge_voices[<lang>]`` based on the Whisper-detected language of the
// inbound speech (or langdetect on the LLM's reply text). This UI lets
// the user override the per-language voice map and toggle providers.
// ---------------------------------------------------------------------------

const OPENAI_VOICE_OPTIONS = [
  { id: 'alloy',   label: 'Alloy',   desc: 'Neutral, balanced' },
  { id: 'echo',    label: 'Echo',    desc: 'Male, calm' },
  { id: 'fable',   label: 'Fable',   desc: 'British, warm' },
  { id: 'onyx',    label: 'Onyx',    desc: 'Deep, authoritative' },
  { id: 'nova',    label: 'Nova',    desc: 'Female, energetic' },
  { id: 'shimmer', label: 'Shimmer', desc: 'Female, soft' },
];

// Curated Edge Neural voice list per priority language. The user's
// configured map (``aw.json → workspace_agent.edge_voices``) is the
// source of truth at runtime; this is just what the dropdown offers.
// Names follow Microsoft's catalogue (verify with ``edge-tts --list-voices``).
const EDGE_VOICES_BY_LANG = {
  pt: [
    { id: 'pt-BR-AntonioNeural',  label: 'Antônio (BR, male)' },
    { id: 'pt-BR-FranciscaNeural', label: 'Francisca (BR, female)' },
    { id: 'pt-BR-ThalitaNeural',   label: 'Thalita (BR, female)' },
    { id: 'pt-PT-DuarteNeural',    label: 'Duarte (PT, male)' },
    { id: 'pt-PT-RaquelNeural',    label: 'Raquel (PT, female)' },
  ],
  en: [
    { id: 'en-US-AndrewMultilingualNeural', label: 'Andrew (US, multilingual)' },
    { id: 'en-US-AriaNeural',               label: 'Aria (US, female)' },
    { id: 'en-US-GuyNeural',                label: 'Guy (US, male)' },
    { id: 'en-GB-RyanNeural',               label: 'Ryan (UK, male)' },
    { id: 'en-GB-SoniaNeural',              label: 'Sonia (UK, female)' },
  ],
  es: [
    { id: 'es-MX-JorgeNeural',  label: 'Jorge (MX, male)' },
    { id: 'es-MX-DaliaNeural',  label: 'Dalia (MX, female)' },
    { id: 'es-ES-AlvaroNeural', label: 'Álvaro (ES, male)' },
    { id: 'es-ES-ElviraNeural', label: 'Elvira (ES, female)' },
  ],
  it: [
    { id: 'it-IT-DiegoNeural',    label: 'Diego (male)' },
    { id: 'it-IT-ElsaNeural',     label: 'Elsa (female)' },
    { id: 'it-IT-IsabellaNeural', label: 'Isabella (female)' },
  ],
  fr: [
    { id: 'fr-FR-HenriNeural',   label: 'Henri (male)' },
    { id: 'fr-FR-DeniseNeural',  label: 'Denise (female)' },
  ],
  de: [
    { id: 'de-DE-ConradNeural', label: 'Conrad (male)' },
    { id: 'de-DE-KatjaNeural',  label: 'Katja (female)' },
  ],
};

const EDGE_LANG_LABELS = {
  pt: 'Portuguese',
  en: 'English',
  es: 'Spanish',
  it: 'Italian',
  fr: 'French',
  de: 'German',
};

async function previewVoice(voiceId, text) {
  const params = new URLSearchParams({ voice: voiceId, text });
  try {
    const audio = new Audio(`/api/workspace-agent/tts-preview?${params}`);
    await audio.play();
  } catch (err) {
    console.error('preview failed', err);
  }
}

function VoiceAndSttSection({ agentConfig, update, status }) {
  const ttsProvider = agentConfig.tts_provider || 'openai';
  // STT canonical values are 'openai' (Whisper API) and 'local' (faster-whisper).
  // Normalise the legacy 'edge'/'faster-whisper' aliases so the right button
  // lights up even on configs written before the stt.py refactor.
  const sttRaw = agentConfig.stt_provider || 'openai';
  const sttProvider = (sttRaw === 'edge' || sttRaw === 'faster-whisper') ? 'local' : sttRaw;
  const edgeVoices = agentConfig.edge_voices || {};

  const updateEdgeVoice = (lang, voiceId) => {
    update('edge_voices', { ...edgeVoices, [lang]: voiceId });
  };

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-[var(--color-text-primary)]">Voice & STT</div>

      {/* Provider toggles */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[var(--color-text-muted)] block mb-1">STT provider</label>
          <div className="flex gap-1">
            {[
              { id: 'openai', label: 'Whisper API', desc: 'OpenAI Whisper (cloud)' },
              { id: 'local',  label: 'faster-whisper', desc: 'Local Whisper (offline, tiny model)' },
            ].map(({ id, label, desc }) => {
              const active = sttProvider === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => update('stt_provider', id)}
                  title={desc}
                  className={`flex-1 px-2 py-1.5 rounded border text-xs transition-colors ${
                    active
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs text-[var(--color-text-muted)] block mb-1">TTS provider</label>
          <div className="flex gap-1">
            {[
              { id: 'openai', label: 'OpenAI', desc: 'tts-1 (cloud, multilingual)' },
              { id: 'edge',   label: 'Edge',   desc: 'Microsoft Edge Neural (per-language)' },
            ].map(({ id, label, desc }) => {
              const active = ttsProvider === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => update('tts_provider', id)}
                  title={desc}
                  className={`flex-1 px-2 py-1.5 rounded border text-xs transition-colors ${
                    active
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* OpenAI key — needed when either provider is openai */}
      {(sttProvider === 'openai' || ttsProvider === 'openai') && (
        <div>
          <label className="text-xs text-[var(--color-text-muted)] block mb-1">
            OpenAI API key <span className="font-normal">(shared by Whisper STT and TTS)</span>
          </label>
          <input
            type="password"
            value={agentConfig.openai_api_key || ''}
            placeholder="sk-..."
            onChange={(e) => update('openai_api_key', e.target.value)}
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full font-mono"
          />
          <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
            {status && (
              <span className={status.openai_key_configured ? 'text-green-400' : 'text-yellow-400'}>
                {status.openai_key_configured ? '✓ key detected' : '⚠ no key — voice off when provider=OpenAI'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Voice picker — provider-specific */}
      {ttsProvider === 'openai' ? (
        <div>
          <label className="text-xs text-[var(--color-text-muted)] block mb-2">
            TTS voice <span className="font-normal">(default voice for all bot replies)</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {OPENAI_VOICE_OPTIONS.map(({ id, label, desc }) => {
              const active = (agentConfig.tts_voice || 'alloy') === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => update('tts_voice', id)}
                  className={`px-3 py-2 rounded border text-left transition-colors ${
                    active
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)]/50'
                  }`}
                >
                  <div className="text-xs font-semibold">{label}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] mb-1">
              Edge voices per language
              <span className="font-normal">
                {' '}— dispatcher picks the matching voice from Whisper / langdetect on the LLM reply.
              </span>
            </div>
            <div className="space-y-1.5">
              {Object.keys(EDGE_VOICES_BY_LANG).map((lang) => {
                const options = EDGE_VOICES_BY_LANG[lang];
                const current =
                  edgeVoices[lang]
                  || (lang === 'pt' ? agentConfig.edge_voice || 'pt-BR-AntonioNeural' : options[0]?.id);
                return (
                  <div key={lang} className="grid grid-cols-[110px_1fr_70px] gap-2 items-center">
                    <span className="text-xs text-[var(--color-text-primary)]">
                      {EDGE_LANG_LABELS[lang]} <span className="text-[10px] text-[var(--color-text-muted)]">({lang})</span>
                    </span>
                    <select
                      value={current}
                      onChange={(e) => updateEdgeVoice(lang, e.target.value)}
                      className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)]"
                    >
                      {options.map(({ id, label }) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => previewVoice(current, _previewPhrase(lang))}
                      className="px-2 py-1 rounded border border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/50"
                    >
                      ▶ Preview
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] block mb-1">
              Default voice <span className="font-normal">(used when the detected language has no entry above)</span>
            </label>
            <select
              value={edgeVoices._default || agentConfig.edge_voice || 'pt-BR-AntonioNeural'}
              onChange={(e) => updateEdgeVoice('_default', e.target.value)}
              className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full"
            >
              {Object.values(EDGE_VOICES_BY_LANG).flat().map(({ id, label }) => (
                <option key={id} value={id}>{label} — {id}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

// Short demo phrases per language for the "Preview" button.
function _previewPhrase(lang) {
  return ({
    pt: 'Olá! Esta é uma amostra de voz.',
    en: 'Hi! This is a voice sample.',
    es: 'Hola! Esta es una muestra de voz.',
    it: 'Ciao! Questo è un campione vocale.',
    fr: 'Bonjour! Ceci est un échantillon vocal.',
    de: 'Hallo! Dies ist eine Sprachprobe.',
  })[lang] || 'Hello!';
}


// ---------------------------------------------------------------------------
// Workspace Agent panel — multi-bot Telegram config.
//
// Replaces the old single-bot inline section. Layout:
//   1. Voice & STT — global TTS voice, OpenAI key, timeout
//   2. System bot picker — which bot delivers human-in-the-loop prompts
//   3. Telegram bots — list of cards, one per bot, fully independent admins
//      and users, per-bot allowed CLIs and Flowise flows, per-bot defaults
//   4. Active sessions — global list (kept from the old UI)
// ---------------------------------------------------------------------------
function WorkspaceAgentSection({ agentConfig = {}, aiAgents = [], onChange }) {
  const [sessions, setSessions] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setSessions(await fetchAgentSessions());
    setStatus(await fetchAgentStatus());
  };
  useEffect(() => { refresh(); }, []);

  const update = (key, value) => onChange({ ...agentConfig, [key]: value });

  const cliModelsConfig = agentConfig.cli_models || {};
  const updateCliModels = (cliKey, rawValue) => {
    const list = rawValue.split(',').map((s) => s.trim()).filter(Boolean);
    onChange({ ...agentConfig, cli_models: { ...cliModelsConfig, [cliKey]: list } });
  };

  const handleResetAll = async () => {
    if (!confirm(`Reset all ${sessions.length} agent session(s)? Each chat will start fresh on the next message.`)) return;
    setBusy(true);
    try { await resetAllAgentSessions(); await refresh(); }
    finally { setBusy(false); }
  };

  const handleResetOne = async (s) => {
    setBusy(true);
    try { await deleteAgentSession(s.source, s.source_chat_id); await refresh(); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 space-y-5">
      {/* ── 1. Voice & STT (global) ──────────────────────────────────── */}
      <VoiceAndSttSection
        agentConfig={agentConfig}
        update={update}
        status={status}
      />


      {/* ── 2. Model lists (global — used by /agent picker on every bot) ── */}
      <div className="pt-3 border-t border-[var(--color-border)]">
        <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-2">
          Model lists <span className="font-normal text-[var(--color-text-muted)]">(shown in /agent — comma-separated)</span>
        </div>
        <div className="space-y-2">
          {Object.keys(DEFAULT_CLI_MODELS).map((cliKey, idx) => (
            <div key={cliKey} className="grid grid-cols-[90px_1fr] gap-2 items-center">
              <span className="text-xs text-[var(--color-text-primary)] font-medium">
                {idx + 1}. {cliKey.charAt(0).toUpperCase() + cliKey.slice(1)}
              </span>
              <input
                type="text"
                value={(cliModelsConfig[cliKey] || DEFAULT_CLI_MODELS[cliKey] || []).join(', ')}
                onChange={(e) => updateCliModels(cliKey, e.target.value)}
                className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-[10px] text-[var(--color-text-primary)] font-mono w-full"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── 2b. Agents Platform — default target ─────────────────────── */}
      <div className="pt-3 border-t border-[var(--color-border)]">
        <label className="text-xs font-semibold text-[var(--color-text-primary)] block mb-1">
          Agents Platform — default target{' '}
          <span className="font-normal text-[var(--color-text-muted)]">(slug used for agent picker runs)</span>
        </label>
        <input
          type="text"
          value={agentConfig.agents_platform_target ?? 'adhoc'}
          onChange={(e) => update('agents_platform_target', e.target.value.trim() || 'adhoc')}
          placeholder="adhoc"
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-[10px] text-[var(--color-text-primary)] font-mono w-full"
        />
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
          Must match an existing target slug in agents-platform. Default: <code>adhoc</code>.
        </div>
      </div>

      {/* ── 2c. Auto-compact threshold (meta/glasses claude sessions) ── */}
      <div className="pt-3 border-t border-[var(--color-border)]">
        <label className="text-xs font-semibold text-[var(--color-text-primary)] block mb-1">
          Auto-compact threshold{' '}
          <span className="font-normal text-[var(--color-text-muted)]">(tokens — meta/glasses Claude sessions)</span>
        </label>
        <input
          type="number"
          min="0"
          step="50000"
          value={agentConfig.auto_compact_threshold_tokens ?? 500000}
          onChange={(e) => update('auto_compact_threshold_tokens',
                                  Math.max(0, parseInt(e.target.value, 10) || 0))}
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-[10px] text-[var(--color-text-primary)] font-mono w-full"
        />
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
          Runs a bare <code>/compact</code> before the next turn once the session context
          exceeds this size. <code>0</code> disables. Telegram bots use the equivalent
          setting in Agents Platform → Settings → General.
        </div>
      </div>

      {/* ── 3. Meta Display Glasses ──────────────────────────────────── */}
      <div className="pt-3 border-t border-[var(--color-border)]">
        <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-3">Meta Display Glasses</div>
        <MetaDisplayGlassesSection />
      </div>

      {/* ── 3b. WhatsApp ──────────────────────────────────────────────── */}
      <div className="pt-3 border-t border-[var(--color-border)]">
        <div className="text-xs font-semibold text-[var(--color-text-primary)] mb-3">WhatsApp</div>
        <WhatsAppSection agentConfig={agentConfig} onChange={update} />
      </div>

      {/* ── 6. Active sessions (kept from the old UI) ─────────────────── */}
      <div className="pt-3 border-t border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">
            Active sessions ({sessions.length})
          </span>
          <div className="flex gap-2">
            <button
              onClick={refresh}
              disabled={busy}
              className="text-xs px-2 py-1 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)] disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              onClick={handleResetAll}
              disabled={busy || sessions.length === 0}
              className="text-xs px-2 py-1 rounded border border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
            >
              Reset all
            </button>
          </div>
        </div>
        {sessions.length === 0 ? (
          <p className="text-xs text-[var(--color-text-muted)] italic">
            No active conversations.
          </p>
        ) : (
          <div className="space-y-1">
            {sessions.map((s) => {
              return (
                <div key={`${s.source}:${s.source_chat_id}`}
                     className="flex items-center gap-2 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1">
                  <span className="text-[var(--color-text-muted)] uppercase font-mono text-[10px] w-16 shrink-0">
                    {s.source}
                  </span>
                  <span className="text-[var(--color-text-primary)] w-36 shrink-0 truncate"
                        title={`${s.source}:${s.source_chat_id}`}>
                    {s.display_name || s.source_chat_id}
                  </span>
                  <span className="text-[var(--color-text-muted)] font-mono text-[10px] truncate w-24" title={s.source_chat_id}>
                    {s.source_chat_id}
                  </span>
                  <span className="text-[var(--color-text-muted)] ml-2">
                    {s.cli_type} · {s.model}
                  </span>
                  <span className="text-[var(--color-text-muted)] ml-auto">
                    {s.message_count} msg
                  </span>
                  <button
                    onClick={() => handleResetOne(s)}
                    disabled={busy}
                    className="text-[var(--color-danger)] hover:opacity-80 px-1 cursor-pointer"
                    title="Reset this conversation"
                  >✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


function GeneralSection({ config, onChange }) {
  return (
    <div className="p-4 grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs text-[var(--color-text-muted)] block mb-1">Timezone</label>
        <select
          value={config.timezone || 'America/New_York'}
          onChange={(e) => onChange('timezone', e.target.value)}
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full"
        >
          {(TIMEZONES.includes(config.timezone) || !config.timezone
            ? TIMEZONES
            : [config.timezone, ...TIMEZONES]
          ).map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
          Applied to aw-sandbox on save (sets <code>/etc/timezone</code>) and persists across container restarts.
        </div>
      </div>
      <div>
        <label className="text-xs text-[var(--color-text-muted)] block mb-1">Tail Logs (lines)</label>
        <select
          value={config.log_tail_lines ?? 1000}
          onChange={(e) => onChange('log_tail_lines', Number(e.target.value))}
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full"
        >
          <option value={500}>500</option>
          <option value={1000}>1,000</option>
          <option value={2000}>2,000</option>
          <option value={5000}>5,000</option>
          <option value={10000}>10,000</option>
        </select>
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">Max lines kept in service log windows</div>
      </div>
      <div className="flex items-center gap-2 col-span-2">
        <button
          onClick={() => onChange('show_claude_prompts', config.show_claude_prompts === false ? true : false)}
          className={`relative w-9 h-5 rounded-full transition-colors ${config.show_claude_prompts === false ? 'bg-white/10' : 'bg-[var(--color-accent)]'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${config.show_claude_prompts === false ? '' : 'translate-x-4'}`} />
        </button>
        <label className="text-xs text-[var(--color-text-primary)]">Show Claude prompt notifications</label>
        <span className="text-[10px] text-[var(--color-text-muted)]">Floating balloons for permission prompts (Yes/No/...)</span>
      </div>

      {/* App Builder — single command template used when the user clicks
          "Start building" in the Apps popover. The default invokes the
          claude CLI with the /aw-app-builder skill prefilled. Edit this
          to point at a different CLI (codex/copilot/etc.) or to change
          the bootstrap prompt. */}
      <div className="col-span-2 border-t border-[var(--color-border)] pt-3 mt-1">
        <label className="text-xs text-[var(--color-text-muted)] block mb-1">
          App Builder · Start command
        </label>
        <Field
          value={config.app_builder?.command_template || ''}
          placeholder='claude --session-id {session_id} --name "{name}" --dangerously-skip-permissions "/aw-app-builder ..."'
          onChange={(v) => onChange('app_builder', { ...(config.app_builder || {}), command_template: v })}
        />
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
          Spawned in a new terminal when you click <em>Apps → Start building</em>. The default uses the
          <code className="mx-1">/aw-app-builder</code> skill via claude. Placeholders:
          <code className="mx-1">{'{session_id}'}</code> is replaced with a fresh UUID (so claude's
          conversation is immediately resumable) and
          <code className="mx-1">{'{name}'}</code> with <em>App Builder - N</em> (next free integer
          across live + past sessions, no duplicates).
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace Apps — dynamic panels shown in the Workspace nav popover.
// Schema: { id, label, url, component, menu, icon }
//   id        — window key prefix: app:{id}
//   label     — display name in nav + window title bar
//   url       — target URL (http://localhost:PORT or /app-proxy/…)
//   component — optional docker service key (docker:name) to auto-start
//   menu      — "apps" (default — Apps popover), "workspace" (Workspace popover),
//               or "top" (legacy top-bar button)
//   icon      — named icon key (e.g. "bolt") OR custom URL / path to an image
// ---------------------------------------------------------------------------
const EMPTY_APP = { id: '', label: '', url: '', component: '', menu: 'apps', icon: '', auth_required: true, public: false };

// Named icon set — kept in sync with WorkspaceNav.jsx WORKSPACE_APP_ICONS
// and app_proxy.py _ICON_SVGS (splash page).
const NAMED_ICONS_PICKER = [
  { key: 'bolt',     label: 'Bolt',     svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg> },
  { key: 'globe',    label: 'Globe',    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> },
  { key: 'code',     label: 'Code',     svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> },
  { key: 'terminal', label: 'Terminal', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg> },
  { key: 'database', label: 'Database', svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg> },
  { key: 'git',      label: 'Git',      svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></svg> },
  { key: 'cloud',    label: 'Cloud',    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg> },
  { key: 'shield',   label: 'Shield',   svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
  { key: 'mail',     label: 'Mail',     svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
  { key: 'star',     label: 'Star',     svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> },
  { key: 'box',      label: 'Box',      svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> },
  { key: 'monitor',  label: 'Monitor',  svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> },
];

const NAMED_ICON_KEYS = new Set(NAMED_ICONS_PICKER.map(i => i.key));

/**
 * Icon picker: a grid of named icon buttons + a text input for custom URL/path.
 * value is either a named key (e.g. "bolt") or a URL/path string or empty.
 */
function IconPicker({ value, onChange }) {
  const isNamed = NAMED_ICON_KEYS.has(value);
  const urlValue = isNamed ? '' : (value || '');

  return (
    <div className="space-y-1.5">
      {/* Named icon grid */}
      <div className="flex flex-wrap gap-1">
        {NAMED_ICONS_PICKER.map(({ key, label, svg }) => (
          <button
            key={key}
            type="button"
            title={label}
            onClick={() => onChange(value === key ? '' : key)}
            className={`w-6 h-6 flex items-center justify-center rounded border transition-colors [&>svg]:w-3.5 [&>svg]:h-3.5 ${
              value === key
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/60 hover:text-[var(--color-text-primary)]'
            }`}
          >
            {svg}
          </button>
        ))}
      </div>
      {/* Custom URL / path */}
      <input
        type="text"
        value={urlValue}
        placeholder="or custom URL / path  (e.g. https://… or /static/icon.svg)"
        onChange={(e) => onChange(e.target.value)}
        className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full placeholder:text-[var(--color-text-muted)]"
      />
      {/* Live preview */}
      {value && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--color-text-muted)]">Preview:</span>
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
            {isNamed ? (
              <span className="w-3.5 h-3.5 text-[var(--color-text-muted)] [&>svg]:w-3.5 [&>svg]:h-3.5">
                {NAMED_ICONS_PICKER.find(i => i.key === value)?.svg}
              </span>
            ) : (
              <img src={value} alt="" className="w-3.5 h-3.5 object-contain rounded-sm" style={{ opacity: 0.8 }} />
            )}
            <span className="text-[10px] text-[var(--color-text-muted)]">{value}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function WorkspaceAppsSection({ apps = [], onChange }) {
  const [openSet, setOpenSet] = useState(new Set());
  const toggle = (i) => setOpenSet(prev => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  const add = () => {
    const idx = apps.length;
    onChange([...apps, { ...EMPTY_APP }]);
    setOpenSet(prev => new Set([...prev, idx]));
  };
  const remove = (i) => {
    onChange(apps.filter((_, idx) => idx !== i));
    setOpenSet(prev => { const next = new Set(prev); next.delete(i); return next; });
  };
  const update = (i, key, value) => {
    const next = apps.map((a, idx) => idx === i ? { ...a, [key]: value } : a);
    onChange(next);
  };

  const fieldClass = 'bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full';

  return (
    <div className="p-4 space-y-2">
      {apps.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)] italic">No workspace apps configured.</p>
      )}
      {apps.map((app, i) => (
        <div key={i} className="border border-[var(--color-border)] rounded overflow-hidden">
          <div
            className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[var(--color-bg-secondary)] select-none"
            onClick={() => toggle(i)}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[var(--color-text-muted)] text-[10px]">{openSet.has(i) ? '▼' : '▶'}</span>
              <span className={`text-xs font-semibold truncate ${app.enabled === false ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text-primary)]'}`}>{app.label || `App ${i + 1}`}</span>
              {app.id && <span className="text-[10px] text-[var(--color-text-muted)] truncate">· {app.id}</span>}
              {app.enabled === false && <span className="text-[10px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)] rounded px-1.5 py-0.5 flex-shrink-0">disabled</span>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Toggle
                value={app.enabled !== false}
                onChange={(v) => { update(i, 'enabled', v); }}
              />
              <button
                onClick={(e) => { e.stopPropagation(); remove(i); }}
                className="text-[var(--color-danger)] hover:opacity-80 text-xs px-1"
                title="Remove"
              >✕</button>
            </div>
          </div>
          {openSet.has(i) && (
          <div className="border-t border-[var(--color-border)] p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">ID <span className="text-[var(--color-text-muted)] font-normal">(url key)</span></label>
              <input type="text" value={app.id || ''} placeholder="hoppscotch"
                onChange={(e) => update(i, 'id', e.target.value)}
                className={fieldClass} />
            </div>
            <div>
              <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Label</label>
              <input type="text" value={app.label || ''} placeholder="APIs"
                onChange={(e) => update(i, 'label', e.target.value)}
                className={fieldClass} />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">URL</label>
              <input type="text" value={app.url || ''} placeholder="http://localhost:8843"
                onChange={(e) => update(i, 'url', e.target.value)}
                className={fieldClass} />
              <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                localhost URLs are proxied via <code>/app-proxy/{'{id}'}/</code>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Backend component <span className="text-[var(--color-text-muted)] font-normal">(optional)</span></label>
              <input type="text" value={app.component || ''} placeholder="docker:aw-hoppscotch"
                onChange={(e) => update(i, 'component', e.target.value)}
                className={fieldClass} />
            </div>
            <div>
              <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Menu slot</label>
              <select value={app.menu || 'apps'}
                onChange={(e) => update(i, 'menu', e.target.value)}
                className={fieldClass}>
                <option value="apps">Apps popover</option>
                <option value="workspace">Workspace popover</option>
                <option value="top">Top bar button (legacy)</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-[var(--color-text-muted)] block mb-1">Icon</label>
              <IconPicker value={app.icon || ''} onChange={(v) => update(i, 'icon', v)} />
            </div>
            {/* Authentication gate — when ON, the per-app subdomain
                (e.g. {id}.app.dev.tekflox.com) requires a logged-in
                dev.tekflox.com session. Anonymous visitors are bounced
                to the login screen with ?next= back to the app. When
                OFF, anyone who can reach the app can open it (no login). */}
            <div className="col-span-2 flex items-center gap-3 pt-1">
              <Toggle
                value={app.auth_required ?? true}
                onChange={(v) => update(i, 'auth_required', v)}
              />
              <div className="min-w-0">
                <label className="text-[10px] text-[var(--color-text-muted)] block">Authentication required</label>
                <span className="text-[10px] text-[var(--color-text-muted)] italic">
                  {(app.auth_required ?? true)
                    ? 'Only logged-in dev.tekflox.com users can open this app'
                    : 'No authentication — anyone who can reach this app can open it'}
                </span>
              </div>
            </div>
            {/* Public flag — when OFF (default) the app is reachable only
                from within the server network (localhost, LAN, Kali/Selenium
                browsers, curl from inside the box). External requests get
                410 Gone. When ON, the app is accessible from the internet. */}
            <div className="col-span-2 flex items-center gap-3 pt-1">
              <Toggle
                value={!!app.public}
                onChange={(v) => update(i, 'public', v)}
              />
              <div className="min-w-0">
                <label className="text-[10px] text-[var(--color-text-muted)] block">Public</label>
                <span className="text-[10px] text-[var(--color-text-muted)] italic">
                  {app.public
                    ? 'Accessible from external networks (internet)'
                    : 'Internal only — external requests get 410 Gone'}
                </span>
              </div>
            </div>
            {/* Dev mode — when ON, awserv watches the paths listed in
                watch_paths and auto-reloads this app's iframe whenever
                a file changes. Ideal for frontend/theme development;
                turn OFF for production apps or large directories to
                avoid thousands of kernel inotify watches. */}
            <div className="col-span-2 flex items-center gap-3 pt-1">
              <Toggle
                value={!!app.dev_mode}
                onChange={(v) => update(i, 'dev_mode', v)}
              />
              <div className="min-w-0">
                <label className="text-[10px] text-[var(--color-text-muted)] block">Dev mode</label>
                <span className="text-[10px] text-[var(--color-text-muted)] italic">
                  {app.dev_mode
                    ? 'Watching files — iframe reloads automatically on changes'
                    : 'Enable to auto-reload iframe when watch_paths files change'}
                </span>
              </div>
            </div>
            {/* Custom Caddy directives — raw lines injected verbatim into
                this app's reverse_proxy {} block in the generated Caddyfile.
                Mainly for response-header rewrites: e.g. strip an upstream's
                X-Frame-Options: DENY and rewrite the CSP frame-ancestors so a
                frame-hardened app (OpenClaw) can render inside the AW iframe.
                One directive per line. Saving regenerates + reloads Caddy. */}
            <div className="col-span-2">
              <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Custom Caddy directives</label>
              <textarea
                rows={3}
                value={(app.caddy_directives || []).join('\n')}
                onChange={(e) => update(i, 'caddy_directives', e.target.value ? e.target.value.split('\n') : [])}
                className={`${fieldClass} font-mono resize-y`}
                placeholder={"header_down -X-Frame-Options\nheader_down Content-Security-Policy \"frame-ancestors 'none'\" \"frame-ancestors https://dev.tekflox.com\""}
              />
              <span className="text-[10px] text-[var(--color-text-muted)] italic">
                Raw Caddy lines injected into this app's reverse_proxy block (one per line). Use to rewrite/strip response headers — e.g. allow the app to be embedded in the AW iframe.
              </span>
            </div>
          </div>
          </div>
          )}
        </div>
      ))}
      <button
        onClick={add}
        className="text-xs px-3 py-1.5 rounded border border-dashed border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent)] transition-colors"
      >
        + Add workspace app
      </button>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Secrets FS section
// ---------------------------------------------------------------------------
function SecretsFsSection({ cfg = {}, onChange }) {
  const update = (key, value) => onChange({ ...cfg, [key]: value });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Toggle value={cfg.enabled !== false} onChange={(v) => update('enabled', v)} />
        <span className="text-xs text-[var(--color-text-primary)]">Enabled</span>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          Run <code className="bg-white/10 px-1 rounded">./aw start secrets-fs</code> to mount
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Mount path</label>
          <Field value={cfg.mount_path ?? '/opt/secrets'} placeholder="/opt/secrets"
            onChange={(v) => update('mount_path', v)} />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Approval TTL (seconds)</label>
          <Field value={cfg.approval_ttl ?? 300} placeholder="300" type="number"
            onChange={(v) => update('approval_ttl', v)} />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-[var(--color-text-muted)] block mb-0.5">Cache key</label>
          <select value={cfg.cache_by ?? 'pid'}
            onChange={(e) => update('cache_by', e.target.value)}
            className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] w-full">
            <option value="pid">pid — per-process approval</option>
            <option value="session">session — shared across all processes</option>
          </select>
        </div>
      </div>

      <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded p-3 text-[10px] text-[var(--color-text-muted)] space-y-1">
        <p>
          <strong className="text-[var(--color-text-primary)]">How it works:</strong>{' '}
          <code className="bg-white/10 px-1 rounded">ls {cfg.mount_path || '/opt/secrets'}</code> lists secrets from AWS Secrets Manager.
          Reading a file triggers a Telegram approval request. Once approved, the secret value is returned and cached for the TTL.
        </p>
        <p>
          Requires <code className="bg-white/10 px-1 rounded">/dev/fuse</code> in the aw-sandbox container —
          the aw.json docker service config already has <code className="bg-white/10 px-1 rounded">devices: ["/dev/fuse"]</code> and{' '}
          <code className="bg-white/10 px-1 rounded">cap_add: ["SYS_ADMIN"]</code>. Restart aw-sandbox from the host to activate.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
// Settings → AW → MCPs. Controls the MCP gateway (src/mcp/gateway.py): the
// bearer token any model authenticates with, and which MCP servers (stdio or
// http) are exposed through the single Streamable-HTTP endpoint. Token +
// upstream list live in aw.json (mcp_gateway) and save through the shared AW
// Save button; candidate servers + live health come from /api/mcp-gateway/status.
function McpGatewaySection({ cfg = {}, onChange }) {
  const [status,       setStatus]       = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [copied,       setCopied]       = useState('');
  const [addingConfig, setAddingConfig] = useState(false);
  const [newCfgName,   setNewCfgName]   = useState('');
  const [expandedCfg,  setExpandedCfg]  = useState(null);
  const upstreams = cfg.upstreams || [];
  const configs   = cfg.configs   || {};

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/mcp-gateway/status');
      setStatus(await res.json());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadStatus(); }, []);

  const update = (key, value) => onChange({ ...cfg, [key]: value });

  const toggleUpstream = (name) => {
    const set = new Set(upstreams);
    set.has(name) ? set.delete(name) : set.add(name);
    update('upstreams', Array.from(set));
  };

  // Named config helpers
  const toggleConfigUpstream = (cfgName, serverName) => {
    const cur = new Set((configs[cfgName]?.upstreams) || []);
    cur.has(serverName) ? cur.delete(serverName) : cur.add(serverName);
    update('configs', { ...configs, [cfgName]: { ...configs[cfgName], upstreams: Array.from(cur) } });
  };
  // Run policy: comma/space-separated glob patterns → array. Empty list means
  // unrestricted; the key is omitted so aw.json stays clean.
  const setConfigRunPolicy = (cfgName, key, raw) => {
    const list = (raw || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    const nextSpec = { ...configs[cfgName] };
    if (list.length) nextSpec[key] = list;
    else delete nextSpec[key];
    update('configs', { ...configs, [cfgName]: nextSpec });
  };
  // Namespace scoping (kb_index / presentation_namespace): comma-separated →
  // single string if one value, array if several, key omitted if empty
  // (empty = global / unrestricted — the tool sees everything).
  const setConfigNamespace = (cfgName, key, raw) => {
    const list = (raw || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    const nextSpec = { ...configs[cfgName] };
    if (list.length === 0) delete nextSpec[key];
    else if (list.length === 1) nextSpec[key] = list[0];
    else nextSpec[key] = list;
    update('configs', { ...configs, [cfgName]: nextSpec });
  };
  const addConfig = () => {
    const name = newCfgName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!name || configs[name]) return;
    update('configs', { ...configs, [name]: { upstreams: [] } });
    setNewCfgName('');
    setAddingConfig(false);
    setExpandedCfg(name);
  };
  const deleteConfig = (name) => {
    if (!window.confirm(`Delete config "${name}"?`)) return;
    const next = { ...configs };
    delete next[name];
    update('configs', next);
    if (expandedCfg === name) setExpandedCfg(null);
  };

  const regenToken = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const b64 = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    update('token', b64);
  };

  const copy = (text, label) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  };

  const health     = status?.health     || {};
  const running    = new Set(health.upstreams || []);
  const candidates = status?.candidates || [];
  const basePort   = cfg.port || '9200';

  return (
    <div className="flex flex-col gap-4">
      {/* Live status banner */}
      <div className={`px-3 py-2 rounded border text-xs flex items-center justify-between
        ${health.reachable
          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
          : 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30'}`}>
        <span>
          {health.reachable
            ? `Gateway online — ${running.size} upstream${running.size === 1 ? '' : 's'} running · ${health.tools ?? 0} tools`
            : `Gateway unreachable${health.error ? ` (${health.error})` : ''} — start it with ./aw start mcp-gateway`}
        </span>
        <button type="button" onClick={loadStatus} disabled={loading}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer disabled:opacity-50">
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {/* Default endpoint */}
      <div>
        <span className="text-[11px] text-[var(--color-text-muted)] block mb-1">Default endpoint (all gatewayed servers)</span>
        <div className="flex gap-1.5">
          <code className="flex-1 px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)] font-mono text-[var(--color-text-primary)]">
            {status?.endpoint || `http://127.0.0.1:${basePort}/mcp`}
          </code>
          <button type="button" onClick={() => copy(status?.endpoint || `http://127.0.0.1:${basePort}/mcp`, 'endpoint')}
            className="px-2.5 text-xs rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer">
            {copied === 'endpoint' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)]/70 mt-1">
          Loopback-only. Reachable from app containers (shared netns) and, off-box, via Caddy + AW SSO.
        </p>
      </div>

      {/* Bearer token */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-[var(--color-text-muted)]">Bearer token</span>
          <button type="button" onClick={regenToken}
            className="text-[11px] text-[var(--color-accent)] hover:opacity-80 cursor-pointer">Regenerate</button>
        </div>
        <div className="flex gap-1.5">
          <input type="text" value={cfg.token || ''} onChange={(e) => update('token', e.target.value)}
            placeholder="set a token — required for every request"
            className="flex-1 px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
              text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-[var(--color-accent)]/60" />
          <button type="button" onClick={() => copy(cfg.token || '', 'token')}
            className="px-2.5 text-xs rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer">
            {copied === 'token' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)]/70 mt-1">
          Clients send <code>Authorization: Bearer &lt;token&gt;</code>. Same token applies to all endpoints including named configs.
        </p>
      </div>

      {/* Global upstream allowlist */}
      <div>
        <span className="text-[11px] text-[var(--color-text-muted)] block mb-1">
          Gatewayed servers — default ({upstreams.length} of {candidates.length})
        </span>
        <div className="border border-[var(--color-border)] rounded overflow-hidden divide-y divide-[var(--color-border)]">
          {candidates.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-[var(--color-text-muted)] italic">
              No servers found in mcp.json.
            </div>
          )}
          {candidates.map((c) => {
            const on = upstreams.includes(c.name);
            const isHttp = (c.type || 'stdio') === 'http';
            return (
              <div key={c.name} className="flex items-center gap-3 px-3 py-2 bg-[var(--color-bg-secondary)]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] text-[var(--color-text-primary)] truncate">{c.name}</span>
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-mono
                      ${isHttp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-400'}`}>
                      {c.type || 'stdio'}
                    </span>
                    {on && running.has(c.name) && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/15 text-emerald-400">running</span>
                    )}
                    {!c.enabled && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-white/10 text-[var(--color-text-muted)]">disabled</span>
                    )}
                    {!c.shareable && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/15 text-amber-400">per-session</span>
                    )}
                  </div>
                  {isHttp && c.url && (
                    <span className="text-[10px] text-[var(--color-text-muted)] font-mono truncate block mt-0.5">{c.url}</span>
                  )}
                </div>
                <Toggle value={on} onChange={() => toggleUpstream(c.name)} disabled={!c.enabled} />
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)]/70 mt-1">
          Stdio servers run as <b>one shared process</b>; HTTP servers are proxied directly. Click <b>Save</b> to apply — the gateway restarts automatically.
        </p>
      </div>

      {/* ── Named configs ─────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div>
            <span className="text-[11px] text-[var(--color-text-muted)] block">Named configs ({Object.keys(configs).length})</span>
            <p className="text-[11px] text-[var(--color-text-muted)]/60 mt-0.5">
              Each config exposes a subset at <code>{'/mcp/{name}'}</code>. Only its tools appear on{' '}
              <code>tools/list</code>; calls to other tools are rejected (403).
            </p>
          </div>
          <button type="button" onClick={() => setAddingConfig(true)}
            className="px-2.5 py-1 text-xs rounded bg-[var(--color-accent)]/15 hover:bg-[var(--color-accent)]/25
              text-[var(--color-accent)] cursor-pointer transition-colors whitespace-nowrap shrink-0 ml-3">
            + Add config
          </button>
        </div>

        {/* Add-config input */}
        {addingConfig && (
          <div className="flex gap-1.5 mb-2">
            <input
              type="text"
              value={newCfgName}
              onChange={(e) => setNewCfgName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addConfig(); if (e.key === 'Escape') { setAddingConfig(false); setNewCfgName(''); } }}
              placeholder="config-name (letters, digits, hyphens)"
              autoFocus
              className="flex-1 px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-[var(--color-accent)]/60"
            />
            <button type="button" onClick={addConfig}
              disabled={!newCfgName.trim()}
              className="px-3 py-1 text-xs rounded bg-[var(--color-accent)]/20 text-[var(--color-accent)]
                cursor-pointer disabled:opacity-40 hover:bg-[var(--color-accent)]/30">
              Create
            </button>
            <button type="button" onClick={() => { setAddingConfig(false); setNewCfgName(''); }}
              className="px-2.5 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer">
              Cancel
            </button>
          </div>
        )}

        {/* Config list */}
        {Object.keys(configs).length === 0 && !addingConfig && (
          <p className="text-[11px] text-[var(--color-text-muted)] italic">
            No configs yet.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {Object.entries(configs).map(([cfgName, spec]) => {
            const cfgUpstreams = spec.upstreams || [];
            const endpoint     = status?.configs?.[cfgName]?.endpoint
                              || `http://127.0.0.1:${basePort}/mcp/${cfgName}`;
            const isExpanded   = expandedCfg === cfgName;
            // Only allow picking from globally-gatewayed servers
            const gatewayedCandidates = candidates.filter(c => upstreams.includes(c.name));
            return (
              <div key={cfgName}
                className="border border-[var(--color-border)] rounded bg-[var(--color-bg-secondary)] overflow-hidden">
                {/* Config header */}
                <div className="flex items-center gap-2 px-3 py-2">
                  <button type="button"
                    onClick={() => setExpandedCfg(isExpanded ? null : cfgName)}
                    className="flex-1 flex items-center gap-2 text-left cursor-pointer">
                    <span className={`text-[10px] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    <span className="text-[13px] font-medium text-[var(--color-text-primary)] font-mono">{cfgName}</span>
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-500/15 text-purple-400">
                      {cfgUpstreams.length} server{cfgUpstreams.length !== 1 ? 's' : ''}
                    </span>
                  </button>
                  {/* Endpoint row */}
                  <code className="hidden sm:block text-[10px] text-[var(--color-text-muted)] font-mono truncate max-w-[220px]">
                    {endpoint}
                  </code>
                  <button type="button" onClick={() => copy(endpoint, `ep-${cfgName}`)}
                    className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer whitespace-nowrap">
                    {copied === `ep-${cfgName}` ? 'Copied' : 'Copy URL'}
                  </button>
                  <button type="button" onClick={() => deleteConfig(cfgName)}
                    className="px-2 py-0.5 text-[10px] rounded text-[var(--color-danger)]/70 hover:text-[var(--color-danger)]
                      hover:bg-[var(--color-danger)]/10 cursor-pointer transition-colors">
                    Delete
                  </button>
                </div>

                {/* Expanded: server picker */}
                {isExpanded && (
                  <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                    {gatewayedCandidates.length === 0 && (
                      <p className="px-3 py-2 text-[11px] text-[var(--color-text-muted)] italic">
                        No gatewayed servers to assign — enable servers in the Default list above first.
                      </p>
                    )}
                    {gatewayedCandidates.map((c) => {
                      const on = cfgUpstreams.includes(c.name);
                      const isAgentsPlatform = c.name === 'agents-platform';
                      return (
                        <div key={c.name}>
                          <div
                            className="flex items-center gap-3 px-4 py-2 bg-[var(--color-bg-primary)]/30">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] text-[var(--color-text-primary)] font-mono">{c.name}</span>
                                <span className={`px-1.5 py-0.5 text-[10px] rounded font-mono
                                  ${(c.type || 'stdio') === 'http'
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : 'bg-blue-500/15 text-blue-400'}`}>
                                  {c.type || 'stdio'}
                                </span>
                              </div>
                            </div>
                            <Toggle value={on} onChange={() => toggleConfigUpstream(cfgName, c.name)} />
                          </div>

                          {/* Agents Platform Run Policy — nested directly under the
                              agents-platform row (not a separate top-level section)
                              so it reads as "this configures agents-platform above". */}
                          {isAgentsPlatform && on && (
                            <div className="pl-6 border-l-2 border-[var(--color-accent)]/30 ml-4
                              px-4 py-3 bg-[var(--color-bg-primary)]/30 space-y-2.5">
                              <div>
                                <span className="text-[11px] font-medium text-[var(--color-text-primary)] block">
                                  Agents Platform Run Policy
                                </span>
                                <p className="text-[10px] text-[var(--color-text-muted)]/70 mt-0.5">
                                  Glob patterns (case-insensitive) for which agents / workflows this profile may
                                  run via agents-platform. Comma-separated. Empty = unrestricted.
                                </p>
                              </div>
                              <label className="block">
                                <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                                  Allowed agents (e.g. <code>crispal*</code>)
                                </span>
                                <input
                                  type="text"
                                  defaultValue={(spec.run_agents_allow || []).join(', ')}
                                  onBlur={(e) => setConfigRunPolicy(cfgName, 'run_agents_allow', e.target.value)}
                                  placeholder="* (all agents)"
                                  className="w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                                    text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-[var(--color-accent)]/60"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                                  Allowed workflows (e.g. <code>crispal*</code>)
                                </span>
                                <input
                                  type="text"
                                  defaultValue={(spec.run_workflows_allow || []).join(', ')}
                                  onBlur={(e) => setConfigRunPolicy(cfgName, 'run_workflows_allow', e.target.value)}
                                  placeholder="* (all workflows)"
                                  className="w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                                    text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-[var(--color-accent)]/60"
                                />
                              </label>

                              <div className="pt-1.5 mt-1 border-t border-[var(--color-border)]/60">
                                <p className="text-[10px] text-[var(--color-text-muted)]/70 mb-2">
                                  Require Telegram approval before running. A match blocks the call until you
                                  approve on Telegram. Use <code>*</code> to gate everything, then list
                                  exceptions under "Always allow" below. Empty = no approval.
                                </p>
                                <label className="block mb-2">
                                  <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                                    Agents needing approval (e.g. <code>*</code>)
                                  </span>
                                  <input
                                    type="text"
                                    defaultValue={(spec.run_agents_approval || []).join(', ')}
                                    onBlur={(e) => setConfigRunPolicy(cfgName, 'run_agents_approval', e.target.value)}
                                    placeholder="(none)"
                                    className="w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-amber-500/30
                                      text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-amber-500/60"
                                  />
                                </label>
                                <label className="block mb-2">
                                  <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                                    Workflows needing approval (e.g. <code>*</code>)
                                  </span>
                                  <input
                                    type="text"
                                    defaultValue={(spec.run_workflows_approval || []).join(', ')}
                                    onBlur={(e) => setConfigRunPolicy(cfgName, 'run_workflows_approval', e.target.value)}
                                    placeholder="(none)"
                                    className="w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-amber-500/30
                                      text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-amber-500/60"
                                  />
                                </label>
                                <p className="text-[10px] text-[var(--color-text-muted)]/70 mb-2">
                                  <b>Always allow</b> (skip approval) — runs directly even if it matches the
                                  approval globs above. E.g. approval <code>*</code> + always-allow
                                  <code>crispal*</code> = everything needs approval except crispal.
                                </p>
                                <label className="block mb-2">
                                  <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                                    Agents always allowed (e.g. <code>crispal*</code>)
                                  </span>
                                  <input
                                    type="text"
                                    defaultValue={(spec.run_agents_always_allow || []).join(', ')}
                                    onBlur={(e) => setConfigRunPolicy(cfgName, 'run_agents_always_allow', e.target.value)}
                                    placeholder="(none)"
                                    className="w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-emerald-500/30
                                      text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-emerald-500/60"
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-[10px] text-[var(--color-text-muted)] block mb-1">
                                    Workflows always allowed (e.g. <code>crispal*</code>)
                                  </span>
                                  <input
                                    type="text"
                                    defaultValue={(spec.run_workflows_always_allow || []).join(', ')}
                                    onBlur={(e) => setConfigRunPolicy(cfgName, 'run_workflows_always_allow', e.target.value)}
                                    placeholder="(none)"
                                    className="w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-emerald-500/30
                                      text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-emerald-500/60"
                                  />
                                </label>
                              </div>
                            </div>
                          )}

                          {/* Knowledge Base namespace — nested under aw-knowledge-base.
                              Empty = global (the tool sees every KB doc). */}
                          {c.name === 'aw-knowledge-base' && on && (
                            <div className="pl-6 border-l-2 border-[var(--color-accent)]/30 ml-4
                              px-4 py-3 bg-[var(--color-bg-primary)]/30 space-y-1.5">
                              <span className="text-[11px] font-medium text-[var(--color-text-primary)] block">
                                Knowledge Base Namespace
                              </span>
                              <p className="text-[10px] text-[var(--color-text-muted)]/70">
                                Restricts this profile's KB tools to one index (or a few, comma-separated).
                                Empty = global — sees every index.
                              </p>
                              <input
                                type="text"
                                defaultValue={[].concat(spec.kb_index || []).join(', ')}
                                onBlur={(e) => setConfigNamespace(cfgName, 'kb_index', e.target.value)}
                                placeholder="(empty = global)"
                                className="w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                                  text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-[var(--color-accent)]/60"
                              />
                            </div>
                          )}

                          {/* Presentation namespace — nested under aw-presentation.
                              Empty = global (the tool sees/creates every presentation). */}
                          {c.name === 'aw-presentation' && on && (
                            <div className="pl-6 border-l-2 border-[var(--color-accent)]/30 ml-4
                              px-4 py-3 bg-[var(--color-bg-primary)]/30 space-y-1.5">
                              <span className="text-[11px] font-medium text-[var(--color-text-primary)] block">
                                Presentation Namespace
                              </span>
                              <p className="text-[10px] text-[var(--color-text-muted)]/70">
                                Presentations created by this profile are tagged with this namespace, and
                                list/update/delete/share/export are restricted to it. Empty = global —
                                sees and can edit every presentation.
                              </p>
                              <input
                                type="text"
                                defaultValue={spec.presentation_namespace || ''}
                                onBlur={(e) => setConfigNamespace(cfgName, 'presentation_namespace', e.target.value)}
                                placeholder="(empty = global)"
                                className="w-full px-2.5 py-1.5 text-xs rounded bg-white/5 border border-[var(--color-border)]
                                  text-[var(--color-text-primary)] font-mono focus:outline-none focus:border-[var(--color-accent)]/60"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Sub-tabs inside the AW Settings tab. The split keeps the long
// infrastructure sections (Components / Docker / Apps) out of the
// general scroll, gives Workspace Agent's multi-bot UI room to
// breathe, and folds the (previously top-level) Appearance tab under
// General where it's still discoverable but no longer competes with
// integration tabs for top-strip real estate.
const AW_SUBTABS = [
  { id: 'general',       label: 'General' },
  { id: 'apps_services', label: 'Apps & Services' },
  { id: 'mcps',          label: 'MCPs' },
  { id: 'knowledge',     label: 'Knowledge' },
  { id: 'secrets',       label: 'Secrets' },
  { id: 'agent',         label: 'Workspace Agent' },
];

export default function AwConfigTab() {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [subTab, setSubTab] = useState('general');

  useEffect(() => {
    getAwConfig().then(setConfig);
  }, []);

  const showMessage = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  // Component field change (supports nested modes via "modes.web.port")
  const handleComponentChange = (compName, key, value) => {
    setConfig((prev) => {
      const next = { ...prev, components: { ...prev.components } };
      if (key.startsWith('modes.')) {
        const parts = key.split('.');
        const comp = { ...next.components[compName] };
        comp.modes = { ...comp.modes };
        comp.modes[parts[1]] = { ...comp.modes[parts[1]], [parts[2]]: value };
        next.components[compName] = comp;
      } else {
        next.components[compName] = { ...next.components[compName], [key]: value };
      }
      return next;
    });
  };

  // General top-level field change
  const handleGeneralChange = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  // Docker services change
  const handleDockerChange = (docker_services) => {
    setConfig((prev) => ({ ...prev, docker_services }));
  };

  // Workspace apps change
  const handleWorkspaceAppsChange = (workspace_apps) => {
    setConfig((prev) => ({ ...prev, workspace_apps }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await saveAwConfig(normalizeDependsForSave(config));
      if (res.success) {
        const caddy = res.reload?.caddy;
        let msg = 'Saved';
        if (caddy?.error)        msg += ' · Caddy error (check logs)';
        else if (caddy?.changed) msg += caddy.reloaded ? ' · Caddy reloaded' : ' · Caddy reload failed';
        else                     msg += ' · Caddy unchanged';
        // mcp_gateway changes (upstreams, named configs, kb_index,
        // presentation_namespace, run policy, ...) only take effect after the
        // gateway process restarts — settings.py already does this
        // automatically on save when that block changed, so just surface it.
        if ((res.restarted || []).includes('mcp-gateway')) msg += ' · MCP Gateway restarted';
        showMessage(msg);
        window.dispatchEvent(new Event('aw-config-changed'));
      } else {
        showMessage(res.error || 'Error');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!config) return <div className="p-6 text-[var(--color-text-muted)]">Loading...</div>;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">AW Configuration</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            <code className="bg-white/10 px-1 rounded">src/config/aw.json</code>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className="text-xs text-green-400">{message}</span>}
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Sub-tabs inside the AW tab — keeps Workspace Agent's multi-bot UI
          out of the long general-config scroll. */}
      <div className="flex items-center gap-1 mb-4 border-b border-[var(--color-border)]">
        {AW_SUBTABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 text-xs -mb-px border-b-2 transition-colors ${
              subTab === t.id
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'general' && (
        <>
          <Section title="General" description="Terminal, AWS, misc settings" defaultOpen>
            <GeneralSection config={config} onChange={handleGeneralChange} />
          </Section>

          {/* Appearance — used to be a top-level Settings tab; folded in
              here so the top tab strip stays focused on integrations. */}
          <Section title="Appearance" description="Workspace color theme (stored in the browser, not aw.json)" defaultOpen>
            <AppearanceTab />
          </Section>
        </>
      )}

      {subTab === 'mcps' && (
        <Section
          title="MCP Gateway"
          description="Expose stdio MCP servers over one token-authenticated Streamable-HTTP endpoint — for OpenClaw and any model"
          defaultOpen
        >
          <McpGatewaySection
            cfg={config.mcp_gateway || {}}
            onChange={(next) => handleGeneralChange('mcp_gateway', next)}
          />
        </Section>
      )}

      {subTab === 'knowledge' && (
        <Section
          title="Knowledge Base"
          description="Paths to map and index into the vector store"
          defaultOpen
        >
          <KnowledgeBaseSection
            mapPaths={config.knowledge_base?.map_paths || []}
            onChange={(paths) => handleGeneralChange('knowledge_base', { ...(config.knowledge_base || {}), map_paths: paths })}
          />
        </Section>
      )}

      {subTab === 'secrets' && (
        <Section
          title="Secrets FS"
          description="FUSE filesystem backed by AWS Secrets Manager — ls lists, cat triggers Telegram approval"
          defaultOpen
        >
          <SecretsFsSection
            cfg={config.secrets_fs || {}}
            onChange={(next) => handleGeneralChange('secrets_fs', next)}
          />
        </Section>
      )}

      {subTab === 'apps_services' && (
        <>
          <Section
            title="Apps"
            description={`${(config.workspace_apps || []).length} configured — iframed panels opened from the nav`}
            defaultOpen
          >
            <WorkspaceAppsSection apps={config.workspace_apps || []} onChange={handleWorkspaceAppsChange} />
          </Section>

          <Section
            title="Dockers"
            description={`${(config.docker_services || []).length} containers — image, ports, volumes, env`}
          >
            <DockerServicesSection services={config.docker_services || []} onChange={handleDockerChange} />
          </Section>

          <Section
            title="Components"
            description={`${Object.keys(config.components || {}).length} services`}
          >
            <ComponentsSection components={config.components || {}} onChange={handleComponentChange} />
          </Section>
        </>
      )}

      {subTab === 'agent' && (
        <>
          <WorkspaceAgentSection
            agentConfig={config.workspace_agent || {}}
            aiAgents={config.ai_agents || []}
            onChange={(next) => handleGeneralChange('workspace_agent', next)}
          />
          <div className="border-t border-[var(--color-border)] mt-2" />
          <LlmProxySection
            config={config.llm_proxy || {}}
            onChange={(next) => handleGeneralChange('llm_proxy', next)}
          />
        </>
      )}
    </div>
  );
}

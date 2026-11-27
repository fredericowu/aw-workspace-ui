// Settings > About: versions, machine resources, explicit update.
// Opening the tab issues GETs only; the one POST sits behind a confirm dialog.
import { useCallback, useEffect, useState } from 'react';
import {
  fetchCoreAbout, fetchHealthVersion, probeDesktop, requestDesktopUpgrade,
  cloudSlug, fetchCloudVersions, updateCloudWorkspace, consoleManageUrl,
} from '../lib/aboutApi';

const GiB = 1024 ** 3;
export function fmtBytes(n) {
  if (typeof n !== 'number') return '';
  return n >= GiB ? `${(n / GiB).toFixed(1)} GiB` : `${(n / 1048576).toFixed(0)} MiB`;
}

/** One fact envelope -> display text. Distinguishes unlimited / none / unknown. */
export function renderFact(f, fmt = (v) => String(v)) {
  if (!f) return 'Unavailable';
  switch (f.state) {
    case 'ok': return fmt(f.value);
    case 'unlimited': return 'No limit set on the workspace container (limits applied outside it are not visible here)';
    case 'none_visible': return 'None exposed to this container';
    case 'unavailable': return `Unavailable${f.reason ? `: ${f.reason}` : ''}`;
    default: return `Unknown${f.reason ? `: ${f.reason}` : ''}`;
  }
}

function Row({ label, children, scope }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-[var(--color-border)] text-sm">
      <div className="text-[var(--color-text-muted)]">
        {label}{scope && <span className="ml-2 text-xs opacity-70">({scope})</span>}
      </div>
      <div className="text-right break-words max-w-[60%]">{children}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-6">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {children}
    </section>
  );
}

function useSource(loader) {
  const [s, setS] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    loader().then((data) => live && setS({ data }), (error) => live && setS({ error }));
    return () => { live = false; };
  }, [loader]);
  return s;
}

const loadDesktop = () => probeDesktop();
const loadCore = () => fetchCoreAbout();

export default function AboutTab() {
  const core = useSource(loadCore);
  const desktop = useSource(loadDesktop);
  const slug = cloudSlug();
  const loadCloud = useCallback(() => (slug ? fetchCloudVersions(slug) : Promise.resolve(null)), [slug]);
  const cloud = useSource(loadCloud);

  const c = core.data;
  const d = desktop.data;
  const unavail = (src) => `Unavailable: ${src.error?.message || 'request failed'}`;

  return (
    <div className="p-4 max-w-3xl" data-testid="about-tab">
      <Section title="Version">
        {core.error ? <Row label="Core">{unavail(core)}</Row> : !c ? <Row label="Core">Loading…</Row> : (
          <>
            <Row label="aw-workspace core">{c.version?.core || 'Unknown'}</Row>
            {c.version?.git_head && <Row label="Commit">{c.version.git_head.slice(0, 12)}</Row>}
          </>
        )}
        {d && (
          <>
            <Row label="AW Desktop app">{d.app_version || 'Unknown'}</Row>
            <Row label="Bundled UI build">{d.build?.uiCommit ? String(d.build.uiCommit).slice(0, 12) : 'Unavailable: not recorded'}</Row>
            <Row label="Running core image">{d.workspace?.pinned_image || 'Unavailable'}</Row>
          </>
        )}
      </Section>

      <Section title="Machine resources">
        {core.error && <Row label="Resources">{unavail(core)}</Row>}
        {c?.legacy && <Row label="Resources">Needs a newer workspace core</Row>}
        {c && !c.legacy && <Resources c={c} />}
        {d?.vm && <Row label="Podman VM allocation" scope="desktop">{renderVm(d.vm)}</Row>}
        {d?.host && <Row label="Physical host" scope="desktop">{renderHost(d.host)}</Row>}
      </Section>

      <Section title="Update">
        <UpdatePanel slug={slug} cloud={cloud} desktop={d} desktopLoading={desktop.loading} />
      </Section>
    </div>
  );
}

function renderVm(vm) {
  if (vm.state && vm.state !== 'ok') return renderFact(vm);
  return `${vm.cpus ?? '?'} CPU, ${vm.memory_mib ? fmtBytes(vm.memory_mib * 1048576) : '?'} RAM, ${vm.disk_gib ?? '?'} GiB disk${vm.source === 'default' ? ' (init defaults)' : ''}`;
}

function renderHost(h) {
  const parts = [];
  if (h.cpus) parts.push(`${h.cpus} CPU`);
  if (h.mem_total) parts.push(`${fmtBytes(h.mem_total)} RAM (${fmtBytes(h.mem_free)} free)`);
  if (h.disk_total) parts.push(`${fmtBytes(h.disk_total)} disk (${fmtBytes(h.disk_free)} free)`);
  if (h.gpu) parts.push(`GPU: ${typeof h.gpu === 'string' ? h.gpu : renderFact(h.gpu)}`);
  return parts.join(', ') || 'Unavailable';
}

function Resources({ c }) {
  const cpus = c.machine?.cpus;
  const mem = c.machine?.memory;
  return (
    <>
      <Row label="CPU limit" scope="container">{renderFact(c.container?.cpu_limit, (v) => `${v} cores`)}</Row>
      <Row label="CPUs visible" scope="kernel">
        {renderFact(cpus, (v) => `${v.effective} usable of ${v.total}`)}
      </Row>
      <Row label="RAM limit" scope="container">{renderFact(c.container?.memory_limit, fmtBytes)}</Row>
      <Row label="RAM used" scope="container">{renderFact(c.container?.memory_used, fmtBytes)}</Row>
      <Row label="RAM" scope="kernel">
        {renderFact(mem, (v) => `${fmtBytes(v.total)} total, ${fmtBytes(v.available)} available`)}
      </Row>
      {(c.storage || []).map((s) => (
        <Row key={s.path} label={`Disk ${s.roles.join(' + ')}`} scope="volume">
          {s.state === 'ok'
            ? `${fmtBytes(s.used)} used of ${fmtBytes(s.total)}, ${fmtBytes(s.free)} free`
            : renderFact(s)}
        </Row>
      ))}
      <Row label="GPU" scope="container">
        {renderFact(c.gpu, (v) => v.map((g) => `${g.name} (${fmtBytes(g.memory_used)} / ${fmtBytes(g.memory_total)})`).join('; '))}
      </Row>
    </>
  );
}

function UpdatePanel({ slug, cloud, desktop, desktopLoading }) {
  const [confirm, setConfirm] = useState(null); // {force, files}
  const [phase, setPhase] = useState({ s: 'idle' });

  if (slug) {
    if (cloud.loading) return <p className="text-sm">Checking for updates…</p>;
    if (cloud.error) {
      return <p className="text-sm">Unavailable: {cloud.error.message}. <ManageLink slug={slug} /></p>;
    }
    const w = cloud.data?.workspace;
    if (!w || w.outdated == null) {
      return <p className="text-sm">Latest version is unknown, so no update is offered here. <ManageLink slug={slug} /></p>;
    }
    if (!w.outdated) return <p className="text-sm">Up to date ({w.current}).</p>;

    const run = async (force) => {
      setConfirm(null);
      setPhase({ s: 'running' });
      try {
        await updateCloudWorkspace(slug, { force });
        // The backend re-resolves "latest" and verifies the install before it
        // returns, so the installed version may be newer than the w.latest this
        // page loaded. Confirm by "the running version changed", and report it.
        const before = w.current;
        const deadline = Date.now() + 5 * 60_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 4000));
          try {
            const now = await fetchHealthVersion();
            if (now && now !== before) { setPhase({ s: 'done', version: now }); return; }
          } catch { /* restarting */ }
        }
        setPhase({ s: 'unconfirmed' });
      } catch (e) {
        if (e.status === 409 && e.body?.error === 'uncommitted_host_edits') {
          setPhase({ s: 'idle' });
          setConfirm({ force: true, files: e.body.files || [], total: e.body.dirty_count, truncated: !!e.body.truncated });
        } else if (e.status === 403) setPhase({ s: 'error', msg: 'Requires workspace owner or admin' });
        else if (e.status === 503) setPhase({ s: 'error', msg: 'The workspace host is offline' });
        else setPhase({ s: 'error', msg: e.message });
      }
    };

    return (
      <div className="text-sm">
        <p>Current {w.current}, latest {w.latest}.</p>
        {phase.s !== 'done' && (
          <button className="mt-2 px-3 py-1 rounded border" disabled={phase.s === 'running'}
            onClick={() => setConfirm({ force: false })}>Update to {w.latest}</button>
        )}
        {confirm && (
          <div role="dialog" aria-label="Confirm update" className="mt-2 p-3 border rounded">
            <p>
              Updates the aw-workspace core to {w.latest}. The workspace container is recreated:
              terminals and running agent sessions are interrupted and the page reconnects.
            </p>
            {confirm.force && (
              <div>
                <p className="mt-2">The host has uncommitted edits that will be discarded (a recoverable backup is written first):</p>
                <ul className="list-disc ml-5">{(confirm.files || []).slice(0, 10).map((f) => <li key={f}>{f}</li>)}</ul>
                {(() => {
                  const total = Math.max(confirm.total || 0, (confirm.files || []).length);
                  const omitted = total - Math.min(10, (confirm.files || []).length);
                  return omitted > 0 || confirm.truncated
                    ? <p className="mt-1">{omitted > 0 ? `${omitted} more file${omitted === 1 ? '' : 's'} not listed` : 'More files not listed'}; all uncommitted changes will be discarded.</p>
                    : null;
                })()}
              </div>
            )}
            <button className="mt-2 mr-2 px-3 py-1 rounded border" onClick={() => run(confirm.force)}>
              {confirm.force ? 'Discard edits and update' : 'Update now'}
            </button>
            <button className="mt-2 px-3 py-1 rounded border" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        )}
        {phase.s === 'running' && <p className="mt-2">Updating… waiting for the workspace to report a new version.</p>}
        {phase.s === 'done' && <p className="mt-2">Updated: now running {phase.version}.</p>}
        {phase.s === 'unconfirmed' && <p className="mt-2">Outcome not confirmed. <ManageLink slug={slug} /></p>}
        {phase.s === 'error' && <p className="mt-2">Update failed: {phase.msg}. <ManageLink slug={slug} /></p>}
        <p className="mt-2"><ManageLink slug={slug} /></p>
      </div>
    );
  }

  if (desktopLoading) return <p className="text-sm">Checking…</p>;
  if (desktop) {
    const ws = desktop.workspace || {};
    if (ws.upgrade_supported === false) return <p className="text-sm">In-place upgrade is not supported on this platform.</p>;
    if (!ws.upgrade_available) {
      return <p className="text-sm">This is the newest core bundled with AW Desktop {desktop.app_version}; newer cores arrive with a desktop app update.</p>;
    }
    const open = async () => {
      setConfirm(null);
      const r = await requestDesktopUpgrade().catch(() => ({ status: 0, body: {} }));
      setPhase(r.status === 202
        ? { s: 'handoff' }
        : { s: 'error', msg: r.body?.error || (r.status ? `HTTP ${r.status}` : 'AW Desktop did not answer') });
    };
    return (
      <div className="text-sm">
        <p>Core {ws.pinned_image} can be upgraded to {ws.bundled_image}.</p>
        <button className="mt-2 px-3 py-1 rounded border" onClick={() => setConfirm({})}>Update workspace core…</button>
        {confirm && (
          <div role="dialog" aria-label="Confirm update" className="mt-2 p-3 border rounded">
            <p>
              Opens AW Desktop's upgrade dialog. The upgrade closes this workspace window, keeps your data,
              and reopens the workspace on the new core.
            </p>
            <button className="mt-2 mr-2 px-3 py-1 rounded border" onClick={open}>Open upgrade dialog</button>
            <button className="mt-2 px-3 py-1 rounded border" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        )}
        {phase.s === 'handoff' && <p className="mt-2">The upgrade dialog is open in AW Desktop.</p>}
        {phase.s === 'error' && <p className="mt-2">Could not open the upgrade dialog: {phase.msg}</p>}
      </div>
    );
  }
  return <p className="text-sm">Not managed from here.</p>;
}

function ManageLink({ slug }) {
  const href = consoleManageUrl(slug);
  return href ? <a className="underline" href={href} target="_blank" rel="noreferrer">Open management</a> : null;
}

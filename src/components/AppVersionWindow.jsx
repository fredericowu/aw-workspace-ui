// AppVersionWindow — pin/rollback for an installed app (replaces "configure
// which version to install" as a config field, per Frederico's feedback:
// version isn't a setting, it's a stable/reversible operation). Lists the
// app repo's tagged releases (GET /api/apps/{slug}/versions) against the
// currently-installed version, and installs a specific one on click
// (POST /api/apps/{slug}/version) — same async job/status contract as
// install/update, reusing pollInstallStatus from AppsMarketplace.
import { useEffect, useRef, useState } from 'react';
import { getAppVersions, setAppVersion } from '../apps/appsApi';
import { pollInstallStatus } from './AppsMarketplace';

export default function AppVersionWindow({ app, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    let mounted = true;
    getAppVersions(app.slug)
      .then((d) => { if (mounted) setData(d); })
      .catch((e) => { if (mounted) setError(String(e.message || e)); });
    return () => { mounted = false; };
  }, [app.slug]);

  const install = async (version) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setAppVersion(app.slug, version);
      await pollInstallStatus(app.slug, alive);
      if (alive.current) onChanged?.();
    } catch (e) {
      if (alive.current) setError(String(e.message || e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="appcfg-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${app.name} versions`}>
      <div className="appcfg-panel" onClick={(e) => e.stopPropagation()}>
        <header className="appcfg-head">
          <div>
            <h3 className="appcfg-title">{app.name} version</h3>
            <p className="appcfg-sub">{app.slug} · installed v{data?.installed_version ?? app.version}</p>
          </div>
          <button type="button" className="appcfg-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {error && <p className="appcfg-msg is-err" data-testid="appver-error">{error}</p>}

        {!data ? (
          <div className="appcfg-loading" data-testid="appver-loading">
            <span className="appcfg-spinner" aria-hidden="true" />
            <span>Loading versions…</span>
          </div>
        ) : data.versions.length === 0 ? (
          <p className="appcfg-empty">No tagged releases found for this app.</p>
        ) : (
          <ul className="appver-list" data-testid="appver-list">
            {data.versions.map((v) => {
              const isInstalled = v.version === data.installed_version;
              return (
                <li className="appver-row" key={v.ref}>
                  <span className="appver-version">
                    v{v.version}
                    {v.version === data.catalog_version && <span className="appver-tag">latest</span>}
                  </span>
                  {isInstalled ? (
                    <span className="appver-installed">Installed</span>
                  ) : (
                    <button
                      type="button"
                      className="appver-install"
                      disabled={busy}
                      onClick={() => install(v)}
                    >
                      Install this version
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

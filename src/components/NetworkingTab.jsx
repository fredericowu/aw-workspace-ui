import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  bootstrapEligibility,
  fetchMeshStatus,
  fetchRemoteHosts,
  installInstructions,
  CONTROL_PLANE_PLACEHOLDER,
} from '../lib/networkingApi';

// ─────────────────────────────────────────────────────────────────────────────
// Settings → General → Networking
//
// The tenant's private mesh: every aw-remote-host linked to this account, and
// (once the agent reports it) whether each one is on the mesh, at which IP, and
// whether the path to it is direct or relayed.
//
// Two rules this screen exists to keep, both from the same doctrine — a screen
// that quietly shows less than the truth is worse than one that shows nothing:
//
//   1. Every disabled bootstrap button carries a WRITTEN reason. A greyed
//      control with no sentence next to it reads as a bug, not as a decision.
//   2. Nothing is invented. The tailscale side has no API yet (see
//      networkingApi.js), so those cells say "sem dados do agente" — never a
//      made-up "desconectado", never a plausible-looking 100.64.x.x.
//
// The host rows are per LINK, not per machine: a re-link leaves the old row
// behind (the Surface carries four, two offline) and one machine can hold both
// a Windows and a WSL2 link. Offline links are folded into a collapsed group so
// they neither disappear nor drown the live ones.
// ─────────────────────────────────────────────────────────────────────────────

function Pill({ tone = 'muted', children, title }) {
  const tones = {
    muted: 'bg-white/5 text-[var(--color-text-muted)]',
    ok: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    err: 'bg-red-500/15 text-red-300',
    info: 'bg-sky-500/15 text-sky-300',
  };
  return (
    <span title={title} className={`inline-block text-[10px] uppercase tracking-wide px-2 py-0.5 rounded whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Section({ title, description, children }) {
  return (
    <div className="mb-4 border border-[var(--color-border)] rounded overflow-hidden">
      <div className="px-4 py-2.5 bg-[var(--color-bg-header)]">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</div>
        {description && (
          <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{description}</div>
        )}
      </div>
      <div className="border-t border-[var(--color-border)] p-4 bg-[var(--color-bg-primary)]">{children}</div>
    </div>
  );
}

function relativeSeen(ts) {
  if (!ts) return 'nunca';
  const secs = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (secs < 90) return `há ${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 90) return `há ${mins}min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `há ${hours}h`;
  return `há ${Math.round(hours / 24)}d`;
}

/** Mesh cell — the honest-unknown lives here. `mesh.available === false` means
 *  nothing has ever reported this host's tailscale state, which is NOT the same
 *  as reporting that it is down. */
function MeshState({ mesh, hostId }) {
  if (!mesh?.available) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone="muted" title={mesh?.reason}>sem dados do agente</Pill>
        <span className="text-[11px] text-[var(--color-text-muted)]">
          estado na mesh desconhecido
        </span>
      </div>
    );
  }
  const node = mesh.nodes?.[hostId];
  if (!node) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone="warn">fora da mesh</Pill>
        <span className="text-[11px] text-[var(--color-text-muted)]">nunca registado no control plane</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Pill tone={node.up ? 'ok' : 'err'}>{node.up ? 'na mesh' : 'mesh offline'}</Pill>
      {node.meshIp && (
        <code className="text-[11px] font-mono text-[var(--color-text-secondary)]">{node.meshIp}</code>
      )}
      {node.path && (
        <Pill
          tone={node.path === 'direct' ? 'ok' : 'info'}
          title={node.path === 'relay'
            ? 'O tráfego passa por um relay DERP em vez de ligação directa — funciona, mas com um salto pelo meio.'
            : 'Ligação directa entre os dois hosts, sem relay.'}
        >
          {node.path}
        </Pill>
      )}
      {node.via && (
        <span className="text-[11px] text-[var(--color-text-muted)]">via {node.via}</span>
      )}
    </div>
  );
}

function HostRow({ host, mesh }) {
  const eligibility = bootstrapEligibility(host);
  const tone = { yes: 'ok', no: 'err', unknown: 'warn' }[eligibility.state] || 'muted';

  return (
    <div className="py-3 border-b border-[var(--color-border)] last:border-b-0">
      {/* Identity line — wraps on a narrow viewport instead of overflowing. */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-[var(--color-text-primary)] break-all">
              {host.hostname || '(sem hostname)'}
            </span>
            <Pill tone={host.connected ? 'ok' : 'muted'}>
              {host.connected ? 'ligado' : 'offline'}
            </Pill>
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5 break-all">
            {host.workspace_slug} · {host.os || 'os?'}/{host.arch || 'arch?'} · link{' '}
            <code className="font-mono">{host.id}</code> · visto {relativeSeen(host.last_seen_at)}
          </div>
        </div>

        {/* Bootstrap remoto — PLACEHOLDER nesta card: o módulo que o executa
            está a ser escrito noutra (feature:aw-remote-host-bootstrap-vpn-
            tailscale). Fica desactivado para todos, e o title diz porquê, para
            não se confundir "ainda não existe" com "este host não pode". */}
        <button
          type="button"
          disabled
          title={eligibility.state === 'no'
            ? `Indisponível: ${eligibility.reason}`
            : 'O bootstrap remoto ainda não está implementado — chega com o módulo bootstrap-vpn do aw-remote-host.'}
          className="shrink-0 px-3 py-1 text-[12px] rounded bg-white/5 text-[var(--color-text-muted)] opacity-50 cursor-not-allowed"
        >
          Bootstrap na mesh
        </button>
      </div>

      <div className="mt-2 grid gap-1.5">
        <MeshState mesh={mesh} hostId={host.id} />
        {/* A razão da inelegibilidade em TEXTO, sempre — não só no title do
            botão, que é invisível em touch. */}
        <div className="flex items-start gap-2 flex-wrap">
          <Pill tone={tone}>{eligibility.label}</Pill>
          <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
            {eligibility.reason}
          </span>
        </div>
      </div>
    </div>
  );
}

function CommandBlock({ commands }) {
  return (
    <pre className="mt-1 p-2 rounded bg-black/30 text-[11px] font-mono text-[var(--color-text-secondary)] overflow-x-auto whitespace-pre">
      {commands.join('\n')}
    </pre>
  );
}

export default function NetworkingTab() {
  const [hosts, setHosts] = useState(null);
  const [mesh, setMesh] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOffline, setShowOffline] = useState(false);
  // Bumped by Retry. The reset to loading/no-error happens in the handler, not
  // in the effect body — a synchronous setState there cascades a second render
  // on every mount (react-hooks/set-state-in-effect).
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchRemoteHosts(), fetchMeshStatus()])
      .then(([h, m]) => { if (alive) { setHosts(h); setMesh(m); } })
      .catch((e) => { if (alive) setError(String(e.message || e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadToken]);

  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadToken((t) => t + 1);
  }, []);

  const { online, offline } = useMemo(() => {
    const rows = hosts || [];
    return {
      online: rows.filter((h) => h.connected),
      offline: rows.filter((h) => !h.connected),
    };
  }, [hosts]);

  const controlPlane = mesh?.available ? mesh.controlPlaneUrl : null;

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Networking</h3>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
          A rede mesh privada deste tenant: as workspaces e os aw-remote-hosts da conta,
          o seu estado no tailscale, e o caminho até cada peer.
        </p>
      </div>

      <Section
        title="Control plane"
        description="O headscale deste tenant. É por-tenant — dois tenants não partilham control plane, e por isso nunca vem escrito no código."
      >
        {controlPlane ? (
          <code className="text-[12px] font-mono text-[var(--color-text-secondary)] break-all">{controlPlane}</code>
        ) : (
          <div className="flex items-start gap-2 flex-wrap">
            <Pill tone="warn">por publicar</Pill>
            <span className="text-[11px] text-[var(--color-text-muted)] flex-1 min-w-[12rem]">
              Nenhuma API publica ainda o control plane deste tenant. Os comandos abaixo
              mostram <code className="font-mono">{CONTROL_PLANE_PLACEHOLDER}</code> em vez
              de um URL — copiar um de outro tenant não funcionaria.
            </span>
          </div>
        )}
      </Section>

      <Section
        title="Hosts da conta"
        description="Uma linha por LINK, não por máquina: uma re-ligação deixa a anterior para trás, e a mesma máquina pode ter mais do que um link."
      >
        {loading && (
          <div className="text-[12px] text-[var(--color-text-muted)]">A carregar hosts…</div>
        )}

        {error && (
          <div className="px-3 py-2 rounded bg-[var(--color-danger)]/10 text-[12px] text-[var(--color-danger)]">
            <div className="font-medium">Não foi possível listar os hosts.</div>
            <div className="mt-0.5 text-[11px] opacity-80 break-all">{error}</div>
            <button
              type="button"
              onClick={retry}
              className="mt-2 px-2 py-1 text-[11px] rounded bg-white/5 hover:bg-white/10 text-[var(--color-text-primary)]"
            >
              Tentar outra vez
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Estado da mesh, uma vez, no topo — repeti-lo em cada linha seria
                ruído; a linha diz só o que sabe sobre aquele host. */}
            {!mesh?.available && (
              <div className="mb-3 px-3 py-2 rounded bg-amber-500/10 text-[11px] text-amber-300">
                <span className="font-medium">Estado do tailscale indisponível. </span>
                {mesh?.reason}
              </div>
            )}

            {online.length === 0 && (
              <div className="text-[12px] text-[var(--color-text-muted)]">
                Nenhum host ligado neste momento.
              </div>
            )}

            {online.map((h) => <HostRow key={h.id} host={h} mesh={mesh} />)}

            {offline.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                <button
                  type="button"
                  onClick={() => setShowOffline((v) => !v)}
                  className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  {showOffline ? '▼' : '▶'} Links offline ({offline.length})
                </button>
                {showOffline && (
                  <div className="mt-1 opacity-70">
                    {offline.map((h) => <HostRow key={h.id} host={h} mesh={mesh} />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Section>

      <Section
        title="direct vs relay"
        description="Porque é que esta coluna existe."
      >
        <p className="text-[11px] text-[var(--color-text-muted)]">
          O relay não é um fallback raro: duas máquinas na mesma rede de casa podem
          na mesma falar através de um DERP, quando uma delas está atrás de outra
          camada de NAT. Sem isto escrito, &quot;funciona, mas passa por Madrid&quot; é
          invisível.
        </p>
      </Section>

      <Section
        title="Instalar o tailscale"
        description="Por sistema operativo. O caminho de macOS é mesmo outro — o instalador de Linux não serve lá."
      >
        {installInstructions(controlPlane).map((entry) => (
          <div key={entry.id} className="mb-3 last:mb-0">
            <div className="text-[12px] font-medium text-[var(--color-text-primary)]">{entry.title}</div>
            {entry.note && (
              <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{entry.note}</div>
            )}
            <CommandBlock commands={entry.commands} />
          </div>
        ))}
      </Section>
    </div>
  );
}

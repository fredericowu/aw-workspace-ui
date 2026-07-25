import { useState, useEffect, useCallback, useRef } from 'react';

function useWhatsAppStatus() {
  const [status, setStatus] = useState(null);
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/status');
      setStatus(await res.json());
    } catch {
      setStatus({ ok: false, connector_reachable: false });
    }
  }, []);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, 4000);
    return () => clearInterval(timerRef.current);
  }, [refresh]);

  return { status, refresh };
}

export default function WhatsAppSection({ agentConfig = {}, onChange }) {
  const { status, refresh } = useWhatsAppStatus();
  const [qrNonce, setQrNonce] = useState(Date.now());
  const [agents, setAgents] = useState({ ap_agents: [], ap_workflows: [] });

  useEffect(() => {
    fetch('/api/whatsapp/agent-picker')
      .then((r) => r.json())
      .then(setAgents)
      .catch(() => {});
  }, []);

  const connected = Boolean(status?.connected);
  const reachable = status?.connector_reachable !== false;

  const refreshQr = () => setQrNonce(Date.now());

  const currentTarget = agentConfig.whatsapp_default_target || '';

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-text-muted)]">
        Personal WhatsApp account, connected via the whatsapp-connector (Baileys) component.
        Scan the QR with WhatsApp → Linked devices → Link a device.
      </p>

      {!reachable && (
        <div className="text-xs text-red-400">
          whatsapp-connector not reachable — is it running? (<code>./aw start whatsapp-connector</code>)
        </div>
      )}

      {reachable && (
        <div className="flex gap-6 items-start">
          <div className="flex flex-col items-center gap-2 shrink-0">
            {connected ? (
              <div className="w-40 h-40 flex flex-col items-center justify-center gap-2 rounded-lg border border-green-500/50 bg-[var(--color-bg-secondary)]">
                <span className="text-2xl">✓</span>
                <span className="text-[10px] text-green-400 font-medium">Connected</span>
              </div>
            ) : (
              <div className="rounded-lg overflow-hidden border border-[var(--color-border)] bg-white p-2">
                <img
                  src={`/api/whatsapp/qr.png?t=${qrNonce}`}
                  alt="WhatsApp pairing QR"
                  className="w-40 h-40"
                  style={{ imageRendering: 'pixelated' }}
                  onError={(e) => { e.target.style.opacity = 0.2; }}
                />
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={refresh} className="text-[10px] text-[var(--color-accent)] hover:underline">
                Refresh status
              </button>
              {!connected && (
                <button onClick={refreshQr} className="text-[10px] text-[var(--color-accent)] hover:underline">
                  Refresh QR
                </button>
              )}
            </div>
          </div>

          <ol className="space-y-2.5 text-xs text-[var(--color-text-muted)] pt-1">
            <li className="flex gap-2">
              <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold">1</span>
              Open WhatsApp on your phone → Settings → Linked devices
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold">2</span>
              Tap <strong className="text-[var(--color-text-secondary)]">Link a device</strong> and scan the QR
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 w-4 h-4 rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)] flex items-center justify-center text-[10px] font-bold">3</span>
              Once connected, every chat routes to the agent selected below
            </li>
          </ol>
        </div>
      )}

      <div className="pt-3 border-t border-[var(--color-border)]">
        <label className="text-xs font-semibold text-[var(--color-text-primary)] block mb-1">
          Agent — every WhatsApp chat routes here
        </label>
        <select
          value={currentTarget}
          onChange={(e) => onChange('whatsapp_default_target', e.target.value)}
          className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded px-2 py-1 text-[10px] text-[var(--color-text-primary)] font-mono w-full"
        >
          <option value="">— select an agent —</option>
          {agents.ap_agents.map((a) => (
            <option key={`agent:${a.slug}`} value={`agent:${a.slug}`}>Agent: {a.name}</option>
          ))}
          {agents.ap_workflows.map((w) => (
            <option key={`workflow:${w.slug}`} value={`workflow:${w.slug}`}>Workflow: {w.name}</option>
          ))}
        </select>
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
          Runs via agents-platform (:10005). New chats created after this is set pick it up automatically.
        </div>
      </div>

      <div className="pt-3 border-t border-[var(--color-border)]">
        <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)] cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(agentConfig.whatsapp_mark_read)}
            onChange={(e) => onChange('whatsapp_mark_read', e.target.checked)}
          />
          Mark messages as read (blue ticks)
        </label>
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1">
          Off by default — a read receipt tells the sender a human read their message, which isn't
          true here. Leave this off unless you want senders to see the message as read.
        </div>
      </div>
    </div>
  );
}

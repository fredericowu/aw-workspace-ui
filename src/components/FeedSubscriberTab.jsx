import { useState, useEffect } from 'react';
import { getAwConfig, saveAwConfig } from '../hooks/useComponentStatus';

const EMPTY_CARD = () => ({
  id: `feed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  name: '',
  source_url: '',
  poll_interval_seconds: 60,
  call_type: 'webhook',
  webhook_url: '',
  auth_token: '',
  agent_slug: '',
  target_slug: 'w-feed-subscriber',
});

export default function FeedSubscriberTab() {
  const [fullConfig, setFullConfig] = useState(null);
  const [cards, setCards] = useState([]);
  const [agents, setAgents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    getAwConfig().then((cfg) => {
      setFullConfig(cfg);
      setCards((cfg.feed_subscriber || {}).cards || []);
    });
    fetch('/api/whatsapp/agent-picker')
      .then((r) => r.json())
      .then((data) => setAgents(data.ap_agents || []))
      .catch(() => setAgents([]));
  }, []);

  const showMessage = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const updateCard = (id, field, value) => {
    setCards((prev) => prev.map((c) => (c.id === id
      ? { ...c, [field]: field === 'poll_interval_seconds' ? Number(value) || 0 : value }
      : c)));
  };

  const addCard = () => setCards((prev) => [...prev, EMPTY_CARD()]);
  const removeCard = (id) => setCards((prev) => prev.filter((c) => c.id !== id));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await saveAwConfig({ ...fullConfig, feed_subscriber: { cards } });
      if (!res.success) {
        showMessage(res.error || 'Error saving');
        return;
      }
      showMessage('Saved — run `./aw restart feed-subscriber` to apply');
    } finally {
      setSaving(false);
    }
  };

  if (!fullConfig) return <div className="p-6 text-[var(--color-text-muted)]">Loading...</div>;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Feed Subscriber</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Each card polls a JSON source URL on its own interval. When the response changes since the
            last poll, it fires a Webhook Call or an Agent Call with the new entry. Run as a separate
            process via <code>./aw start feed-subscriber</code>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className="text-xs text-[var(--color-text-muted)]">{message}</span>}
          <button onClick={addCard}
            className="px-3 py-1.5 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] transition-colors">
            + Add feed
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-xs rounded bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {cards.length === 0 && (
        <div className="text-xs text-[var(--color-text-muted)] italic">
          No feed subscriptions yet — click "+ Add feed" to create one.
        </div>
      )}

      <div className="space-y-4">
        {cards.map((card) => (
          <FeedCard
            key={card.id}
            card={card}
            agents={agents}
            onChange={(field, value) => updateCard(card.id, field, value)}
            onRemove={() => removeCard(card.id)}
          />
        ))}
      </div>
    </div>
  );
}

function FeedCard({ card, agents, onChange, onRemove }) {
  return (
    <div className="bg-[var(--color-bg-secondary)] rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <input
          value={card.name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder="Feed name"
          className="text-sm font-medium bg-transparent text-[var(--color-text-primary)] border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none px-1"
        />
        <button onClick={onRemove}
          className="text-xs text-[var(--color-text-muted)] hover:text-red-400 transition-colors">
          Remove
        </button>
      </div>

      <Field label="Source JSON URL" value={card.source_url}
        onChange={(v) => onChange('source_url', v)}
        placeholder="https://example.com/feed.json" />
      <Field label="Poll Interval (seconds)" value={card.poll_interval_seconds}
        onChange={(v) => onChange('poll_interval_seconds', v)}
        type="number" placeholder="60" />

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Call type</span>
        <select
          value={card.call_type}
          onChange={(e) => onChange('call_type', e.target.value)}
          className="mt-0.5 w-full bg-[var(--color-bg-primary)] text-sm text-[var(--color-text-primary)] border border-[var(--color-border)] rounded px-2 py-1.5 outline-none focus:border-[var(--color-accent)] transition-colors"
        >
          <option value="webhook">Webhook Call</option>
          <option value="agent">Agent Call</option>
        </select>
      </label>

      {card.call_type === 'agent' ? (
        <>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Agent</span>
            <select
              value={card.agent_slug}
              onChange={(e) => onChange('agent_slug', e.target.value)}
              className="mt-0.5 w-full bg-[var(--color-bg-primary)] text-sm text-[var(--color-text-primary)] border border-[var(--color-border)] rounded px-2 py-1.5 outline-none focus:border-[var(--color-accent)] transition-colors"
            >
              <option value="">Select an agent…</option>
              {agents.map((a) => (
                <option key={a.slug} value={a.slug}>{a.name || a.slug}</option>
              ))}
            </select>
          </label>
          <Field label="Target slug" value={card.target_slug}
            onChange={(v) => onChange('target_slug', v)}
            placeholder="w-feed-subscriber" />
        </>
      ) : (
        <>
          <Field label="Target Webhook URL" value={card.webhook_url}
            onChange={(v) => onChange('webhook_url', v)}
            placeholder="https://agents-platform.internal/api/webhooks/..." />
          <Field label="Auth Token (Bearer)" value={card.auth_token}
            onChange={(v) => onChange('auth_token', v)}
            type="password" placeholder="token used as Authorization: Bearer <token>" />
        </>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full bg-[var(--color-bg-primary)] text-sm text-[var(--color-text-primary)] border border-[var(--color-border)] rounded px-2 py-1.5 outline-none focus:border-[var(--color-accent)] transition-colors"
      />
    </label>
  );
}

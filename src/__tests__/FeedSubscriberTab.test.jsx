import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import FeedSubscriberTab from '../components/FeedSubscriberTab';

function mockFetchSequence({ awConfig, agents = [] }) {
  global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && url.includes('/api/whatsapp/agent-picker')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ap_agents: agents }) });
    }
    // /api/settings/aw — both GET (load) and PUT (save)
    return Promise.resolve({ ok: true, json: () => Promise.resolve(awConfig) });
  });
}

describe('FeedSubscriberTab', () => {
  beforeEach(() => {
    mockFetchSequence({ awConfig: { feed_subscriber: { cards: [] } } });
  });

  it('shows loading state before config resolves', () => {
    global.fetch = vi.fn(() => new Promise(() => {})); // never resolves
    render(<FeedSubscriberTab />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows empty state with no cards configured', async () => {
    render(<FeedSubscriberTab />);
    await waitFor(() => expect(screen.getByText(/no feed subscriptions yet/i)).toBeInTheDocument());
  });

  it('renders an existing card with its fields populated', async () => {
    mockFetchSequence({
      awConfig: {
        feed_subscriber: {
          cards: [{
            id: 'card-1', name: 'My Feed', source_url: 'https://example.com/feed.json',
            poll_interval_seconds: 30, call_type: 'webhook',
            webhook_url: 'https://hook.example.com', auth_token: 'tok123',
            agent_slug: '', target_slug: 'w-feed-subscriber',
          }],
        },
      },
    });
    render(<FeedSubscriberTab />);

    await waitFor(() => expect(screen.getByPlaceholderText('Feed name')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Feed name').value).toBe('My Feed');
    expect(screen.getByPlaceholderText('https://example.com/feed.json').value).toBe('https://example.com/feed.json');
    expect(screen.getByPlaceholderText('60').value).toBe('30');
    expect(screen.getByText('Target Webhook URL')).toBeInTheDocument();
    expect(screen.getByText('Auth Token (Bearer)')).toBeInTheDocument();
  });

  it('adds a new card when "+ Add feed" is clicked', async () => {
    render(<FeedSubscriberTab />);
    await waitFor(() => expect(screen.getByText(/no feed subscriptions yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /\+ Add feed/i }));

    await waitFor(() => expect(screen.getByPlaceholderText('Feed name')).toBeInTheDocument());
    expect(screen.queryByText(/no feed subscriptions yet/i)).not.toBeInTheDocument();
  });

  it('removes a card when Remove is clicked', async () => {
    mockFetchSequence({
      awConfig: {
        feed_subscriber: {
          cards: [{
            id: 'card-1', name: 'My Feed', source_url: '', poll_interval_seconds: 60,
            call_type: 'webhook', webhook_url: '', auth_token: '', agent_slug: '', target_slug: '',
          }],
        },
      },
    });
    render(<FeedSubscriberTab />);
    await waitFor(() => expect(screen.getByPlaceholderText('Feed name')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => expect(screen.getByText(/no feed subscriptions yet/i)).toBeInTheDocument());
  });

  it('editing the name field updates the input value', async () => {
    mockFetchSequence({
      awConfig: {
        feed_subscriber: {
          cards: [{
            id: 'card-1', name: '', source_url: '', poll_interval_seconds: 60,
            call_type: 'webhook', webhook_url: '', auth_token: '', agent_slug: '', target_slug: '',
          }],
        },
      },
    });
    render(<FeedSubscriberTab />);
    await waitFor(() => expect(screen.getByPlaceholderText('Feed name')).toBeInTheDocument());

    const nameInput = screen.getByPlaceholderText('Feed name');
    fireEvent.change(nameInput, { target: { value: 'Renamed Feed' } });

    expect(nameInput.value).toBe('Renamed Feed');
  });

  it('switching call_type to "agent" swaps the fields shown', async () => {
    mockFetchSequence({
      awConfig: {
        feed_subscriber: {
          cards: [{
            id: 'card-1', name: '', source_url: '', poll_interval_seconds: 60,
            call_type: 'webhook', webhook_url: '', auth_token: '', agent_slug: '', target_slug: '',
          }],
        },
      },
      agents: [{ slug: 'agent-x', name: 'Agent X' }],
    });
    render(<FeedSubscriberTab />);
    await waitFor(() => expect(screen.getByPlaceholderText('Feed name')).toBeInTheDocument());

    expect(screen.getByText('Target Webhook URL')).toBeInTheDocument();

    const select = screen.getByDisplayValue('Webhook Call');
    fireEvent.change(select, { target: { value: 'agent' } });

    await waitFor(() => expect(screen.getByText('Agent')).toBeInTheDocument());
    expect(screen.getByText('Target slug')).toBeInTheDocument();
    expect(screen.queryByText('Target Webhook URL')).not.toBeInTheDocument();
    expect(screen.getByText('Agent X')).toBeInTheDocument();
  });

  it('saves the config via PUT /api/settings/aw when Save is clicked', async () => {
    mockFetchSequence({
      awConfig: {
        feed_subscriber: {
          cards: [{
            id: 'card-1', name: 'Feed A', source_url: '', poll_interval_seconds: 60,
            call_type: 'webhook', webhook_url: '', auth_token: '', agent_slug: '', target_slug: '',
          }],
        },
      },
    });
    render(<FeedSubscriberTab />);
    await waitFor(() => expect(screen.getByPlaceholderText('Feed name')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const putCall = global.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = JSON.parse(putCall[1].body);
      expect(body.feed_subscriber.cards[0].name).toBe('Feed A');
    });
  });
});

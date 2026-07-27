import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import AppWindow from '../components/AppWindow';

// The PoC app's windows/main.json (kept in sync with
// aw-workspace/examples/apps/hello/windows/main.json).
const HELLO_SPEC = {
  title: 'Hello App',
  layout: 'single',
  regions: [
    {
      id: 'body',
      widgets: [
        { type: 'markdown', value: '# Hello 👋\nrendered from a declarative spec.' },
        { type: 'button', label: 'Ping backend', action: { call: 'GET /api/apps/hello/' } },
        { type: 'list', title: 'What this proves', items: ['a', 'b', 'c'] },
      ],
    },
  ],
};

describe('AppWindow (declarative renderer)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the window title and declarative widgets', () => {
    render(<AppWindow spec={HELLO_SPEC} />);
    expect(screen.getByRole('heading', { name: 'Hello App' })).toBeInTheDocument();
    // markdown heading
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello');
    // list items
    expect(screen.getByText('What this proves')).toBeInTheDocument();
    ['a', 'b', 'c'].forEach((t) => expect(screen.getByText(t)).toBeInTheDocument());
    // button
    expect(screen.getByRole('button', { name: 'Ping backend' })).toBeInTheDocument();
  });

  it('button action calls the app backend and shows the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ app: 'hello', ok: true, version: '1.0.0' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppWindow spec={HELLO_SPEC} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ping backend' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/apps/hello/', { method: 'GET' });
      expect(screen.getByTestId('appwin-result')).toHaveTextContent('"app": "hello"');
    });
  });

  it('renders nothing when spec is missing', () => {
    const { container } = render(<AppWindow spec={null} />);
    expect(container.firstChild).toBeNull();
  });
});

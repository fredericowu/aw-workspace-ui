import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import AppConfigBody from '../components/AppConfigBody';

const APP = {
  slug: 'google-workspace-mcp',
  name: 'Google Workspace MCP',
  version: '0.7.0',
  config_schema: {
    type: 'object',
    properties: {
      port: { type: 'integer', default: 8010 },
    },
  },
};

const WINDOW_SPEC = {
  title: 'Google Workspace MCP',
  regions: [{ id: 'body', widgets: [{ type: 'markdown', value: 'Connect Google Account' }] }],
};

function mockContributions(panelOverrides = {}) {
  apiFetch.mockImplementation((url) => {
    if (url === '/api/apps/-/contributions') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          settings: [{ app: 'google-workspace-mcp', window: 'main', ...panelOverrides }],
          windows: [{ app: 'google-workspace-mcp', id: 'main', body: { spec_data: WINDOW_SPEC } }],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

describe('AppConfigBody — settings_panel schema_form: "advanced"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps today\'s order (form above window) when the flag is absent', async () => {
    mockContributions();
    render(<AppConfigBody app={APP} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    expect(document.getElementById('appcfg-port')).toBeInTheDocument();
    // No collapsed "Advanced" wrapper — the schema form renders directly.
    expect(screen.queryByText('Advanced: server configuration')).toBeNull();
    expect(screen.getByText('Connect Google Account')).toBeInTheDocument();
  });

  it('renders the window first and the schema form collapsed under "Advanced" when the flag is set', async () => {
    mockContributions({ schema_form: 'advanced' });
    render(<AppConfigBody app={APP} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    const summary = screen.getByText('Advanced: server configuration');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    // The field still exists in the DOM (collapsed <details>, not unmounted).
    expect(document.getElementById('appcfg-port')).toBeInTheDocument();

    // Window content precedes the collapsed form in document order.
    const windowEl = screen.getByText('Connect Google Account');
    const detailsEl = summary.closest('details');
    expect(windowEl.compareDocumentPosition(detailsEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('passes the app slug as AppWindow appId so OAuth-complete events can bump this window', async () => {
    mockContributions({ schema_form: 'advanced' });
    const { container } = render(<AppConfigBody app={APP} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());
    expect(container.querySelector('[data-app-window]')).toBeInTheDocument();
  });
});

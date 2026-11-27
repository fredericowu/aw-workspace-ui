import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import AppConfigBody from '../components/AppConfigBody';
import { slotRegistry, windowBodySlot } from '../apps/slotRegistry';

const contributions = (slug) => ({
  settings: [{ app: slug, window: `${slug}.settings` }],
  windows: [{ app: slug, id: `${slug}.settings`, body: { type: 'component' } }],
});
function serve(slug) {
  apiFetch.mockImplementation((url) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(url === '/api/apps/-/contributions' ? contributions(slug) : {}),
  }));
}

beforeEach(() => vi.clearAllMocks());

describe('AppConfigBody — component-mode settings panel', () => {
  it('mounts the app panel from the window-body slot and hides the mcp-tools JSON fallback', async () => {
    serve('mcp-tools');
    const unmount = slotRegistry.mount(windowBodySlot('mcp-tools.settings'), {
      id: 'mcp-tools.panel', appId: 'mcp-tools', render: () => <div>MCP TOOLS PANEL</div>,
    });
    render(<AppConfigBody app={{ slug: 'mcp-tools', name: 'T', version: '1', config: {}, config_schema: { type: 'object', properties: { mcpServers: { type: 'object' } } } }} />);
    expect(await screen.findByText('MCP TOOLS PANEL')).toBeInTheDocument();
    expect(screen.queryByTestId('appcfg-json-editor')).toBeNull();
    act(() => unmount());
  });

  it('keeps the JSON editor fallback when nothing is mounted in the slot', async () => {
    serve('mcp-tools');
    render(<AppConfigBody app={{ slug: 'mcp-tools', name: 'T', version: '1', config: {}, config_schema: { type: 'object', properties: { mcpServers: { type: 'object' } } } }} />);
    expect(await screen.findByTestId('appcfg-json-editor')).toBeInTheDocument();
  });

  it('never renders or submits object/array properties (no stale-snapshot overwrite)', async () => {
    apiFetch.mockImplementation((url) => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve(url === '/api/apps/-/contributions' ? { settings: [], windows: [] } : {}),
    }));
    const app = {
      slug: 'feed-subscriber', name: 'F', version: '1',
      config: { base_url: 'http://x', cards: [{ id: 'a' }] },
      config_schema: { type: 'object', properties: {
        base_url: { type: 'string', title: 'Base URL' },
        cards: { type: 'array', title: 'Cards' },
      } },
    };
    render(<AppConfigBody app={app} />);
    await screen.findByLabelText('Base URL');
    expect(screen.queryByLabelText('Cards')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiFetch.mock.calls.some(([u]) => u === '/api/apps/feed-subscriber/config')).toBe(true));
    const call = apiFetch.mock.calls.find(([u]) => u === '/api/apps/feed-subscriber/config');
    const body = JSON.parse(call[1].body);
    expect(body.config).toEqual({ base_url: 'http://x' });
    expect(body.config).not.toHaveProperty('cards');
  });
});

import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import AppConfigBody from '../components/AppConfigBody';

const APP = { slug: 'gw', name: 'GW', version: '1', config_schema: { type: 'object', properties: {} } };
const spec = (text) => ({ regions: [{ id: 'b', widgets: [{ type: 'markdown', value: text }] }] });
function serve(text) {
  apiFetch.mockImplementation((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(url === '/api/apps/-/contributions'
      ? { settings: [{ app: 'gw', window: 'main' }], windows: [{ app: 'gw', id: 'main', body: { spec_data: spec(text) } }] }
      : {}),
  }));
}

describe('AppConfigBody follows aw-apps-changed (shell-owned, not one-shot)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-reads the app-authored settings window when the app is updated under it', async () => {
    serve('Panel v1');
    render(<AppConfigBody app={APP} />);
    expect(await screen.findByText('Panel v1')).toBeInTheDocument();

    serve('Panel v2');
    act(() => window.dispatchEvent(new CustomEvent('aw-apps-changed')));
    expect(await screen.findByText('Panel v2')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Panel v1')).toBeNull());
  });

  it('stops listening on unmount', async () => {
    serve('Panel v1');
    const { unmount } = render(<AppConfigBody app={APP} />);
    await screen.findByText('Panel v1');
    unmount();
    apiFetch.mockClear();
    window.dispatchEvent(new CustomEvent('aw-apps-changed'));
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

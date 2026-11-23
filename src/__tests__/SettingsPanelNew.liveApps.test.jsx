// The Settings window's APPS group is shell-owned: an install/uninstall done
// elsewhere (CLI, agent, another tab) must show up in it without a reload,
// the same way the Apps launcher does (aw-apps-changed, liveUiUpdates.js).
import { render, screen, waitFor, act } from '@testing-library/react';
import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import SettingsPanelNew from '../components/SettingsPanelNew';

const app = (slug, name) => ({ slug, name, has_config: true, config_schema: {} });
let installed;

beforeEach(() => {
  vi.clearAllMocks();
  installed = [app('alpha', 'Alpha App')];
  apiFetch.mockImplementation((url) => {
    if (url === '/api/apps') {
      return Promise.resolve({
        ok: true, headers: { get: () => null }, json: () => Promise.resolve(installed),
      });
    }
    return Promise.resolve({ ok: true, headers: { get: () => null }, json: () => Promise.resolve([]) });
  });
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve(''),
  }));
});

it('re-lists the Apps group in place on aw-apps-changed, no reload', async () => {
  render(<SettingsPanelNew />);
  expect(await screen.findByText('Alpha App')).toBeInTheDocument();
  expect(screen.queryByText('Beta App')).not.toBeInTheDocument();

  installed = [app('alpha', 'Alpha App'), app('beta', 'Beta App')];
  await act(async () => { window.dispatchEvent(new CustomEvent('aw-apps-changed', { detail: {} })); });

  await waitFor(() => expect(screen.getByText('Beta App')).toBeInTheDocument());

  installed = [app('beta', 'Beta App')];
  await act(async () => { window.dispatchEvent(new CustomEvent('aw-apps-changed', { detail: {} })); });
  await waitFor(() => expect(screen.queryByText('Alpha App')).not.toBeInTheDocument());
});

it('stops listening once the panel unmounts', async () => {
  const { unmount } = render(<SettingsPanelNew />);
  await screen.findByText('Alpha App');
  unmount();
  const before = apiFetch.mock.calls.filter(([u]) => u === '/api/apps').length;
  window.dispatchEvent(new CustomEvent('aw-apps-changed', { detail: {} }));
  await new Promise((r) => setTimeout(r, 50));
  expect(apiFetch.mock.calls.filter(([u]) => u === '/api/apps').length).toBe(before);
});

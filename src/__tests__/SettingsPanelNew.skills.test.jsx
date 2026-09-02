// Proves the 'skills' General section actually renders SkillsTab instead of
// the ComingSoon placeholder it showed before this section was wired up.
import { render, screen, fireEvent } from '@testing-library/react';
import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import SettingsPanelNew from '../components/SettingsPanelNew';

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockImplementation((url) => {
    if (url === '/api/skills') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve(''),
  }));
});

it('Skills opens SkillsTab, not the coming-soon placeholder', async () => {
  render(<SettingsPanelNew />);

  fireEvent.click(screen.getByRole('button', { name: /Skills/ }));

  expect(await screen.findByText(/No skills yet/)).toBeInTheDocument();
  expect(screen.queryByText(/coming soon/)).not.toBeInTheDocument();
});

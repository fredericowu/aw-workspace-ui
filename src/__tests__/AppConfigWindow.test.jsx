import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import AppConfigWindow from '../components/AppConfigWindow';

const GIT_APP = {
  slug: 'git',
  name: 'Git + GitHub CLI',
  version: '0.1.0',
  config_schema: {
    type: 'object',
    properties: {
      auth_method: { type: 'string', enum: ['token', 'web'], default: 'token' },
      github_token: { type: 'string', 'x-secret': true, description: 'PAT' },
      git_user_name: { type: 'string' },
    },
  },
};

describe('AppConfigWindow — schema-driven config window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no settings_panel window for this app (the fetchContributions
    // call AppConfigWindow always fires on mount to check for one). Tests
    // that care about the settings-submit call override with their own
    // mockResolvedValue and read the RIGHT call by URL, not by index, since
    // this contributions fetch is always call #1.
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  });

  it('renders fields from config_schema (secret → password, enum → select)', async () => {
    render(<AppConfigWindow app={GIT_APP} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());
    // secret field is a password input
    const token = document.getElementById('appcfg-github_token');
    expect(token).toHaveAttribute('type', 'password');
    // enum is a select defaulting to "token"
    const method = document.getElementById('appcfg-auth_method');
    expect(method.tagName).toBe('SELECT');
    expect(method.value).toBe('token');
  });

  it('submits the whole config object to the app settings route and shows Saved', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, logged_in: true }) });
    const onSaved = vi.fn();
    render(<AppConfigWindow app={GIT_APP} onClose={() => {}} onSaved={onSaved} />);
    await waitFor(() => expect(screen.queryByTestId('appcfg-loading')).not.toBeInTheDocument());

    fireEvent.change(document.getElementById('appcfg-github_token'), { target: { value: 'ghp_x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/apps/git/settings',
      expect.objectContaining({ method: 'POST' }),
    ));
    const settingsCall = apiFetch.mock.calls.find((c) => c[0] === '/api/apps/git/settings');
    const body = JSON.parse(settingsCall[1].body);
    expect(body).toMatchObject({ auth_method: 'token', github_token: 'ghp_x' });
    expect(await screen.findByTestId('appcfg-msg')).toHaveTextContent('Saved');
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows the empty state for an app with no configurable settings', async () => {
    render(<AppConfigWindow app={{ slug: 'essentials', name: 'Essentials', version: '0.1.0', config_schema: {} }} onClose={() => {}} />);
    expect(await screen.findByText(/no configurable settings/i)).toBeInTheDocument();
  });

  it('shows a spinner instead of the empty state while resolving whether the app has a settings window', () => {
    // Regression: the panel used to render the fields.length===0 "no
    // configurable settings" message immediately, then pop to the real
    // window once fetchContributions resolved — a visible flash/restyle.
    // The loading state must be up before that resolves.
    render(<AppConfigWindow app={{ slug: 'essentials', name: 'Essentials', version: '0.1.0', config_schema: {} }} onClose={() => {}} />);
    expect(screen.getByTestId('appcfg-loading')).toBeInTheDocument();
    expect(screen.queryByText(/no configurable settings/i)).not.toBeInTheDocument();
  });
});

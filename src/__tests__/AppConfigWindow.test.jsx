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
  beforeEach(() => vi.clearAllMocks());

  it('renders fields from config_schema (secret → password, enum → select)', () => {
    render(<AppConfigWindow app={GIT_APP} onClose={() => {}} />);
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

    fireEvent.change(document.getElementById('appcfg-github_token'), { target: { value: 'ghp_x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      '/api/apps/git/settings',
      expect.objectContaining({ method: 'POST' }),
    ));
    const body = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ auth_method: 'token', github_token: 'ghp_x' });
    expect(await screen.findByTestId('appcfg-msg')).toHaveTextContent('Saved');
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows the empty state for an app with no configurable settings', () => {
    render(<AppConfigWindow app={{ slug: 'essentials', name: 'Essentials', version: '0.1.0', config_schema: {} }} onClose={() => {}} />);
    expect(screen.getByText(/no configurable settings/i)).toBeInTheDocument();
  });
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../auth', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../auth';
import SkillsTab from '../components/SkillsTab';

function getJson(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

const NATIVE_SKILL = {
  name: 'aw-native-thing',
  description: 'A native skill this repo owns.',
  rel_path: 'skills/aw-native-thing/SKILL.md',
  editable: true,
  owner: null,
};

const APP_SKILL = {
  name: 'aw-from-crispal',
  description: 'Contributed by an installed app.',
  rel_path: 'skills/aw-from-crispal/SKILL.md',
  editable: false,
  owner: 'crispal',
};

describe('SkillsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.open = vi.fn();
    window.prompt = vi.fn();
    window.confirm = vi.fn(() => true);
  });

  it('lists both native and app-owned skills, with the app badge on the app-owned one', async () => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/skills') return getJson({ skills: [NATIVE_SKILL, APP_SKILL] });
      return getJson({});
    });

    render(<SkillsTab />);

    expect(await screen.findByText('aw-native-thing')).toBeInTheDocument();
    expect(screen.getByText('aw-from-crispal')).toBeInTheDocument();
    expect(screen.getByText('crispal')).toBeInTheDocument();
  });

  it('shows Delete only for the editable (native) skill, not the app-owned one', async () => {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/skills') return getJson({ skills: [NATIVE_SKILL, APP_SKILL] });
      return getJson({});
    });

    render(<SkillsTab />);
    await screen.findByText('aw-native-thing');

    expect(screen.getByTestId('skill-delete-aw-native-thing')).toBeInTheDocument();
    expect(screen.queryByTestId('skill-delete-aw-from-crispal')).not.toBeInTheDocument();
  });

  it('deleting a native skill calls DELETE /api/skills/{name} and refreshes the list', async () => {
    let deleted = false;
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/skills' && !opts) {
        return getJson({ skills: deleted ? [] : [NATIVE_SKILL] });
      }
      if (url === '/api/skills/aw-native-thing' && opts?.method === 'DELETE') {
        deleted = true;
        return getJson({ deleted: 'aw-native-thing' });
      }
      return getJson({});
    });

    render(<SkillsTab />);
    await screen.findByText('aw-native-thing');

    fireEvent.click(screen.getByTestId('skill-delete-aw-native-thing'));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/skills/aw-native-thing', { method: 'DELETE' });
    });
    await waitFor(() => {
      expect(screen.queryByText('aw-native-thing')).not.toBeInTheDocument();
    });
  });

  it('creating a skill posts name+description then opens it in code-server', async () => {
    window.prompt
      .mockReturnValueOnce('aw-brand-new') // name prompt
      .mockReturnValueOnce('A brand new skill.'); // description prompt
    let created = false;
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/skills' && opts?.method === 'POST') {
        created = true;
        return getJson({ name: 'aw-brand-new', path: '/opt/aw-workspace/native-skills/aw-brand-new/SKILL.md' });
      }
      if (url === '/api/skills' && !opts) {
        return getJson({ skills: created ? [{ ...NATIVE_SKILL, name: 'aw-brand-new' }] : [] });
      }
      if (url === '/api/skills/aw-brand-new/open' && opts?.method === 'POST') {
        return getJson({ name: 'aw-brand-new', url: '/api/apps/code-server/?folder=x' });
      }
      return getJson({});
    });

    render(<SkillsTab />);
    await screen.findByText(/No skills yet/);

    fireEvent.click(screen.getByTestId('skills-new'));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'aw-brand-new', description: 'A brand new skill.' }),
      });
    });
    await waitFor(() => expect(window.open).toHaveBeenCalled());
  });

  it('Sync now hits /api/agent/sync and shows a status summary', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (url === '/api/skills') return getJson({ skills: [NATIVE_SKILL] });
      if (url === '/api/agent/sync' && opts?.method === 'POST') {
        return getJson({
          skills: [{ target: '.claude/skills', added: ['x'], updated: [], deleted: [] }],
          mcp: [],
        });
      }
      return getJson({});
    });

    render(<SkillsTab />);
    await screen.findByText('aw-native-thing');

    fireEvent.click(screen.getByTestId('skills-sync-now'));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/agent/sync', { method: 'POST' });
    });
    await waitFor(() => {
      expect(screen.getByText(/skills: \+1/)).toBeInTheDocument();
    });
  });

  it('shows an empty state with no skills yet', async () => {
    apiFetch.mockImplementation(() => getJson({ skills: [] }));

    render(<SkillsTab />);

    expect(await screen.findByText(/No skills yet/)).toBeInTheDocument();
  });
});

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import FoldersSubmenu from '../components/FoldersSubmenu';

// The component's whole job is to drive /api/folders, so the fetch shim IS the
// contract under test — assert on the requests it makes, not on internals.
const apiFetch = vi.fn();
vi.mock('../auth', () => ({ apiFetch: (...args) => apiFetch(...args) }));

const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const fail = (status, detail) => Promise.resolve({
  ok: false, status, json: () => Promise.resolve({ detail }),
});

const FOLDERS = {
  folders: [
    { name: 'aw-docs', path: '/opt/aw-workspace/repos/agentic-workspace/docs', mode: 'ro', exists: true },
    { name: 'datasets', path: '/srv/datasets', mode: 'rw', exists: false },
  ],
};

beforeEach(() => {
  apiFetch.mockReset();
});

describe('Workspace > Folders', () => {
  it('lists mapped folders with their mode, and flags ones this process cannot see', async () => {
    apiFetch.mockImplementation(() => ok(FOLDERS));

    render(<FoldersSubmenu />);

    expect(await screen.findByText('aw-docs')).toBeInTheDocument();
    expect(screen.getByText('/opt/aw-workspace/repos/agentic-workspace/docs')).toBeInTheDocument();
    expect(screen.getByText('datasets')).toBeInTheDocument();
    expect(screen.getByText('rw')).toBeInTheDocument();
    // exists:false is informational (may be a host-only path), not an error.
    expect(screen.getByText('unverified')).toBeInTheDocument();
  });

  it('says so plainly when nothing is mapped', async () => {
    apiFetch.mockImplementation(() => ok({ folders: [] }));

    render(<FoldersSubmenu />);

    expect(await screen.findByText('Nothing mapped yet.')).toBeInTheDocument();
  });

  it('maps a typed absolute path — no repo, no name required', async () => {
    apiFetch.mockImplementation((url, opts) => {
      if (opts?.method === 'POST') return ok({ folder: {}, remapped_apps: ['kb'] });
      return ok({ folders: [] });
    });

    render(<FoldersSubmenu />);
    await screen.findByText('Nothing mapped yet.');

    fireEvent.change(screen.getByPlaceholderText('/absolute/path/to/folder'),
                     { target: { value: '/srv/notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));

    await waitFor(() => {
      const post = apiFetch.mock.calls.find(([, o]) => o?.method === 'POST');
      expect(post[0]).toBe('/api/folders');
      expect(JSON.parse(post[1].body)).toEqual({ path: '/srv/notes' });
    });
  });

  it('sends an explicit name when one is given', async () => {
    apiFetch.mockImplementation((url, opts) =>
      (opts?.method === 'POST' ? ok({ folder: {} }) : ok({ folders: [] })));

    render(<FoldersSubmenu />);
    await screen.findByText('Nothing mapped yet.');

    fireEvent.change(screen.getByPlaceholderText('/absolute/path/to/folder'),
                     { target: { value: '/srv/x' } });
    fireEvent.change(screen.getByPlaceholderText('name (optional)'),
                     { target: { value: 'data' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));

    await waitFor(() => {
      const post = apiFetch.mock.calls.find(([, o]) => o?.method === 'POST');
      expect(JSON.parse(post[1].body)).toEqual({ path: '/srv/x', name: 'data' });
    });
  });

  it('surfaces the server error instead of silently doing nothing', async () => {
    apiFetch.mockImplementation((url, opts) =>
      (opts?.method === 'POST'
        ? fail(400, 'path must be absolute (got \'docs\')')
        : ok({ folders: [] })));

    render(<FoldersSubmenu />);
    await screen.findByText('Nothing mapped yet.');

    fireEvent.change(screen.getByPlaceholderText('/absolute/path/to/folder'),
                     { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));

    expect(await screen.findByText(/path must be absolute/)).toBeInTheDocument();
  });

  it('unmaps by name', async () => {
    apiFetch.mockImplementation((url, opts) =>
      (opts?.method === 'DELETE' ? ok({ removed: 'aw-docs' }) : ok(FOLDERS)));

    render(<FoldersSubmenu />);
    await screen.findByText('aw-docs');

    fireEvent.click(screen.getByTitle('Unmap aw-docs'));

    await waitFor(() => {
      const del = apiFetch.mock.calls.find(([, o]) => o?.method === 'DELETE');
      expect(del[0]).toBe('/api/folders/aw-docs');
    });
  });

  it('browses real directories so a path can be picked, not recalled', async () => {
    apiFetch.mockImplementation((url) => {
      if (url.startsWith('/api/folders/-/browse')) {
        return ok({
          path: '/opt/aw-workspace',
          parent: '/opt',
          entries: [{ name: 'skills', path: '/opt/aw-workspace/skills' }],
        });
      }
      return ok({ folders: [] });
    });

    render(<FoldersSubmenu />);
    await screen.findByText('Nothing mapped yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }));

    expect(await screen.findByText('skills')).toBeInTheDocument();
    expect(screen.getByText('/opt/aw-workspace')).toBeInTheDocument();
  });
});

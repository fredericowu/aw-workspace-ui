// Search box behaviour on top of SettingsPanelNew's sidebar (D-summary in
// the settings-new-search-box Kanban card). Deliberately doesn't touch
// SettingsPanelNew.responsive.test.jsx — that file is the regression net for
// the mobile/narrow layout and must keep passing unedited.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import SettingsPanelNew from '../components/SettingsPanelNew';

function installMatchMedia(matches) {
  window.matchMedia = vi.fn(() => ({
    matches,
    media: '(max-width: 767px)',
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
}

const originalMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = originalMatchMedia; });

const APPS = [
  {
    slug: 'crispal',
    name: 'Crispal',
    description: 'Store assistant for a shoe shop.',
    has_config: true,
    icon: null,
    version: '1.0.0',
    config_schema: { properties: {} },
  },
];

beforeEach(() => {
  installMatchMedia(false);
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve(APPS), text: () => Promise.resolve(''),
  }));
});

async function renderPanel() {
  render(<SettingsPanelNew />);
  await screen.findByRole('button', { name: /Crispal/ });
}

function typeQuery(value) {
  fireEvent.change(screen.getByLabelText('Search settings'), { target: { value } });
}

describe('SettingsPanelNew — search box', () => {
  // A14 — nothing is hidden before the user has typed anything.
  it('renders every section and app with no query typed', async () => {
    await renderPanel();
    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Users/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Backup/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crispal/ })).toBeInTheDocument();
  });

  // A9 — typing a query force-expands a group the user had collapsed.
  it('auto-expands a collapsed group once a query is typed', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    expect(screen.queryByRole('button', { name: /Users/ })).not.toBeInTheDocument();

    typeQuery('users');
    expect(screen.getByRole('button', { name: /Users/ })).toBeInTheDocument();
  });

  // A8 — a "soon" section is still a searchable, visible row.
  it('a not-yet-migrated section is still searchable and shows its badge', async () => {
    await renderPanel();
    typeQuery('backup');
    expect(screen.getByRole('button', { name: /Backup/ })).toBeInTheDocument();
    expect(screen.getByText('soon')).toBeInTheDocument();
  });

  // A10 — a group with zero matches disappears entirely, header included —
  // it does not just collapse.
  it('hides a whole group, header included, when nothing in it matches', async () => {
    await renderPanel();
    typeQuery('crispal');
    expect(screen.queryByRole('button', { name: 'General' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apps/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crispal/ })).toBeInTheDocument();
  });

  // A11 — a query matching nothing anywhere shows a dedicated empty state,
  // instead of leaving the list silently blank.
  it('shows a zero-results message when nothing matches at all', async () => {
    await renderPanel();
    typeQuery('zzz-nonexistent-zzz');
    expect(screen.queryByRole('button', { name: 'General' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Apps/ })).not.toBeInTheDocument();
    expect(screen.getByText(/No settings match/)).toBeInTheDocument();
  });

  // A12 — clearing the query restores whatever expand/collapse state the
  // user had going into the search, not a fully-expanded default.
  it('restores the pre-search expand/collapse state once the query is cleared', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Apps/ }));
    expect(screen.queryByRole('button', { name: /Crispal/ })).not.toBeInTheDocument();

    typeQuery('users');
    expect(screen.queryByRole('button', { name: /Crispal/ })).not.toBeInTheDocument(); // Apps group hidden — no match

    typeQuery('');
    expect(screen.getByRole('button', { name: /Apps/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Crispal/ })).not.toBeInTheDocument(); // still collapsed, not re-expanded
  });
});

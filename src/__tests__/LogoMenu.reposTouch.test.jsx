// Regression for card 3d95bf3b-9510-8168-84ed-d080b8c835da: the "Repos" row
// inside the "Workspace" dropdown (now folded into the "❯ aw ⌄" LogoMenu
// dropdown, card 4185bf3b-9510-810b-b095-ef8341e8ae0a) only had onMouseEnter,
// so a real touch tap (confirmed via aw-apple-automation on the iOS
// Simulator) never opened the submenu — nothing reacts to touch, only mouse
// hover. Assert a plain click opens it (and toggles it closed again),
// without breaking the existing hover-to-open behavior desktop relies on.
import { render, screen, fireEvent } from '@testing-library/react';
import { it, expect, vi, describe } from 'vitest';

vi.mock('../auth', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ repos: [] }) })),
  wsUrl: vi.fn((path) => `ws://localhost${path}`),
  isAuthWsClose: vi.fn(() => false),
  notifyWsAuthFailed: vi.fn(),
}));
import LogoMenu from '../components/LogoMenu';

function baseProps() {
  return {
    onOpenSettings: vi.fn(),
    onLogout: vi.fn(),
    components: [],
    openWindows: new Set(),
    onToggleWindow: vi.fn(),
    onAction: vi.fn(),
    onOpenApp: vi.fn(),
    workspaceApps: [],
  };
}

describe('LogoMenu — Repos submenu opens by touch, not just hover', () => {
  it('a click on the Repos row opens the submenu', async () => {
    render(<LogoMenu {...baseProps()} />);
    fireEvent.click(screen.getByLabelText('Workspace menu'));

    fireEvent.click(screen.getByText('Repos'));

    expect(await screen.findByText(/Repositories/)).toBeInTheDocument();
  });

  it('clicking the Repos row again toggles the submenu closed', async () => {
    render(<LogoMenu {...baseProps()} />);
    fireEvent.click(screen.getByLabelText('Workspace menu'));

    fireEvent.click(screen.getByText('Repos'));
    await screen.findByText(/Repositories/);

    fireEvent.click(screen.getByText('Repos'));
    expect(screen.queryByText(/Repositories/)).not.toBeInTheDocument();
  });

  it('hovering the Repos row still opens it (desktop behavior unchanged)', async () => {
    render(<LogoMenu {...baseProps()} />);
    fireEvent.click(screen.getByLabelText('Workspace menu'));

    fireEvent.mouseEnter(screen.getByText('Repos'));

    expect(await screen.findByText(/Repositories/)).toBeInTheDocument();
  });
});

// Regression for card 3d95bf3b-9510-8168-84ed-d080b8c835da: the "Repos" row
// inside the "Workspace" dropdown only had onMouseEnter, so a real touch tap
// (confirmed via aw-apple-automation on the iOS Simulator) never opened the
// submenu — nothing reacts to touch, only mouse hover. Assert a plain click
// opens it (and toggles it closed again), without breaking the existing
// hover-to-open behavior desktop relies on.
import { render, screen, fireEvent } from '@testing-library/react';
import { it, expect, vi, describe } from 'vitest';

vi.mock('../auth', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ repos: [] }) })),
  wsUrl: vi.fn((path) => `ws://localhost${path}`),
  isAuthWsClose: vi.fn(() => false),
  notifyWsAuthFailed: vi.fn(),
}));
import WorkspaceNav from '../components/WorkspaceNav';

function baseProps() {
  return {
    components: [],
    openWindows: new Set(),
    onToggleWindow: vi.fn(),
    onAction: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenApp: vi.fn(),
    workspaceApps: [],
  };
}

describe('WorkspaceNav — Repos submenu opens by touch, not just hover', () => {
  it('a click on the Repos row opens the submenu', async () => {
    render(<WorkspaceNav {...baseProps()} />);
    fireEvent.click(screen.getByText('Workspace'));

    fireEvent.click(screen.getByText('Repos'));

    expect(await screen.findByText(/Repositories/)).toBeInTheDocument();
  });

  it('clicking the Repos row again toggles the submenu closed', async () => {
    render(<WorkspaceNav {...baseProps()} />);
    fireEvent.click(screen.getByText('Workspace'));

    fireEvent.click(screen.getByText('Repos'));
    await screen.findByText(/Repositories/);

    fireEvent.click(screen.getByText('Repos'));
    expect(screen.queryByText(/Repositories/)).not.toBeInTheDocument();
  });

  it('hovering the Repos row still opens it (desktop behavior unchanged)', async () => {
    render(<WorkspaceNav {...baseProps()} />);
    fireEvent.click(screen.getByText('Workspace'));

    fireEvent.mouseEnter(screen.getByText('Repos'));

    expect(await screen.findByText(/Repositories/)).toBeInTheDocument();
  });
});

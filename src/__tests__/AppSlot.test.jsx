import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AppSlot from '../apps/AppSlot';
import { createSlotRegistry } from '../apps/slotRegistry';

describe('AppSlot — reactive slot rendering + per-contribution ErrorBoundary', () => {
  it('renders contributions and re-renders on hot mount/unmount', () => {
    const registry = createSlotRegistry();
    render(<AppSlot slot="core.toolbar" registry={registry} fallback={<span>empty</span>} />);
    expect(screen.getByText('empty')).toBeInTheDocument();

    act(() => {
      registry.mount('core.toolbar', { id: 'a', appId: 'x', render: () => <button>Quick Add</button> });
    });
    expect(screen.getByRole('button', { name: 'Quick Add' })).toBeInTheDocument();

    act(() => registry.unmount('core.toolbar', 'a'));
    expect(screen.getByText('empty')).toBeInTheDocument();
  });

  it('a throwing contribution is caught inline and does not blank sibling contributions', () => {
    const registry = createSlotRegistry();
    const onError = vi.fn();
    const Boom = () => { throw new Error('kaboom'); };
    registry.mount('core.home.widgets', { id: 'ok', appId: 'good', render: () => <span>healthy</span> });
    registry.mount('core.home.widgets', { id: 'bad', appId: 'evil', render: () => <Boom /> });

    // silence the expected React error log for the boundary
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppSlot slot="core.home.widgets" registry={registry} onError={onError} />);
    err.mockRestore();

    expect(screen.getByText('healthy')).toBeInTheDocument(); // sibling survives
    expect(screen.getByTestId('app-contrib-error')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith('evil', expect.any(Error), expect.anything());
  });
});

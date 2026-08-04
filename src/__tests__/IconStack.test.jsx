import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import IconStack from '../components/IconStack';

const ITEMS = [
  { id: 'a', title: 'A', icon: <span>A-icon</span>, onClick: vi.fn() },
  { id: 'b', title: 'B', icon: <span>B-icon</span>, onClick: vi.fn() },
  { id: 'c', title: 'C', icon: <span>C-icon</span>, onClick: vi.fn() },
];

describe('IconStack — single trigger, downward dropdown on hover', () => {
  it('shows only the selected trigger and no dropdown when collapsed', () => {
    render(<IconStack items={ITEMS} selectedId="b" />);
    expect(screen.getByTitle('B')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    expect(screen.queryByText('C')).not.toBeInTheDocument();
  });

  it('falls back to the first item when selectedId matches nothing', () => {
    render(<IconStack items={ITEMS} selectedId="nope" />);
    expect(screen.getByTitle('A')).toBeInTheDocument();
  });

  it('opens a dropdown below the trigger on hover, listing every item', () => {
    render(<IconStack items={ITEMS} selectedId="b" />);
    fireEvent.mouseEnter(screen.getByTitle('B').parentElement);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('clicking the collapsed trigger runs its own action without opening the dropdown', () => {
    const items = ITEMS.map((i) => ({ ...i, onClick: vi.fn() }));
    render(<IconStack items={items} selectedId="b" />);
    fireEvent.click(screen.getByTitle('B'));
    expect(items[1].onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('picking a different item from the dropdown calls its action and onSelect with its id', () => {
    const items = ITEMS.map((i) => ({ ...i, onClick: vi.fn() }));
    const onSelect = vi.fn();
    render(<IconStack items={items} selectedId="b" onSelect={onSelect} />);
    fireEvent.mouseEnter(screen.getByTitle('B').parentElement);
    fireEvent.click(screen.getByText('C'));
    expect(items[2].onClick).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('closes the dropdown after picking an item', () => {
    render(<IconStack items={ITEMS} selectedId="b" />);
    fireEvent.mouseEnter(screen.getByTitle('B').parentElement);
    fireEvent.click(screen.getByText('C'));
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('closes on click-outside', () => {
    render(
      <div>
        <IconStack items={ITEMS} selectedId="b" />
        <button type="button">outside</button>
      </div>,
    );
    fireEvent.mouseEnter(screen.getByTitle('B').parentElement);
    expect(screen.getByText('A')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import IconStack from '../components/IconStack';

const ITEMS = [
  { id: 'a', title: 'A', icon: <span>A-icon</span>, onClick: vi.fn() },
  { id: 'b', title: 'B', icon: <span>B-icon</span>, onClick: vi.fn() },
  { id: 'c', title: 'C', icon: <span>C-icon</span>, onClick: vi.fn() },
];

describe('IconStack — collapsed row with hover-reveal', () => {
  it('shows only the selected item when collapsed', () => {
    render(<IconStack items={ITEMS} selectedId="b" />);
    expect(screen.getByTitle('B')).toBeInTheDocument();
    expect(screen.queryByTitle('A')).not.toBeInTheDocument();
    expect(screen.queryByTitle('C')).not.toBeInTheDocument();
  });

  it('falls back to the first item when selectedId matches nothing', () => {
    render(<IconStack items={ITEMS} selectedId="nope" />);
    expect(screen.getByTitle('A')).toBeInTheDocument();
  });

  it('reveals every item on hover, including the selected one', () => {
    render(<IconStack items={ITEMS} selectedId="b" />);
    fireEvent.mouseEnter(screen.getByTitle('B').parentElement);
    expect(screen.getByTitle('A')).toBeInTheDocument();
    expect(screen.getByTitle('B')).toBeInTheDocument();
    expect(screen.getByTitle('C')).toBeInTheDocument();
  });

  it('clicking the collapsed (visible) icon runs its own action without expanding', () => {
    const items = ITEMS.map((i) => ({ ...i, onClick: vi.fn() }));
    render(<IconStack items={items} selectedId="b" />);
    fireEvent.click(screen.getByTitle('B'));
    expect(items[1].onClick).toHaveBeenCalledTimes(1);
  });

  it('picking a different item while expanded calls its action and onSelect with its id', () => {
    const items = ITEMS.map((i) => ({ ...i, onClick: vi.fn() }));
    const onSelect = vi.fn();
    render(<IconStack items={items} selectedId="b" onSelect={onSelect} />);
    fireEvent.mouseEnter(screen.getByTitle('B').parentElement);
    fireEvent.click(screen.getByTitle('C'));
    expect(items[2].onClick).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('collapses back to one icon after picking while expanded', () => {
    render(<IconStack items={ITEMS} selectedId="b" />);
    const row = screen.getByTitle('B').parentElement;
    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByTitle('C'));
    // Still showing "b" as selectedId (parent owns that state — this test
    // doesn't re-render with a new selectedId) but the row must have
    // collapsed out of the open/expanded state regardless.
    expect(screen.queryByTitle('A')).not.toBeInTheDocument();
  });
});

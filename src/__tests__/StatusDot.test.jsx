import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import StatusDot from '../components/StatusDot';

describe('StatusDot', () => {
  it('renders with running status', () => {
    const { container } = render(<StatusDot status="running" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders with stopped status', () => {
    const { container } = render(<StatusDot status="stopped" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders with booting status', () => {
    const { container } = render(<StatusDot status="booting" />);
    expect(container.firstChild).toBeInTheDocument();
  });
});

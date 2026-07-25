import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import SettingsPanel from '../components/SettingsPanel';

describe('SettingsPanel', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          show_claude_prompts: false,
        }),
      })
    );
  });

  it('renders settings panel', () => {
    render(<SettingsPanel />);
    // Should have some settings content
    expect(document.querySelector('[class]')).toBeInTheDocument();
  });
});

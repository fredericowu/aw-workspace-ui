import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import TerminalWindow from '../components/TerminalWindow';
import {
  ANTIGRAVITY_AGENT,
  buildAntigravityCommand,
  withAntigravityAgent,
} from '../lib/agentClis';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (q) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
}

describe('code agent launcher definitions', () => {
  it('preserves Claude, Codex, Copilot and Cursor while adding Antigravity once', () => {
    const existing = [
      { type: 'claude' },
      { type: 'codex' },
      { type: 'copilot' },
      { type: 'cursor' },
    ];
    const result = withAntigravityAgent(existing);
    expect(result.map((agent) => agent.type)).toEqual([
      'claude', 'codex', 'copilot', 'cursor', 'antigravity',
    ]);
    expect(withAntigravityAgent(result)).toBe(result);
    expect(ANTIGRAVITY_AGENT).toMatchObject({
      label: 'Antigravity', command: 'agy', icon: 'antigravity',
    });
  });

  it('uses the official launch, resume and permission flags', () => {
    expect(buildAntigravityCommand()).toBe('agy');
    expect(buildAntigravityCommand(null, true)).toBe('agy --dangerously-skip-permissions');
    expect(buildAntigravityCommand('conv-123')).toBe('agy --conversation conv-123');
    expect(buildAntigravityCommand('conv-123', true)).toBe(
      'agy --conversation conv-123 --dangerously-skip-permissions',
    );
  });

  it('renders the secure/insecure toggle in Antigravity terminal headers', () => {
    const onToggleInsecure = vi.fn();
    const { getByRole, rerender } = render(
      React.createElement(TerminalWindow, {
        sessionId: 'agy-1',
        name: 'Antigravity - 1234',
        agentType: 'antigravity',
        insecure: false,
        onToggleInsecure,
      }),
    );

    const toggleBtn = getByRole('button', { name: 'insecure' });
    expect(toggleBtn.getAttribute('title')).toContain('--dangerously-skip-permissions');
    fireEvent.click(toggleBtn);
    expect(onToggleInsecure).toHaveBeenCalledWith('agy-1', true);

    rerender(
      React.createElement(TerminalWindow, {
        sessionId: 'agy-1',
        name: 'Antigravity - 1234',
        agentType: 'antigravity',
        insecure: true,
        onToggleInsecure,
      }),
    );
    expect(getByRole('button', { name: 'INSECURE' })).toBeTruthy();
  });
});

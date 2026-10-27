import { describe, expect, it } from 'vitest';
import {
  ANTIGRAVITY_AGENT,
  buildAntigravityCommand,
  withAntigravityAgent,
} from '../lib/agentClis';

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
    expect(buildAntigravityCommand('conv-123')).toBe('agy --conversation conv-123');
    expect(buildAntigravityCommand('conv-123', true)).toBe(
      'agy --conversation conv-123 --dangerously-skip-permissions',
    );
  });
});

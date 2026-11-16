import { describe, expect, it } from 'vitest';
import {
  ANTIGRAVITY_AGENT,
  buildAgentCommand,
  buildAntigravityCommand,
  getInsecureTooltip,
  supportsInsecureMode,
  withAntigravityAgent,
} from '../lib/agentClis';

describe('code agent launcher definitions and decoupled bridge', () => {
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
    expect(buildAgentCommand('antigravity', 'conv-123', true)).toBe(
      'agy --conversation conv-123 --dangerously-skip-permissions',
    );
    expect(supportsInsecureMode('antigravity')).toBe(true);
    expect(getInsecureTooltip('antigravity', false)).toContain('--dangerously-skip-permissions');
    expect(getInsecureTooltip('antigravity', true)).toBe('Insecure mode ON — click to disable');
    expect(supportsInsecureMode('opencode')).toBe(true);
    expect(getInsecureTooltip('opencode', false)).toContain('--auto');
  });

  it('delegates to window.__awCodeAgentClis when the plugin is loaded', () => {
    const prev = window.__awCodeAgentClis;
    window.__awCodeAgentClis = {
      buildAgentCommand: (type, resumeId, insecure) => `${type}:${resumeId}:${insecure}`,
      supportsInsecureMode: (type) => type === 'antigravity',
      getInsecureTooltip: (type) => `plugin-tooltip:${type}`,
    };
    try {
      expect(buildAgentCommand('antigravity', 'c-1', true)).toBe('antigravity:c-1:true');
      expect(supportsInsecureMode('antigravity')).toBe(true);
      expect(getInsecureTooltip('antigravity', false)).toBe('plugin-tooltip:antigravity');
    } finally {
      window.__awCodeAgentClis = prev;
    }
  });
});

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TerminalWindow from '../components/TerminalWindow';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    });
  }
});

afterEach(cleanup);

describe('TerminalWindow OpenCode chrome', () => {
  it('uses the OpenCode icon and session-picker label', () => {
    render(<TerminalWindow sessionId="opencode-session" name="OpenCode session" agentType="opencode" />);

    expect(screen.getByLabelText('OpenCode')).toBeTruthy();
    expect(screen.getByTitle('Switch OpenCode session')).toBeTruthy();
    expect(screen.queryByTitle('Switch Claude session')).toBeNull();
  });
});

import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import WindowManager from '../components/WindowManager';

// Real Rnd swallows the style prop in jsdom — keep it on a plain div so the
// z-index (the only thing that actually decides what's in front) is assertable.
vi.mock('react-rnd', () => ({
  Rnd: ({ children, style }) => (
    <div data-testid="rnd" style={style}>{children}</div>
  ),
}));

beforeEach(() => {
  localStorage.clear();
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

const SPECS = {
  'appwin:tasks.main': {
    id: 'tasks.main', app: 'tasks', title: 'Tasks', icon: 'clock',
    body: { type: 'managed_app', kind: 'tasks', path: '/ui' },
  },
  'appwin:whiteboard.main': {
    id: 'whiteboard.main', app: 'whiteboard', title: 'Whiteboard', icon: 'square',
    body: { type: 'managed_app', kind: 'whiteboard', path: '/ui' },
  },
};

function renderWM(props) {
  return render(
    <WindowManager
      openWindows={new Set(Object.keys(SPECS))}
      components={[]}
      terminals={[]}
      maxLines={200}
      onCloseWindow={vi.fn()}
      onReopenWindow={vi.fn()}
      onMinimizeWindow={vi.fn()}
      onMaximize={vi.fn()}
      maximizedKey={null}
      onAction={vi.fn()}
      onRenameTerminal={vi.fn()}
      onSessionSwitch={vi.fn()}
      claudeSessionIds={[]}
      copilotSessionIds={[]}
      insecureMap={{}}
      onToggleInsecure={vi.fn()}
      aiAgents={[]}
      workspaceApps={[]}
      appWindowSpecs={SPECS}
      {...props}
    />
  );
}

const zIndexes = (container) =>
  [...container.querySelectorAll('[data-testid="rnd"]')]
    .map((el) => Number(el.style.zIndex));

describe('WindowManager focusTriggers', () => {
  // The regression: clicking a menu item for an ALREADY-OPEN window did
  // nothing, because openWindows is a Set (re-adding is a no-op) and only a
  // bumped focus trigger reorders zOrder. App.jsx now bumps a trigger keyed by
  // the full window key on every open path, including app-contributed
  // `appwin:*` windows, which were never in the old hand-written trigger list.
  it('raises an already-open appwin window when its trigger counter is bumped', async () => {
    const onWindowFocus = vi.fn();
    const { container, rerender, ...rest } = renderWM({
      onWindowFocus,
      focusTriggers: [],
    });
    void rest;

    await waitFor(() => expect(zIndexes(container).length).toBe(2));
    const before = zIndexes(container);

    // A key appearing in the list for the first time, exactly how a freshly
    // clicked app window arrives from App.jsx's windowFocusTriggers map.
    rerender(
      <WindowManager
        openWindows={new Set(Object.keys(SPECS))}
        components={[]}
        terminals={[]}
        maxLines={200}
        onCloseWindow={vi.fn()}
        onReopenWindow={vi.fn()}
        onMinimizeWindow={vi.fn()}
        onMaximize={vi.fn()}
        maximizedKey={null}
        onAction={vi.fn()}
        onRenameTerminal={vi.fn()}
        onSessionSwitch={vi.fn()}
        claudeSessionIds={[]}
        copilotSessionIds={[]}
        insecureMap={{}}
        onToggleInsecure={vi.fn()}
        onWindowFocus={onWindowFocus}
        aiAgents={[]}
        workspaceApps={[]}
        appWindowSpecs={SPECS}
        focusTriggers={[{ key: 'appwin:tasks.main', counter: 1 }]}
      />
    );

    await waitFor(() => {
      expect(onWindowFocus).toHaveBeenCalledWith('appwin:tasks.main');
    });

    // Tasks must now be the topmost window, not merely re-rendered.
    const after = zIndexes(container);
    const tasksIdx = 0; // SPECS insertion order — tasks renders first
    expect(Math.max(...after)).toBe(after[tasksIdx]);
    expect(after).not.toEqual(before);
  });
});

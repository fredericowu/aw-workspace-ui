import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import WindowManager from '../components/WindowManager';

vi.mock('react-rnd', () => ({
  Rnd: ({ children }) => <div>{children}</div>,
}));

beforeEach(() => {
  localStorage.clear();
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
});

describe('WindowManager managed_app chrome', () => {
  it('renders managed app windows with the full app proxy controls', async () => {
    render(
      <WindowManager
        openWindows={new Set(['appwin:browser.main'])}
        components={[{ key: 'docker:aw-browser', status: 'running' }]}
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
        onWindowFocus={vi.fn()}
        presentations={[]}
        diffs={{}}
        aiAgents={[]}
        workspaceApps={[]}
        appWindowSpecs={{
          'appwin:browser.main': {
            id: 'browser.main',
            app: 'browser',
            title: 'Browser',
            icon: 'globe',
            body: {
              type: 'managed_app',
              kind: 'browser',
              path: '/vnc.html?autoconnect=true&resize=remote',
            },
          },
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle('Start container')).toBeInTheDocument();
    });
    expect(screen.getByTitle('Restart component')).toBeInTheDocument();
    expect(screen.getByTitle('Stop container')).toBeInTheDocument();
    expect(screen.getByTitle('Reload iframe (refresh the embedded app — does not restart the container)')).toBeInTheDocument();
    expect(screen.getByTitle('Pop out to new window')).toBeInTheDocument();
    expect(screen.getByTitle('Maximize')).toBeInTheDocument();
    expect(screen.getByTitle('Close')).toBeInTheDocument();
  });

  it('resolves the docker:<appId> component convention for managed app controls', async () => {
    render(
      <WindowManager
        openWindows={new Set(['appwin:browser.main'])}
        components={[{ key: 'docker:browser', status: 'running' }]}
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
        onWindowFocus={vi.fn()}
        presentations={[]}
        diffs={{}}
        aiAgents={[]}
        workspaceApps={[]}
        appWindowSpecs={{
          'appwin:browser.main': {
            id: 'browser.main',
            app: 'browser',
            title: 'Browser',
            icon: 'globe',
            body: {
              type: 'managed_app',
              kind: 'browser',
              path: '/vnc.html?autoconnect=true&resize=remote',
            },
          },
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle('Start container')).toBeInTheDocument();
    });
    expect(screen.getByTitle('Restart component')).toBeInTheDocument();
    expect(screen.getByTitle('Stop container')).toBeInTheDocument();
    expect(screen.getByTitle('Show component logs')).toBeInTheDocument();
  });
});

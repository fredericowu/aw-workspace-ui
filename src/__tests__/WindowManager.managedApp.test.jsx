import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import WindowManager from '../components/WindowManager';

const componentActions = vi.hoisted(() => ({
  startComponent: vi.fn(),
  stopComponent: vi.fn(),
  restartComponent: vi.fn(),
}));

vi.mock('../hooks/useComponentStatus', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    startComponent: componentActions.startComponent,
    stopComponent: componentActions.stopComponent,
    restartComponent: componentActions.restartComponent,
  };
});

vi.mock('react-rnd', () => ({
  Rnd: ({ children }) => <div>{children}</div>,
}));

beforeEach(() => {
  localStorage.clear();
  componentActions.startComponent.mockReset();
  componentActions.stopComponent.mockReset();
  componentActions.restartComponent.mockReset();
  componentActions.startComponent.mockResolvedValue({});
  componentActions.stopComponent.mockResolvedValue({});
  componentActions.restartComponent.mockResolvedValue({});
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

  it('restarts the backing component without closing managed app windows', async () => {
    const onCloseWindow = vi.fn();
    const onReopenWindow = vi.fn();

    render(
      <WindowManager
        openWindows={new Set(['appwin:browser.main'])}
        components={[{ key: 'docker:browser', status: 'running' }]}
        terminals={[]}
        maxLines={200}
        onCloseWindow={onCloseWindow}
        onReopenWindow={onReopenWindow}
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

    fireEvent.click(await screen.findByTitle('Restart component'));

    await waitFor(() => {
      expect(componentActions.restartComponent).toHaveBeenCalledWith('docker:browser');
    });
    expect(onCloseWindow).not.toHaveBeenCalled();
    expect(onReopenWindow).not.toHaveBeenCalled();
    expect(screen.getByTitle('Restart component')).toBeInTheDocument();
  });

  // aw-app-proxy is `tier: inprocess` with no `runtime.standalone` block —
  // it has no separate process of its own (its routes/service subprocess
  // are owned by the aw-workspace process itself), so the backend reports
  // `standalone_app: false` on its `/api/components` row. Start/Stop/Restart
  // are meaningless here and must NOT render, but the logs toggle (and the
  // log stream itself) should still work — a log stream can exist for a
  // non-standalone app too.
  it('hides Start/Stop/Restart for a non-standalone (standalone_app: false) component but keeps logs', async () => {
    render(
      <WindowManager
        openWindows={new Set(['appwin:proxy.logs'])}
        components={[{ key: 'service:proxy:proxy-server', status: 'running', standalone_app: false }]}
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
        aiAgents={[]}
        workspaceApps={[]}
        appWindowSpecs={{
          'appwin:proxy.logs': {
            id: 'proxy.logs',
            app: 'proxy',
            title: 'AW Proxy',
            body: {
              type: 'managed_app',
              component: 'service:proxy:proxy-server',
            },
          },
        }}
      />
    );

    // Logs toggle is present (component is set) ...
    await waitFor(() => {
      expect(screen.getByTitle('Show component logs')).toBeInTheDocument();
    });
    // ... but the process-control trio is not, since standalone_app is false.
    expect(screen.queryByTitle('Start container')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Restart component')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Stop container')).not.toBeInTheDocument();

    // Reload iframe / pop-out / maximize / close stay available regardless.
    expect(screen.getByTitle('Maximize')).toBeInTheDocument();
    expect(screen.getByTitle('Close')).toBeInTheDocument();
  });

  it('shows Start/Stop/Restart when standalone_app is true (or unset, for back-compat)', async () => {
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
        aiAgents={[]}
        workspaceApps={[]}
        appWindowSpecs={{
          'appwin:browser.main': {
            id: 'browser.main',
            app: 'browser',
            title: 'Browser',
            icon: 'globe',
            body: { type: 'managed_app', kind: 'browser', path: '/vnc.html' },
          },
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle('Start container')).toBeInTheDocument();
    });
    expect(screen.getByTitle('Restart component')).toBeInTheDocument();
    expect(screen.getByTitle('Stop container')).toBeInTheDocument();
  });
});

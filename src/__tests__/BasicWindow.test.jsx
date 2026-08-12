import { render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';

import BasicWindow, { specFromManagedWindow } from '../components/BasicWindow';
import { slotRegistry } from '../apps/slotRegistry';

describe('BasicWindow managed_app contract', () => {
  it('turns a managed app window declaration into a core-owned app iframe spec', () => {
    const spec = specFromManagedWindow({
      app: 'browser',
      title: 'Browser',
      body: {
        type: 'managed_app',
        kind: 'browser',
        path: '/vnc.html?autoconnect=true&resize=remote',
      },
    });

    expect(spec).toEqual({
      layout: 'stack',
      regions: [{
        id: 'main',
        widgets: [{
          type: 'app_iframe',
          title: 'Browser',
          app_id: 'browser',
          path: '/vnc.html?autoconnect=true&resize=remote',
        }],
      }],
    });
  });

  it('returns null for non-managed declarative windows', () => {
    expect(specFromManagedWindow({
      app: 'git',
      body: { type: 'declarative', spec_data: { regions: [] } },
    })).toBeNull();
  });
});

describe('BasicWindow title-bar action slot', () => {
  // AppSlot reads the module singleton, so mount into that — this exercises
  // the real BasicWindow -> AppSlot -> registry wiring, not a stand-in.
  afterEach(() => slotRegistry.unmountApp('whiteboard'));

  function mountActions() {
    slotRegistry.mount('core.window.titlebar:whiteboard.main', {
      id: 'wb:actions',
      appId: 'whiteboard',
      render: () => <button type="button">Export as PNG</button>,
    });
  }

  function renderWindow() {
    return render(
      <BasicWindow
        title="Whiteboard"
        windowKey="app:whiteboard.main"
        windowSpec={{ id: 'whiteboard.main', body: { type: 'component' } }}
        onClose={() => {}}
        onMaximize={() => {}}
      />,
    );
  }

  it("renders an app's registered buttons inside the host header", () => {
    mountActions();
    renderWindow();
    expect(screen.getByRole('button', { name: 'Export as PNG' })).toBeTruthy();
  });

  it("still renders exactly one Maximize — the host's own", () => {
    mountActions();
    renderWindow();
    expect(screen.getAllByTitle('Maximize')).toHaveLength(1);
  });

  it('puts the app buttons BEFORE the generic maximize/close pair', () => {
    mountActions();
    const { container } = renderWindow();
    const labels = [...container.querySelectorAll('.no-drag button')]
      .map((b) => b.textContent || b.getAttribute('title'));
    expect(labels).toEqual(['Export as PNG', 'Maximize', 'Close']);
  });

  it('is purely additive: a window with no registered actions is unchanged', () => {
    renderWindow();
    expect(screen.getByTitle('Maximize')).toBeTruthy();
    expect(screen.getByTitle('Close')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export as PNG' })).toBeNull();
  });
});

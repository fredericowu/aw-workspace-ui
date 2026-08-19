// Regression cover for the 2026-08-19 bug: the decoupled-apps plugin runtime
// was booted from an effect inside AuthenticatedApp — the DESKTOP shell only.
// App() returns either <MobileApp/> or <AuthenticatedApp/>, never both, so on
// mobile no app bundle was ever fetched and every `core.window.body:<id>` slot
// MobileApp renders (presentations.viewer, diff-tool.viewer) resolved to zero
// contributions and painted an empty window.
//
// The load-bearing assertion is the LAST describe block: MobileApp must boot
// the runtime. The rest pins the hook's own contract so the shared extraction
// can't quietly lose a behaviour the desktop shell depended on.
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchContributions: vi.fn(),
  wireContributions: vi.fn(),
}));

vi.mock('../apps/appsApi', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchContributions: mocks.fetchContributions,
}));

vi.mock('../apps/wireContributions', async (importOriginal) => ({
  ...(await importOriginal()),
  wireContributions: mocks.wireContributions,
}));

vi.mock('../hooks/useComponentStatus', async (importOriginal) => ({
  ...(await importOriginal()),
  useComponentStatus: () => ({ components: [], refetch: vi.fn() }),
  getAwConfig: () => Promise.resolve({}),
}));

import { usePluginContributions } from '../apps/usePluginContributions';
import MobileApp from '../components/MobileApp';

const CONTRIBUTIONS = { nav: [], windows: [], frontend: [] };

function Harness(props) {
  usePluginContributions(props);
  return <div data-testid="harness" />;
}

beforeEach(() => {
  delete window.__AW_PLUGIN_HOST__;
  mocks.fetchContributions.mockReset().mockResolvedValue(CONTRIBUTIONS);
  mocks.wireContributions.mockReset().mockImplementation(async () => {
    const dispose = vi.fn();
    dispose.incomplete = false;
    return dispose;
  });
});

afterEach(() => {
  delete window.__AW_PLUGIN_HOST__;
});

describe('usePluginContributions', () => {
  it('installs the plugin host and wires the fetched contributions on mount', async () => {
    render(<Harness />);

    await waitFor(() => expect(mocks.wireContributions).toHaveBeenCalledTimes(1));
    // installPluginHost() alone fills no slot — it only builds this global.
    // wireContributions() is what fetches each bundle and runs register(host),
    // which is the step that actually mounts anything into the registry. Both
    // must happen, in that order.
    expect(window.__AW_PLUGIN_HOST__).toBeTruthy();
    expect(mocks.wireContributions).toHaveBeenCalledWith(
      CONTRIBUTIONS,
      window.__AW_PLUGIN_HOST__,
      expect.objectContaining({ onOpenWindow: expect.any(Function) }),
    );
  });

  it('exposes the fetched contributions on the returned ref', async () => {
    let ref;
    function Peek() {
      ref = usePluginContributions();
      return null;
    }
    render(<Peek />);
    await waitFor(() => expect(ref.current).toEqual(CONTRIBUTIONS));
  });

  it('runs onFirstLoad exactly once, not on every refresh', async () => {
    const onFirstLoad = vi.fn();
    render(<Harness onFirstLoad={onFirstLoad} />);
    await waitFor(() => expect(onFirstLoad).toHaveBeenCalledWith(CONTRIBUTIONS));

    // A refresh with an unchanged signature must not re-run the rehydration —
    // it would reopen windows the user has since closed.
    mocks.fetchContributions.mockResolvedValue({ ...CONTRIBUTIONS });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(mocks.wireContributions).toHaveBeenCalledTimes(1));
    expect(onFirstLoad).toHaveBeenCalledTimes(1);
  });

  it('rewires when the contributions actually change', async () => {
    render(<Harness />);
    await waitFor(() => expect(mocks.wireContributions).toHaveBeenCalledTimes(1));

    mocks.fetchContributions.mockResolvedValue({
      nav: [{ app: 'git', id: 'git.nav', label: 'Git', opens: 'git.main' }],
      windows: [], frontend: [],
    });
    await act(async () => { window.dispatchEvent(new Event('aw-apps-changed')); });
    await waitFor(() => expect(mocks.wireContributions).toHaveBeenCalledTimes(2));
    // Second generation is handed the first's disposer to swap out in one tick.
    expect(mocks.wireContributions.mock.calls[1][2].replace).toBeTypeOf('function');
  });

  it('forwards every onOpenWindow argument (windowId AND app slug)', async () => {
    const onOpenWindow = vi.fn();
    render(<Harness onOpenWindow={onOpenWindow} />);
    await waitFor(() => expect(mocks.wireContributions).toHaveBeenCalledTimes(1));

    mocks.wireContributions.mock.calls[0][2].onOpenWindow('git.main', 'git');
    expect(onOpenWindow).toHaveBeenCalledWith('git.main', 'git');
  });

  it('disposes the wiring on unmount', async () => {
    const { unmount } = render(<Harness />);
    await waitFor(() => expect(mocks.wireContributions).toHaveBeenCalledTimes(1));
    const dispose = await mocks.wireContributions.mock.results[0].value;

    unmount();
    expect(dispose).toHaveBeenCalled();
  });

  it('does not wire twice when two shells are mounted at once', async () => {
    // The slot registry is a process-wide singleton, so a concurrent second
    // wiring would double-mount every contribution.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<div><Harness /><Harness /></div>);

    await waitFor(() => expect(mocks.wireContributions).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already wired'));
    warn.mockRestore();
  });

  it('re-wires after the previous shell unmounts (mobile/desktop swap)', async () => {
    // isMobile is reactive (resize / #mobile / #desktop hashchange), so the two
    // shells DO swap inside one session — the guard above must not leave the
    // second shell permanently unwired.
    const first = render(<Harness />);
    await waitFor(() => expect(mocks.wireContributions).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<Harness />);
    await waitFor(() => expect(mocks.wireContributions).toHaveBeenCalledTimes(2));
  });

  it('leaves the shell unchanged when the workspace API is unreachable', async () => {
    mocks.fetchContributions.mockRejectedValue(new Error('offline'));
    render(<Harness />);
    await act(async () => {});
    expect(mocks.wireContributions).not.toHaveBeenCalled();
    expect(screen.getByTestId('harness')).toBeInTheDocument();
  });
});

describe('MobileApp boots the plugin runtime', () => {
  // THE regression. Before this fix MobileApp rendered
  // `<AppSlot slot={windowBodySlot('presentations.viewer')} />` while nothing
  // on the mobile route had ever fetched a single app bundle, so the slot was
  // permanently empty and the window painted black. Asserting on the shell
  // (not the hook) is deliberate: the hook was never the broken part — the
  // mobile shell simply never called it.
  it('installs the host and wires contributions on mount', async () => {
    render(<MobileApp />);

    await waitFor(() => expect(mocks.wireContributions).toHaveBeenCalledTimes(1));
    expect(window.__AW_PLUGIN_HOST__).toBeTruthy();
    expect(mocks.fetchContributions).toHaveBeenCalled();
  });
});

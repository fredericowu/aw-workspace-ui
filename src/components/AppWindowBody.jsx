import AppWindow from './AppWindow';
import ErrorBoundary from './ErrorBoundary';
import AppSlot from '../apps/AppSlot';
import { windowBodySlot } from '../apps/slotRegistry';

// Extracted out of BasicWindow.jsx so any shell can render an app's window
// body generically — component-mode via AppSlot, everything else
// (declarative + managed_app) via AppWindow's spec-driven widgets — without
// re-deriving BasicWindow's own chrome (drag/resize/maximize/close). This is
// what lets mobile open the ~15 apps that aren't `managed_app` today.
export function specFromManagedWindow(windowSpec) {
  const body = windowSpec?.body || {};
  if (body.type !== 'managed_app') return null;
  const appId = body.app_id || windowSpec?.app;
  if (!appId) return null;
  return {
    layout: 'stack',
    regions: [
      {
        id: 'main',
        widgets: [
          {
            type: 'app_iframe',
            title: windowSpec?.title || appId,
            app_id: appId,
            path: body.path || '/',
          },
        ],
      },
    ],
  };
}

export default function AppWindowBody({ windowSpec, spec, slotProps = {} }) {
  const isComponent = windowSpec?.body?.type === 'component';
  const resolvedSpec = spec || specFromManagedWindow(windowSpec);
  return (
    <ErrorBoundary label={windowSpec?.title || 'App'}>
      {isComponent
        ? <AppSlot slot={windowBodySlot(windowSpec.id)} props={slotProps} />
        : <AppWindow spec={resolvedSpec} onFocus={slotProps.onFocus} isFocused={slotProps.isFocused ?? true} />}
    </ErrorBoundary>
  );
}

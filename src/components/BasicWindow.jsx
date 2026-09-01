import AppIcon from './AppIcon';
import AppSlot from '../apps/AppSlot';
import AppWindowBody, { specFromManagedWindow } from './AppWindowBody';
import { windowTitlebarSlot } from '../apps/slotRegistry';

export { specFromManagedWindow };

// Real WindowManager-integrated chrome (drag/resize/maximize/close, same
// header pattern as DiffWindow/PresentationWindow) for ANY decoupled app's
// window (aw-app.json's contributes.windows[].body.type: "declarative" |
// "managed_app" | "component"). aw-workspace-ui owns this generic shell
// ONLY — no app-specific window ever lives here (2026-08-04 decision): a
// WhiteboardWindow.jsx or TasksWindow.jsx belongs in that app's own repo,
// registered via host.registerWindow(windowId, Component) into this
// window's core.window.body:<id> slot, rendered below for "component" mode.
// declarative/managed_app modes render via AppWindow's spec-driven widgets
// instead — no app code enters the SPA for those two.
//
// Before this existed, opening a declarative window (via a nav entry's
// onOpenWindow, or an Installed Apps row click) rendered a small ad-hoc
// centered modal in App.jsx instead — no drag, no resize, no maximize, not
// part of the window-manager's z-order/persisted-position system every
// other window type gets for free. That modal was originally built for
// tiny single-action popups (e.g. aw-app-git's "Sign in with GitHub"), not
// a full app UI — confirmed as the wrong fit for aw-app-whiteboard's window
// (2026-07-28).
export default function BasicWindow({ title, spec, windowSpec, onClose, onMaximize, isMaximized, windowKey, onFocus, isFocused = true, onTitleChange }) {
  const isComponent = windowSpec?.body?.type === 'component';
  // Only a real declarative spec gets the body gutter (see .is-declarative in
  // index.css). A `component` body is app code that owns its own padding, and
  // a `managed_app` body is one full-page iframe — insetting either just
  // frames someone else's layout in dead space.
  const isDeclarative = !isComponent && !!spec;
  const icon = windowSpec?.icon || windowSpec?.body?.icon;
  return (
    <div className="flex flex-col bg-[var(--color-bg-secondary)] rounded-lg overflow-hidden h-full shadow-2xl shadow-black/40 border border-[var(--color-border)]">
      <div
        className="drag-handle flex items-center justify-between px-3 py-2 bg-[var(--color-bg-header)] border-b border-[var(--color-border)] select-none cursor-grab active:cursor-grabbing shrink-0"
        onMouseDown={onFocus}
      >
        <div className="min-w-0 flex items-center gap-2">
          {icon && <AppIcon icon={icon} label={title || 'App'} size={16} />}
          <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
            {title || 'App'}
          </span>
        </div>
        <div className="flex items-center gap-1 no-drag" onMouseDown={(e) => e.stopPropagation()}>
          {/* The app's own buttons, before the generic pair — so an app never
              needs a second bar in its body just to have somewhere to put
              them. Renders nothing (AppSlot's null fallback) for every window
              that registers no actions, which is all of them until an app
              opts in: purely additive. */}
          {windowSpec?.id && (
            <AppSlot
              slot={windowTitlebarSlot(windowSpec.id)}
              props={{ windowKey, onClose, onMaximize, isMaximized, instanceId: windowSpec.instanceId }}
            />
          )}
          <button
            onClick={() => onMaximize?.(windowKey)}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-[var(--color-text-muted)]"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div
        className={`app-declarative-window-body flex-1 overflow-auto no-drag${isDeclarative ? ' is-declarative' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <AppWindowBody
          windowSpec={windowSpec}
          spec={spec}
          slotProps={{ windowKey, onClose, onMaximize, isMaximized, instanceId: windowSpec?.instanceId, onTitleChange, onFocus, isFocused }}
        />
      </div>
    </div>
  );
}

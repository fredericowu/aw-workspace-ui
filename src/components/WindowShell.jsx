// WindowShell — the shared window chrome layer: title bar (icon, title,
// optional extra action slots, Minimize/Maximize/Close per flags), 8-way
// manual resize, drag-to-move, focus/z-order, and position/size persistence
// via windowStore.
//
// This is a real React component (hooks) — a 1:1 behavior port of the
// prototype's vanilla-DOM `mountWindowFrame()` (src/components/
// WindowShell.js in the ux-proto prototype). It still delegates all
// geometry/z-order STATE to windowStore (same localStorage keys), it just
// drives the DOM through a ref + React lifecycle instead of manual
// createElement/appendChild calls.
//
// Per the Architect's composition decision (run 2fa7f8d5,
// aw-microfrontend-architecture): every window TYPE contributes only a
// `descriptor` (title, icon, chrome flags, default size, singleton) plus a
// `Content` — WindowShell is the one shared chrome layer that decision
// called for.
//
// Props:
//   windowKey       — unique persistence key (e.g. 'appWindow:UX-Proto')
//   title, icon     — icon is a React node (rendered inline, replaces the
//                     prototype's `iconHtml` string)
//   chrome          — { minimize, maximize, close }
//   actions?        — extra title-bar buttons before minimize/maximize/close:
//                     [{ id?, icon, title, onClick, active? }]
//   defaultSize     — { width, height }
//   defaultPos?     — { x, y }
//   focused?        — initial focused state (also brings the window to the
//                     front of the z-order)
//   onFocus()       — called on any mousedown inside the window
//   onClose()
//   onMinimize()    — omitted -> minimize button hidden even if chrome.minimize
//   children        — the window's Content

import { useCallback, useEffect, useRef, useState } from "react";
import { windowStore } from "./windowStore.js";

const MIN_WIDTH = 280;
const MIN_HEIGHT = 160;
const HANDLE_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

// Mirrors the prototype's `activeFrames` registry: when one window's
// z-order rank changes, every other mounted WindowShell's zIndex needs to
// be refreshed too (windowStore.getZIndex is relative, based on position in
// zOrder), not just the window that triggered the change.
const activeFrames = new Set();
function refreshAllZ() {
  activeFrames.forEach((fn) => fn());
}

function boundsEl() {
  return document.getElementById("windows-area");
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12 }}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconMin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12 }}>
      <path d="M5 12h14" />
    </svg>
  );
}

function IconMax() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 11, height: 11 }}>
      <rect x="4" y="4" width="16" height="16" rx="1" />
    </svg>
  );
}

export default function WindowShell({
  windowKey,
  title,
  icon,
  chrome = {},
  actions = [],
  defaultSize,
  defaultPos = {},
  focused = false,
  onFocus,
  onClose,
  onMinimize,
  children,
}) {
  const elRef = useRef(null);
  const dragStateRef = useRef(null);
  const resizeStateRef = useRef(null);
  // Bump a counter to force a re-render (e.g. after maximize toggles, since
  // that changes rendered className/inline-style in ways easiest to just
  // re-render for, unlike drag/resize which mutate style directly for perf).
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((n) => n + 1), []);

  const geometryDefaults = { ...defaultPos, ...defaultSize };

  const applyGeometry = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    if (windowStore.isMaximized(windowKey)) {
      el.classList.add("shell-maximized");
      el.style.left = "0px";
      el.style.top = "0px";
      el.style.width = "100%";
      el.style.height = "100%";
    } else {
      el.classList.remove("shell-maximized");
      const g = windowStore.getGeometry(windowKey, geometryDefaults);
      el.style.left = `${g.x}px`;
      el.style.top = `${g.y}px`;
      el.style.width = `${g.width}px`;
      el.style.height = `${g.height}px`;
    }
    el.style.zIndex = String(windowStore.getZIndex(windowKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey]);

  useEffect(() => {
    activeFrames.add(applyGeometry);
    if (focused) windowStore.bringToFront(windowKey);
    applyGeometry();
    refreshAllZ();
    return () => {
      activeFrames.delete(applyGeometry);
    };
    // Mount-only (mirrors the prototype: geometry is seeded once per key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focus = useCallback(() => {
    windowStore.bringToFront(windowKey);
    applyGeometry();
    refreshAllZ();
    onFocus && onFocus();
  }, [applyGeometry, onFocus, windowKey]);

  const toggleMaximize = useCallback(() => {
    windowStore.toggleMaximize(windowKey);
    applyGeometry();
    refreshAllZ();
    rerender();
    onFocus && onFocus();
  }, [applyGeometry, onFocus, rerender, windowKey]);

  // ---- drag -----------------------------------------------------------
  const onDragMove = useCallback((e) => {
    const el = elRef.current;
    const dragState = dragStateRef.current;
    if (!dragState || !el) return;
    const bounds = boundsEl();
    const maxX = bounds ? bounds.clientWidth - 80 : Infinity;
    const maxY = bounds ? bounds.clientHeight - 40 : Infinity;
    const x = Math.min(Math.max(dragState.origX + (e.clientX - dragState.startX), -200), maxX);
    const y = Math.min(Math.max(dragState.origY + (e.clientY - dragState.startY), 0), maxY);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, []);

  const onDragEnd = useCallback(() => {
    const el = elRef.current;
    if (!dragStateRef.current || !el) return;
    windowStore.setGeometry(windowKey, {
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
    });
    dragStateRef.current = null;
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDragMove, windowKey]);

  const handleTitlebarMouseDown = useCallback(
    (e) => {
      if (e.target.closest(".shell-actions")) return;
      if (windowStore.isMaximized(windowKey)) return;
      const g = windowStore.getGeometry(windowKey, geometryDefaults);
      dragStateRef.current = { startX: e.clientX, startY: e.clientY, origX: g.x, origY: g.y };
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);
      e.preventDefault();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onDragMove, onDragEnd, windowKey]
  );

  // ---- resize (8 directions) ------------------------------------------
  const onResizeMove = useCallback((e) => {
    const el = elRef.current;
    const resizeState = resizeStateRef.current;
    if (!resizeState || !el) return;
    const { dir } = resizeState;
    const dx = e.clientX - resizeState.startX;
    const dy = e.clientY - resizeState.startY;

    let { x, y, width, height } = resizeState;

    if (dir.includes("e")) width = Math.max(MIN_WIDTH, resizeState.width + dx);
    if (dir.includes("s")) height = Math.max(MIN_HEIGHT, resizeState.height + dy);
    if (dir.includes("w")) {
      width = Math.max(MIN_WIDTH, resizeState.width - dx);
      x = resizeState.x + (resizeState.width - width);
    }
    if (dir.includes("n")) {
      height = Math.max(MIN_HEIGHT, resizeState.height - dy);
      y = resizeState.y + (resizeState.height - height);
    }

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }, []);

  const onResizeEnd = useCallback(() => {
    const el = elRef.current;
    if (!resizeStateRef.current || !el) return;
    windowStore.setGeometry(windowKey, {
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      width: parseFloat(el.style.width),
      height: parseFloat(el.style.height),
    });
    resizeStateRef.current = null;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onResizeMove, windowKey]);

  const startResize = useCallback(
    (e, dir) => {
      if (windowStore.isMaximized(windowKey)) return;
      const g = windowStore.getGeometry(windowKey, geometryDefaults);
      resizeStateRef.current = { dir, startX: e.clientX, startY: e.clientY, ...g };
      document.addEventListener("mousemove", onResizeMove);
      document.addEventListener("mouseup", onResizeEnd);
      e.preventDefault();
      e.stopPropagation();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onResizeMove, onResizeEnd, windowKey]
  );

  // Cleanup any listeners left dangling if the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
      document.removeEventListener("mousemove", onResizeMove);
      document.removeEventListener("mouseup", onResizeEnd);
    };
  }, [onDragMove, onDragEnd, onResizeMove, onResizeEnd]);

  const isMaximized = windowStore.isMaximized(windowKey);

  return (
    <div
      ref={elRef}
      className={`window shell${focused ? " focused" : ""}`}
      data-win-key={windowKey}
      onMouseDown={focus}
    >
      <div className="window-titlebar drag-handle" onMouseDown={handleTitlebarMouseDown}>
        <span className="shell-icon">{icon}</span>
        <span className="title">{title}</span>
        <div className="shell-actions" onMouseDown={(e) => e.stopPropagation()}>
          {actions.map((a, i) => (
            <button
              key={a.id || i}
              type="button"
              className={`win-btn shell-action${a.active ? " active" : ""}`}
              title={a.title || ""}
              onClick={a.onClick}
            >
              {a.icon}
            </button>
          ))}
          {chrome.minimize && onMinimize ? (
            <button type="button" className="win-btn" title="Minimize" onClick={() => onMinimize()}>
              <IconMin />
            </button>
          ) : null}
          {chrome.maximize ? (
            <button
              type="button"
              className="win-btn"
              title={isMaximized ? "Restore" : "Maximize"}
              onClick={toggleMaximize}
            >
              <IconMax />
            </button>
          ) : null}
          {chrome.close !== false ? (
            <button type="button" className="win-btn close" title="Close" onClick={() => onClose && onClose()}>
              <IconClose />
            </button>
          ) : null}
        </div>
      </div>

      <div className="window-content nopad">{children}</div>

      {HANDLE_DIRS.map((dir) => (
        <div
          key={dir}
          className={`win-resize-handle rz-${dir}`}
          onMouseDown={(e) => startResize(e, dir)}
        />
      ))}
    </div>
  );
}

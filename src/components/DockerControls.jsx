import { useState } from 'react';
import { startComponent, stopComponent, restartComponent } from '../hooks/useComponentStatus';

/**
 * Start / Restart / Stop trio for the iframe-backed docker windows
 * (Browser, VSCode, Desktop).  Visually mirrors `<ControlButtons>` from
 * LogWindow but uses the tighter `p-1` padding the window header
 * already uses for Pop-out / Maximize / Close so the row stays uniform.
 *
 * After Start and Restart we remount the iframe in place. Closing and
 * reopening the parent window is fragile for managed app windows because
 * their state is owned by App.jsx, while AppProxyWindow already has a
 * reliable cross-origin reload path via iframeReloadKey.
 *
 * `variant`: 'titlebar' (default, desktop window chrome — compact) or
 * 'touch' (mobile open-app chrome — >=44px tap targets). Only changes
 * padding/icon size; behaviour, including the restart-doesn't-close-the-
 * window fix above, is identical in both variants.
 */
export default function DockerControls({ componentKey, status, onReloadWindow, variant = 'titlebar' }) {
  const [busy, setBusy] = useState(null);

  const isOff = status === 'off';
  const isRunning = status === 'running' || status === 'boot';
  const touch = variant === 'touch';
  const buttonClass = touch
    ? 'p-[15px] rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer'
    : 'p-1 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer';
  const iconSize = touch ? 18 : 14;

  const reloadSoon = (delay = 600) => {
    setTimeout(() => onReloadWindow?.(), delay);
  };

  const onStart = async () => {
    setBusy('start');
    try {
      await startComponent(componentKey).catch(() => {});
      reloadSoon(600);
    } finally {
      setTimeout(() => setBusy(null), 400);
    }
  };

  const onRestart = async () => {
    setBusy('restart');
    try {
      await restartComponent(componentKey).catch(() => {});
      reloadSoon(800);
    } finally {
      setTimeout(() => setBusy(null), 600);
    }
  };

  const onStop = async () => {
    setBusy('stop');
    try {
      await stopComponent(componentKey).catch(() => {});
    } finally {
      setTimeout(() => setBusy(null), 400);
    }
  };

  const Spinner = () => (
    <svg className="w-3.5 h-3.5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );

  return (
    <>
      <button
        onClick={onStart}
        disabled={isRunning || !!busy}
        className={buttonClass}
        title="Start container"
      >
        {busy === 'start' ? <Spinner /> : (
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor" className="text-green-400">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <button
        onClick={onRestart}
        disabled={!!busy}
        className={buttonClass}
        title="Restart component"
      >
        {busy === 'restart' ? <Spinner /> : (
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-400">
            <path d="M1 4v6h6" />
            <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
          </svg>
        )}
      </button>
      <button
        onClick={onStop}
        disabled={isOff || !!busy}
        className={buttonClass}
        title="Stop container"
      >
        {busy === 'stop' ? <Spinner /> : (
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor" className="text-red-400">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        )}
      </button>
    </>
  );
}

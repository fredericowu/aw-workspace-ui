import { useState } from 'react';
import { startComponent, stopComponent, restartComponent } from '../hooks/useComponentStatus';

export default function ControlButtons({ componentKey, status, onAction }) {
  const [loading, setLoading] = useState(null);

  const handle = async (action, fn) => {
    setLoading(action);
    try {
      await fn(componentKey);
      if (onAction) onAction();
    } finally {
      setTimeout(() => setLoading(null), 500);
    }
  };

  const isOff = status === 'off';
  const isRunning = status === 'running' || status === 'boot';

  return (
    <div className="flex items-center gap-1">
      {/* Start */}
      <button
        onClick={() => handle('start', startComponent)}
        disabled={isRunning || loading}
        className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Start"
      >
        {loading === 'start' ? (
          <Spinner />
        ) : (
          <svg className="w-4 h-4 text-green-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Stop */}
      <button
        onClick={() => handle('stop', stopComponent)}
        disabled={isOff || loading}
        className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Stop"
      >
        {loading === 'stop' ? (
          <Spinner />
        ) : (
          <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        )}
      </button>

      {/* Restart */}
      <button
        onClick={() => handle('restart', restartComponent)}
        disabled={loading}
        className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Restart"
      >
        {loading === 'restart' ? (
          <Spinner />
        ) : (
          <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 4v6h6" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        )}
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

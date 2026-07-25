/**
 * Standalone Android Emulator viewer page — opened via the Remote Desktop
 * window's "Pop out to new window" button (same pattern as the noVNC
 * pop-out and the workspace-app pop-outs in WindowManager.jsx: a plain
 * window.open, no chrome besides what the panel itself renders).
 * URL: /android-viewer.html — no params, reuses AndroidViewerPanel as-is
 * (it owns its own WebSocket connection + on-screen controls).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { initApiKey } from './auth';
import { AndroidViewerPanel } from './components/AndroidViewerWindow';

document.title = 'Android Emulator';

initApiKey();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="h-[100dvh] w-screen bg-black">
      <AndroidViewerPanel />
    </div>
  </StrictMode>,
);

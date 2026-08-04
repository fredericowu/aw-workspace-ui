# aw-workspace-ui

React dashboard for Agentic Workspace.

## Goals

- Provide the production dashboard shell for AW.
- Use Vite, JSX, Inter, and the Signal Amber visual direction.
- Keep each workspace window type in its own module while sharing
  `WindowShell` for chrome, focus, drag, resize, and z-order behavior.
- Talk directly to the backend API at `https://api.aw.tekflox.com`.
- Keep frontend BDD and Playwright tests in this repository.

## Topology

| Area | Value |
|---|---|
| Dev host | `aw-frontend.app.aw.tekflox.com` |
| Production host | `www.aw.tekflox.com` |
| Backend | `api.aw.tekflox.com` |
| Build | Vite |
| UI stack | React + JSX |

## Window Modules

The dashboard includes modules for App, Terminal, Settings, Diff, Knowledge
Base, Plans, Whiteboard, Debugger, Presentation, Tasks, Tests, Remote Desktop,
Docker Components, and Mobile Shell windows. Each module composes the shared
window shell instead of owning its own chrome.

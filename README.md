# aw-workspace-ui

React dashboard for Agentic Workspace.

## Goals

- Provide the production dashboard shell for AW.
- Use Vite, JSX, Inter, and the Signal Amber visual direction.
- Keep each workspace window type in its own module while sharing
  `WindowShell` for chrome, focus, drag, resize, and z-order behavior.
- Talk directly to the active workspace's own backend API.
- Keep frontend BDD and Playwright tests in this repository.

## Topology

| Area | Value |
|---|---|
| Dev host | `aw-frontend.app.aw.tekflox.com` |
| Production host | `https://<ws>.workspace.aw.tekflox.com` (per workspace) |
| Backend | `https://api.<ws>.workspace.aw.tekflox.com` (per workspace) |
| Build | Vite |
| UI stack | React + JSX |

Per the three-plane split ADR
(`docs/architecture/aw-three-plane-split-and-workspace-urls.md` in the
`agentic-workspace` KB), this repo is the cloud-hosted SPA — renamed from
`aw-frontend` on 2026-07-31 — and there is no single fixed production/backend
host: `www.aw.tekflox.com` / `api.aw.tekflox.com` were the pre-split legacy
single-tenant monolith values and are not this repo's deployment target.

## Window Modules

The dashboard includes modules for App, Terminal, Settings, Diff, Knowledge
Base, Plans, Whiteboard, Debugger, Presentation, Tasks, Tests, Remote Desktop,
Docker Components, and Mobile Shell windows. Each module composes the shared
window shell instead of owning its own chrome.

## Licence

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE) (third-party attributions, including vendored noVNC).

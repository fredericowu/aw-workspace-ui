---
repo: architecture
path: docs/architecture/aw-workspace-ui.md
source: generated
edited: false
checksum: sha256:069613685ba070b4517eb4b335fd24642bcd535ed1cab7d423afa47b0686bfdd
---
# aw-workspace-ui

- **repo**: aw-workspace-ui
- **layer**: frontend
- **technologies**: node
- **health** (derived): planned

React dashboard for Agentic Workspace.

## Connections
_none_

## MCP tools
_none exposed_

## Requirements
### Gear appears on an app window iff that app is installed with has_config === true
- Given An app window is open in the workspace (an `appwin:*` window rendered by BasicWindow.jsx, or an `app:*` window rendered by AppProxyWindow in WindowManager.jsx:483), and GET /api/apps has answered
- When The titlebar renders
- Then A gear button is present iff the window's owning app slug (windowSpec.app for appwin:*, appId for app:*) matches an installed app whose `has_config` is true. has_config is the platform's existing single predicate (src/apps/manifest.py:355 — settings_panels OR config_schema.properties OR is_managed_app, minus an explicit `config_visible: false`), so it covers BOTH settings_panels forms (`window` and `schema_ref`), schema-only apps, and Tier-2 managed apps. No match, or has_config false, or a legacy aw.json workspace_apps entry that is not an installed app => no gear. A gear that opens nothing is impossible by construction.
- intended_status: `not_implemented` · derived health: `not_implemented`
- tests: `repos/aw-workspace-ui/src/__tests__/BasicWindow.test.jsx` (unknown)

### Gear sits in the titlebar LEFT group, after icon and title, never in the right action group
- Given An app window whose app has has_config === true, whose titlebar left group today is `icon + truncated title` (BasicWindow.jsx:59-64) and whose right group holds the app's own registered actions then Maximize then Close (BasicWindow.jsx:65-95)
- When The gear is added
- Then The gear renders inside the LEFT group in the order `icon · title · gear`, is `shrink-0` while the title keeps `min-w-0`/`truncate`, and carries `no-drag` + an onMouseDown that stops propagation so pressing it never drags the window. The right group is byte-unchanged: an app's windowTitlebarSlot actions stay immediately before Maximize/Close, so BasicWindow.test.jsx:78-84 (which asserts `.no-drag button` reads exactly ['Export as PNG','Maximize','Close']) still passes untouched. Core's gear on the left and the app's actions on the right means the two can never contend for position.
- intended_status: `not_implemented` · derived health: `not_implemented`
- tests: `repos/aw-workspace-ui/src/__tests__/BasicWindow.test.jsx` (unknown)

### Gear click with Settings NEW closed opens it already on the app's own page
- Given The `panel:settings-new` window (WindowManager.jsx:1261-1285, rendering SettingsPanelNew) is NOT in openWindows, and an app window for a has_config app is open
- When The user clicks that window's gear
- Then `panel:settings-new` is added to openWindows, view is set to 'home', requestWindowFocus('panel:settings-new') is called (App.jsx:298), and SettingsPanelNew's initial selection is `{group:'apps', key:<slug>}` — i.e. it opens directly on that app's settings, never on the default `{group:'general', key:'users'}` (SettingsPanelNew.jsx:61) with the user then having to find the app in the sidebar.
- intended_status: `not_implemented` · derived health: `not_implemented`
- tests: _none linked_

### Gear click with Settings NEW already open on a different section refocuses AND switches
- Given `panel:settings-new` is already in openWindows with its selection on some other section (General ▸ Users, or Apps ▸ a different slug), possibly buried under other windows
- When The user clicks an app window's gear
- Then The Settings NEW window is brought to the front (focus-trigger counter bumped — re-adding the key to the openWindows Set is a no-op on its own, see App.jsx:284-296) AND the sidebar selection switches to Apps ▸ that slug, with the Apps group expanded if it was collapsed. Both must happen: refocusing without switching leaves the user on the wrong page, switching without refocusing changes a window they cannot see.
- intended_status: `not_implemented` · derived health: `not_implemented`
- tests: `repos/aw-workspace-ui/src/__tests__/WindowManager.focusTrigger.test.jsx` (unknown)

### Gear click when Settings NEW is already on that app's page is idempotent, not a reset
- Given `panel:settings-new` is open and its selection is already `{group:'apps', key:<slug>}` for the same app whose gear is clicked
- When The user clicks that gear again
- Then The window is re-raised to the front (harmless, and correct when it was buried) and NOTHING else changes: AppConfigBody is not remounted, no in-progress edits in its form are discarded, the app list is not refetched, and the sidebar's expand/collapse state is preserved. "Do nothing visible" is the deliberate answer — a gear that silently discards a half-typed token would be worse than a gear that does nothing.
- intended_status: `not_implemented` · derived health: `not_implemented`
- tests: _none linked_

### Titlebar-to-Settings contract is a counter-bumped request object prop-drilled from App.jsx, not a global
- Given SettingsPanelNew is rendered with no props at WindowManager.jsx:1282 and owns its own `selection` state, and App.jsx already owns openWindows, view and the focus-trigger map
- When A titlebar gear requests "open Settings NEW on app X"
- Then App.jsx exposes `openAppSettings(slug)` which sets a `{slug, counter}` request object (counter incremented on every call) alongside the existing openWindows/setView/requestWindowFocus calls; the callback is passed down to BasicWindow and AppProxyWindow, and the request object is passed to `<SettingsPanelNew request={...} />`, which applies it in a useEffect keyed on `request.counter`. The counter — not a bare slug — is required for the same reason requestWindowFocus needs one (App.jsx:284-296): re-requesting an identical value must still act. No new `window.__aw*` global is introduced: those exist so an app's plugin bundle can reach core (App.jsx:655-668), and core-to-core does not need that escape hatch.
- intended_status: `not_implemented` · derived health: `not_implemented`
- tests: _none linked_

### The gear survives a degraded app window, and never lands on a blank pane
- Given An app window whose body is empty because the app's `ui:code` permission was refused, so no frontend bundle is announced (src/apps/runtime.py:592-597) and the component-mode AppSlot at BasicWindow.jsx:101 renders null — window chrome drawn, body blank
- When The titlebar renders and the user clicks the gear
- Then The gear is still present and still works — it is rendered by core from GET /api/apps data, outside the ErrorBoundary'd body, and must never be gated on the app's bundle resolving. On the far side, the pane is never blank: AppConfigBody shows its loading state, the schema form, the app's declarative settings window, or the explicit "This app has no configurable settings." message (AppConfigBody.jsx:133-144). In a degraded window the gear is the only control that still functions, which is exactly when it matters most.
- intended_status: `not_implemented` · derived health: `not_implemented`
- tests: `repos/aw-workspace-ui/src/__tests__/BasicWindow.test.jsx` (unknown)

### A gear request for a slug Settings NEW cannot resolve degrades to a stated message, never a blank pane
- Given SettingsPanelNew fetches its own app list (SettingsPanelNew.jsx:65-71) and a gear request arrives while that fetch is still in flight, or for a slug the fetch did not return (list empty, request failed, app uninstalled between render and click)
- When The request is applied
- Then The content pane shows a named state rather than nothing. Today the code has no branch for `selection.group === 'apps' && !selectedApp && apps.length === 0` (SettingsPanelNew.jsx:185 requires apps.length > 0), so that combination renders an empty div — a blank pane, which is the precise failure this feature exists to avoid. The pending request must be retained and applied once the app list arrives; if the slug is genuinely absent, an explicit message must say so.
- intended_status: `not_implemented` · derived health: `not_implemented`
- tests: _none linked_

### Gear is labelled and keyboard-reachable, matching the two gears that already exist
- Given Two gear buttons already exist in this SPA — InstalledApps.jsx:41-46 and :114-119 — both using `aria-label={`Configure ${app.name}`}` and `title="Settings"` on a native `<button type="button">`
- When A screen-reader or keyboard user reaches the app window titlebar
- Then The titlebar gear uses the identical `aria-label={`Configure ${app.name}`}` and `title="Settings"` on a native `<button type="button">`, so it is Tab-reachable and Enter/Space-activatable with no extra handlers, and reads the same as the other two. DOM order puts it after the title and before the window body, so tab order is title → gear → body → app actions → Maximize → Close. Reusing the existing strings verbatim is deliberate: three gears describing themselves three different ways is a worse outcome than any one wording.
- intended_status: `not_implemented` · derived health: `not_implemented`
- tests: `repos/aw-workspace-ui/src/__tests__/BasicWindow.test.jsx` (unknown)

### Both app-window render paths get the gear — BasicWindow and AppProxyWindow
- Given An `appwin:*` key splits at WindowManager.jsx:1154 into AppProxyWindow when the window is `body.type: managed_app` (managedWindowAppEntry, WindowManager.jsx:830) and BasicWindow otherwise, and every Tier-2 container app is `is_managed_app` and therefore always has_config === true
- When The gear is implemented
- Then It appears in BOTH titlebars — BasicWindow.jsx:59 and AppProxyWindow's left group at WindowManager.jsx:665-671 — with the same criterion, label and behaviour. Implementing it only in BasicWindow leaves every managed_app window (the whole Tier-2 fleet, all of which have settings) without a gear, while a unit test that mounts only BasicWindow passes. Non-app windows — terminals, Debugger, Diff, Settings itself — never get a gear.
- intended_status: `not_implemented` · derived health: `not_implemented`
- tests: `repos/aw-workspace-ui/src/__tests__/WindowManager.managedApp.test.jsx` (unknown)

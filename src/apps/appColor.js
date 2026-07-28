// Deterministic per-app tile wash color — shared by AppLauncher's legacy
// workspace_apps grid and InstalledApps' framework-apps card grid, so both
// grids read as the same "Mission Control" visual language instead of two
// slightly different palettes.
const APP_TILE_PALETTE = ['#6366f1', '#059669', '#ca8a04', '#db2777', '#0284c7', '#7c3aed', '#dc2626', '#0d9488', '#9333ea', '#ea580c'];

export function colorForApp(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return APP_TILE_PALETTE[hash % APP_TILE_PALETTE.length];
}

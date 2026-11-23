// Titlebar chip for an app window: "App removed" / "App failed to load" (needs
// attention, wins) or "Updated, reopen to apply". Shared by BasicWindow and the
// managed-app (iframe) window so every app window reports the same states.
export default function AppWindowStatusChip({ updated = false, attention = null }) {
  if (attention) {
    return (
      <span
        role="status"
        data-testid="app-window-attention-hint"
        title={attention === 'removed'
          ? 'This app was uninstalled. Close this window.'
          : 'This app failed to load. Retrying; reload the page if it persists.'}
        className="mr-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400 whitespace-nowrap"
      >
        {attention === 'removed' ? 'App removed' : 'App failed to load'}
      </span>
    );
  }
  if (!updated) return null;
  return (
    <span
      role="status"
      data-testid="app-window-updated-hint"
      title="This app was updated. This window keeps running the old version until you close it."
      className="mr-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-400 whitespace-nowrap"
    >
      Updated, reopen to apply
    </span>
  );
}

export default function StatusDot({ status, size = 'sm' }) {
  const sizeClass = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';

  const colorClass = {
    off: 'bg-[var(--color-status-off)]',
    boot: 'bg-[var(--color-status-boot)] animate-pulse',
    running: 'bg-[var(--color-status-running)]',
  }[status] || 'bg-[var(--color-status-off)]';

  return <span className={`inline-block ${sizeClass} rounded-full ${colorClass}`} />;
}

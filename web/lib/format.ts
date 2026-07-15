/** Human clearing-window / countdown duration, e.g. "1h 4m", "2m 05s", "9s". */
export function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'now';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

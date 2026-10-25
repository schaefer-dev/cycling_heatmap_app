/** Display formatting. Pure functions (unit tested). */

const LOCALE = 'en-GB';

/** "Sat, 14 Jun 2025". Accepts "YYYY-MM-DD" (treated as a calendar date) or ISO timestamps. */
export function formatDate(
  value: string | null | undefined,
  opts: { weekday?: boolean } = {}
): string {
  if (!value) return 'Unknown date';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString(LOCALE, {
    ...(opts.weekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Local start time "07:42" from an ISO timestamp; '' when unknown. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso || !iso.includes('T')) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

/** "3:07 h" / "45 min". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '';
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')} h`;
}

export function formatKm(km: number | null | undefined, digits = 1): string {
  return km == null || !Number.isFinite(km) ? '–' : `${km.toFixed(digits)} km`;
}

export function formatElevation(m: number | null | undefined): string {
  return m == null || !Number.isFinite(m) ? '–' : `${Math.round(m)} m`;
}

/** Average speed from distance and (preferably moving) time. */
export function formatSpeed(
  km: number | null | undefined,
  seconds: number | null | undefined
): string {
  if (!km || !seconds || seconds <= 0) return '';
  return `${((km / seconds) * 3600).toFixed(1)} km/h`;
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", "4 months ago", "2 years ago". */
export function formatRelative(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

export function formatPercent(fraction: number | null | undefined): string {
  return fraction == null ? '' : `${Math.round(fraction * 100)}%`;
}

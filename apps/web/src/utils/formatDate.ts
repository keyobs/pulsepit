const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Date et heure complètes, dans la langue et le fuseau du navigateur. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Durée écoulée depuis `iso` (« il y a 3 jours »), dans la langue du navigateur. */
export function formatRelativeTime(
  iso: string,
  now: number = Date.now(),
): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const seconds = Math.round((time - now) / 1000);
  const elapsed = Math.abs(seconds);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (elapsed < MINUTE) return format.format(seconds, 'second');
  if (elapsed < HOUR)
    return format.format(Math.round(seconds / MINUTE), 'minute');
  if (elapsed < DAY) return format.format(Math.round(seconds / HOUR), 'hour');
  if (elapsed < 30 * DAY)
    return format.format(Math.round(seconds / DAY), 'day');
  if (elapsed < 365 * DAY)
    return format.format(Math.round(seconds / (30 * DAY)), 'month');
  return format.format(Math.round(seconds / (365 * DAY)), 'year');
}

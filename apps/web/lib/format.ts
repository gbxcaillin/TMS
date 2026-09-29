const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const audCompact = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', notation: 'compact', maximumFractionDigits: 1 });

export const money = (n: number | null | undefined) => (n == null ? '—' : aud.format(n));
export const moneyCompact = (n: number | null | undefined) => (n == null ? '—' : audCompact.format(n));

export function date(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  return new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-AU', opts);
}

export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

export function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date(iso, { day: 'numeric', month: 'short' });
}

/** Whole days from today to a YYYY-MM-DD date (negative = overdue). */
export function daysUntil(isoDate: string | null | undefined) {
  if (!isoDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${isoDate}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
}

export function dueLabel(isoDate: string | null | undefined) {
  const d = daysUntil(isoDate);
  if (d == null) return 'No date';
  if (d < -1) return `${-d} days overdue`;
  if (d === -1) return 'Yesterday';
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d < 7) return date(isoDate, { weekday: 'long' });
  return date(isoDate, { day: 'numeric', month: 'short' });
}

export const clientTypeLabel: Record<string, string> = {
  individual: 'Individual',
  couple: 'Couple',
  smsf: 'SMSF',
  trust: 'Trust',
  company: 'Company',
};

export const initialsOf = (name: string) =>
  name
    .replace(/&/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

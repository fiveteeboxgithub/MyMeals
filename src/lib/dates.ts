const DAY_MS = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Les dates sont manipulées comme des chaînes AAAA-MM-JJ, sans fuseau. */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso(): string {
  return toIso(new Date());
}

/** Nombre de jours depuis l'époque, pour faire des différences sans souci d'heure d'été. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

/** 0 = lundi … 6 = dimanche */
export function weekday(iso: string): number {
  return (((dayNumber(iso) + 3) % 7) + 7) % 7;
}

/** 1 = janvier … 12 = décembre */
export function monthOf(iso: string): number {
  return Number(iso.slice(5, 7));
}

export function mondayOf(iso: string): string {
  return addDays(iso, -weekday(iso));
}

const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export function dayName(iso: string): string {
  return DAY_NAMES[weekday(iso)];
}

export function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTH_NAMES[monthOf(iso) - 1]}`;
}

export function longDate(iso: string): string {
  return `${shortDate(iso)} ${iso.slice(0, 4)}`;
}

/** « il y a 3 semaines », « il y a 2 ans »… */
export function ago(days: number): string {
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 14) return `il y a ${days} jours`;
  if (days < 60) return `il y a ${Math.round(days / 7)} semaines`;
  if (days < 730) return `il y a ${Math.round(days / 30.4)} mois`;
  return `il y a ${Math.round(days / 365.25)} ans`;
}

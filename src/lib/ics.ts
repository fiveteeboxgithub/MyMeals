import { LUNCH_LIMIT_HOUR, type Meal, type Slot } from './types';

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): Prop | null {
  // Le premier « : » hors guillemets sépare le nom (et ses paramètres) de la valeur.
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ':' && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

function zoneIsValid(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Convertit un instant UTC en date et heure locales dans le fuseau donné. */
function utcToZone(utcMs: number, zone: string | undefined): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function parseStart(prop: Prop, zone: string | undefined): { date: string; slot: Slot } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(prop.value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const date = `${y}-${mo}-${d}`;
  // Événement « journée entière » : pas d'heure, on le range au soir.
  if (h === undefined) return { date, slot: 'soir' };
  if (z) {
    const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    const local = utcToZone(utc, zone);
    return { date: local.date, slot: local.hour < LUNCH_LIMIT_HOUR ? 'midi' : 'soir' };
  }
  // Heure locale (avec TZID) ou flottante : on la prend telle quelle.
  return { date, slot: +h < LUNCH_LIMIT_HOUR ? 'midi' : 'soir' };
}

/**
 * Lit un export iCalendar (.ics) de Google Calendar et renvoie un repas par événement.
 * Les événements annulés ou sans titre sont ignorés.
 */
export function parseIcs(text: string): Meal[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const meals: Meal[] = [];
  let zone: string | undefined;
  let event: { uid?: string; summary?: string; start?: Prop; status?: string; recurrence?: string } | null = null;

  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;

    if (prop.name === 'BEGIN' && prop.value.toUpperCase() === 'VEVENT') {
      event = {};
    } else if (prop.name === 'END' && prop.value.toUpperCase() === 'VEVENT') {
      if (event?.start && event.summary && event.status !== 'CANCELLED') {
        const start = parseStart(event.start, zone);
        if (start) {
          const uid = event.uid ?? `${start.date}-${start.slot}-${event.summary}`;
          meals.push({
            id: event.recurrence ? `${uid}#${event.recurrence}` : uid,
            date: start.date,
            slot: start.slot,
            name: event.summary,
            source: 'import',
          });
        }
      }
      event = null;
    } else if (event) {
      if (prop.name === 'UID') event.uid = prop.value.trim();
      else if (prop.name === 'SUMMARY') event.summary = unescapeText(prop.value);
      else if (prop.name === 'DTSTART') event.start = prop;
      else if (prop.name === 'STATUS') event.status = prop.value.trim().toUpperCase();
      else if (prop.name === 'RECURRENCE-ID') event.recurrence = prop.value.trim();
    } else if (prop.name === 'X-WR-TIMEZONE') {
      const candidate = prop.value.trim();
      if (zoneIsValid(candidate)) zone = candidate;
    }
  }
  return meals;
}

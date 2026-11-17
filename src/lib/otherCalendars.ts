import type { CalendarInfo, TimedEvent } from './google';
import { addDays } from './dates';
import type { Slot } from './types';

/** Agendas sans intérêt à côté d'un repas (numéros de semaine, lever et coucher du soleil, anniversaires…). */
const NOISY = /#(weeknum|sunrise|holiday|contacts)@|addressbook#/;

/** Agendas affichés par défaut : ceux cochés dans Google Agenda, sauf celui des repas et les agendas « techniques ». */
export function shownByDefault(calendar: CalendarInfo, mealsCalendarId: string | undefined): boolean {
  return calendar.id !== mealsCalendarId && calendar.selected && !NOISY.test(calendar.id);
}

/** Un événement d'un autre agenda, tel qu'affiché à côté d'un créneau. */
export interface OtherEvent extends TimedEvent {
  calendarName: string;
  color?: string;
}

/**
 * Plage horaire d'un créneau (en millisecondes, heure de l'appareil) : d'une heure avant le repas
 * jusqu'à deux heures après le midi, deux heures et demie après le soir.
 */
export function slotWindow(date: string, slot: Slot, time: string): [number, number] {
  const [h, m] = time.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  const meal = new Date(y, mo - 1, d, h, m).getTime();
  return [meal - 60 * 60_000, meal + (slot === 'midi' ? 120 : 150) * 60_000];
}

/** Rattache aux créneaux de la semaine (clé « date|créneau ») les événements qui les chevauchent. */
export function overlapsBySlot(
  events: OtherEvent[],
  days: string[],
  times: Record<Slot, string>,
): Map<string, OtherEvent[]> {
  const out = new Map<string, OtherEvent[]>();
  for (const date of days) {
    for (const slot of ['midi', 'soir'] as Slot[]) {
      const [from, to] = slotWindow(date, slot, times[slot]);
      const found = events.filter((e) => e.start < to && e.end > from).sort((a, b) => a.start - b.start);
      if (found.length > 0) out.set(`${date}|${slot}`, found);
    }
  }
  return out;
}

/** Bornes de la semaine à interroger (avec un jour de marge de chaque côté). */
export function weekRange(monday: string): [Date, Date] {
  const [y, m, d] = addDays(monday, -1).split('-').map(Number);
  const [y2, m2, d2] = addDays(monday, 8).split('-').map(Number);
  return [new Date(y, m - 1, d), new Date(y2, m2 - 1, d2)];
}

/** Heure locale « 21 h 05 » d'un horodatage. */
export function clock(ms: number): string {
  const date = new Date(ms);
  const minutes = date.getMinutes();
  return `${date.getHours()} h${minutes ? ` ${String(minutes).padStart(2, '0')}` : ''}`;
}

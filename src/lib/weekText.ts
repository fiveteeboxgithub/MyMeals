import { dayName, longDate, shortDate } from './dates';
import type { Meal, Slot } from './types';

const SLOT_WORD: Record<Slot, string> = { midi: 'midi', soir: 'soir' };

/**
 * La semaine en texte, pour l'envoyer par message : un jour par ligne, les repas prévus,
 * « pas de repas » pour les créneaux retirés, « à décider » pour les créneaux affichés encore vides.
 */
export function weekText(
  days: string[],
  slots: Slot[],
  bySlot: Map<string, Meal[]>,
  skipped: ReadonlySet<string>,
): string {
  const lines = [`Repas du ${shortDate(days[0])} au ${longDate(days[days.length - 1])}`];
  for (const date of days) {
    const parts: string[] = [];
    for (const slot of ['midi', 'soir'] as Slot[]) {
      const key = `${date}|${slot}`;
      const planned = bySlot.get(key);
      if (planned) parts.push(`${SLOT_WORD[slot]} : ${planned.map((m) => m.name).join(' + ')}`);
      else if (skipped.has(key)) parts.push(`${SLOT_WORD[slot]} : pas de repas`);
      else if (slots.includes(slot)) parts.push(`${SLOT_WORD[slot]} : à décider`);
    }
    if (parts.length > 0) lines.push(`${dayName(date)} ${shortDate(date)} — ${parts.join(' ; ')}`);
  }
  return lines.join('\n');
}

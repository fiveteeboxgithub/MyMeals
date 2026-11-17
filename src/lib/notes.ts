import { normalize, type DishIndex } from './suggest';
import type { Meal, Slot } from './types';

/** Taille maximale d'une note saisie dans l'application. */
export const MAX_NOTE_CHARS = 2000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/**
 * Description d'un événement Google → texte simple. Google Agenda (sur le web) l'enregistre souvent en
 * HTML : retours à la ligne, listes et liens sont convertis, le reste des balises est retiré.
 */
export function noteFromDescription(description: string | undefined): string {
  if (!description) return '';
  let text = description;
  if (/<[a-z/][^>]*>/i.test(text)) {
    text = text
      .replace(/<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis, (_, href: string, label: string) => {
        const clean = label.replace(/<[^>]*>/g, '').trim();
        return !clean || clean === href ? href : `${clean} (${href})`;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/(p|div|li|ul|ol|h\d)>/gi, '\n')
      .replace(/<[^>]*>/g, '');
  }
  text = text.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name: string) => ENTITIES[name]);
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type NotePart = { text: string; href?: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;

/** Découpe une note en morceaux de texte et en liens cliquables. */
export function splitLinks(note: string): NotePart[] {
  const parts: NotePart[] = [];
  let last = 0;
  for (const match of note.matchAll(URL_RE)) {
    // La ponctuation qui suit un lien (« voir https://x.fr/recette. ») n'en fait pas partie.
    const url = match[0].replace(/[.,;:!?)\]]+$/, '');
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: note.slice(last, start) });
    parts.push({ text: url, href: url });
    last = start + url.length;
  }
  if (last < note.length) parts.push({ text: note.slice(last) });
  return parts;
}

export interface PastNote {
  id: string;
  date: string;
  slot: Slot;
  name: string;
  note: string;
}

/** Notes des repas, regroupées par plat (toutes les écritures d'un même plat ensemble), les plus récentes d'abord. */
export function notesByDish(meals: Meal[], index: DishIndex): Map<string, PastNote[]> {
  const out = new Map<string, PastNote[]>();
  for (const meal of meals) {
    const note = meal.note?.trim();
    if (!note) continue;
    const key = index.byKey.get(normalize(meal.name))?.key ?? normalize(meal.name);
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({ id: meal.id, date: meal.date, slot: meal.slot, name: meal.name, note });
  }
  for (const list of out.values()) list.sort((a, b) => b.date.localeCompare(a.date) || b.slot.localeCompare(a.slot));
  return out;
}

/** Clé de plat d'un nom, comme `notesByDish` la calcule. */
export function dishKeyOf(name: string, index: DishIndex): string {
  return index.byKey.get(normalize(name))?.key ?? normalize(name);
}

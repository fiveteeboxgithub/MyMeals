import { fold, normalize } from './suggest';
import type { Meal } from './types';

/** Un libellé exact de repas, avec tous les repas du calendrier qui le portent. */
export interface Occurrence {
  label: string;
  ids: string[];
  count: number;
  /** Date (AAAA-MM-JJ) du repas le plus récent portant ce libellé. */
  lastDate: string;
}

/** Mots-clés d'une recherche : séparés par des espaces, virgules ou barres, sans accents. */
export function parseKeywords(query: string): string[] {
  return [...new Set(fold(query).split(/[\s,;/+]+/).filter((word) => word.length >= 2))];
}

/** Libellés distincts d'une liste de repas, du plus fréquent au moins fréquent. */
export function groupByLabel(meals: Meal[]): Occurrence[] {
  const groups = new Map<string, Occurrence>();
  for (const meal of meals) {
    const label = meal.name.replace(/\s+/g, ' ').trim();
    if (!label) continue;
    let group = groups.get(label);
    if (!group) {
      group = { label, ids: [], count: 0, lastDate: meal.date };
      groups.set(label, group);
    }
    group.ids.push(meal.id);
    group.count++;
    if (meal.date > group.lastDate) group.lastDate = meal.date;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Libellés dont le texte contient au moins un des mots-clés (sans tenir compte des
 * accents ni des majuscules). Un mot-clé qui désigne un ingrédient connu trouve aussi
 * ses autres noms : « coquille » trouve « st jacques », « pdt » trouve « pommes de terre ».
 */
export function findOccurrences(meals: Meal[], query: string): Occurrence[] {
  const keywords = parseKeywords(query).map((word) => ({ word, key: normalize(word) }));
  if (keywords.length === 0) return [];
  return groupByLabel(meals).filter((occurrence) => {
    const text = fold(occurrence.label);
    const words = normalize(occurrence.label).split(' ');
    return keywords.some(({ word, key }) => text.includes(word) || (key !== '' && words.includes(key)));
  });
}

/**
 * Libellé proposé pour fusionner des repas : le plus utilisé des libellés cochés ;
 * à égalité, le plus court, puis l'ordre alphabétique.
 */
export function proposeLabel(selected: Occurrence[]): string {
  const best = [...selected].sort(
    (a, b) => b.count - a.count || a.label.length - b.label.length || a.label.localeCompare(b.label),
  )[0];
  return best?.label ?? '';
}

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

/** Mots d'un texte, sans accents ni ponctuation : « Pâtes aux St-Jacques » donne pates, aux, st, jacques. */
function wordsOf(text: string): string[] {
  return fold(text).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Vrai si chaque mot-clé est le début d'au moins un des mots. */
function coversAll(keywords: string[], words: string[]): boolean {
  return keywords.every((keyword) => words.some((word) => word.startsWith(keyword)));
}

/**
 * Libellés qui contiennent tous les mots-clés, chacun pouvant n'être que le début
 * d'un mot : « pat jacqu » trouve « st jacques aux pâtes » et « pâtes à la saint
 * jacques », mais ni « pâtes au pesto » (pas de « jacqu ») ni « pat carbo ».
 * Les accents et les majuscules sont ignorés. Une deuxième lecture reconnaît les
 * autres noms d'un même ingrédient : « st jacques » trouve aussi « coquilles »
 * et « saint-jacques », « pdt » trouve « pommes de terre ».
 */
export function findOccurrences(meals: Meal[], query: string): Occurrence[] {
  const literal = parseKeywords(query);
  if (literal.length === 0) return [];
  const unified = normalize(query).split(' ').filter(Boolean);
  return groupByLabel(meals).filter((occurrence) => {
    if (coversAll(literal, wordsOf(occurrence.label))) return true;
    return unified.length > 0 && coversAll(unified, normalize(occurrence.label).split(' '));
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

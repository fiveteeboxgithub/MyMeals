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

export interface SearchMode {
  /** Le texte saisi est une expression régulière au lieu d'une liste de mots. */
  regex?: boolean;
}

/** Retire les accents sans toucher à la casse ni à la syntaxe : « \\D » doit rester « \\D ». */
function stripAccents(text: string): string {
  return text.replace(/œ/g, 'oe').replace(/Œ/g, 'OE').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Compile une expression régulière saisie par l'utilisateur. Elle ignore les majuscules
 * et les accents (écrire « pâtes » ou « pates » revient au même).
 */
export function compileRegex(pattern: string): { regex?: RegExp; error?: string } {
  if (pattern.trim() === '') return {};
  try {
    return { regex: new RegExp(stripAccents(pattern), 'iu') };
  } catch (e) {
    return { error: e instanceof Error ? e.message.replace(/^Invalid regular expression: (?:\/.*\/[a-z]*: )?/, '') : 'expression invalide' };
  }
}

/** Vrai s'il y a quelque chose à chercher dans ce texte, selon le mode. */
export function hasQuery(query: string, mode: SearchMode = {}): boolean {
  return mode.regex ? query.trim() !== '' : parseKeywords(query).length > 0;
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
 *
 * Avec `mode.regex`, le texte saisi est une expression régulière testée sur le libellé.
 */
export function findOccurrences(meals: Meal[], query: string, mode: SearchMode = {}): Occurrence[] {
  if (mode.regex) {
    const { regex } = compileRegex(query);
    // L'expression est testée sur le libellé sans accents (sans « g » : pas d'état entre deux tests).
    return regex ? groupByLabel(meals).filter((o) => regex.test(fold(o.label))) : [];
  }
  const literal = parseKeywords(query);
  if (literal.length === 0) return [];
  const unified = normalize(query).split(' ').filter(Boolean);
  // Les petits mots (« au », « de »…) disparaissent de la clé unifiée : ils doivent quand même être présents.
  const linkWords = literal.filter((keyword) => normalize(keyword) === '');
  return groupByLabel(meals).filter((occurrence) => {
    const words = wordsOf(occurrence.label);
    if (coversAll(literal, words)) return true;
    return unified.length > 0 && coversAll(linkWords, words) && coversAll(unified, normalize(occurrence.label).split(' '));
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

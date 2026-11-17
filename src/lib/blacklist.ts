import { compileRegex } from './duplicates';
import { fold, type DishIndex } from './suggest';

export interface Blacklist {
  /** Nombre d'entrées valides (mots et motifs). */
  entries: number;
  /** Lignes écartées parce que le motif est mal formé. */
  invalid: { line: string; error: string }[];
  /** Vrai si le texte contient un des mots de la liste ou correspond à un des motifs. */
  matches: (text: string) => boolean;
}

/** Une ligne entourée de barres obliques (/…/) est une expression régulière. */
const REGEX_LINE = /^\/(.+)\/$/;

/**
 * Lit la liste noire : une entrée par ligne.
 * - un mot ou une expression (« kebab », « chez paul ») : cache tout plat dont le nom CONTIENT ce
 *   texte, sans tenir compte des majuscules ni des accents (« kebab » cache aussi « Kebabs frites ») ;
 * - `/motif/` : expression régulière, testée sur le nom sans accents (`/\bpho\b/`, `/^(sushi|maki)/`) ;
 * - les lignes vides et celles qui commencent par # sont ignorées.
 */
export function parseBlacklist(text: string): Blacklist {
  const words: string[] = [];
  const patterns: RegExp[] = [];
  const invalid: Blacklist['invalid'] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const regexLine = REGEX_LINE.exec(line);
    if (regexLine) {
      const { regex, error } = compileRegex(regexLine[1]);
      if (regex) patterns.push(regex);
      else invalid.push({ line, error: error ?? 'expression invalide' });
    } else {
      const word = fold(line);
      if (word) words.push(word);
    }
  }
  return {
    entries: words.length + patterns.length,
    invalid,
    matches: (value) => {
      const folded = fold(value);
      return words.some((word) => folded.includes(word)) || patterns.some((pattern) => pattern.test(folded));
    },
  };
}

/** Clés des plats de l'historique qui sont sur la liste noire (n'importe laquelle de leurs écritures suffit). */
export function blacklistedKeys(index: DishIndex, blacklist: Blacklist): Set<string> {
  const keys = new Set<string>();
  if (blacklist.entries === 0) return keys;
  for (const dish of index.dishes) {
    if (blacklist.matches(dish.label) || dish.variants.some((variant) => blacklist.matches(variant))) keys.add(dish.key);
  }
  return keys;
}

/** Ce que « Surprise Me » doit savoir de la liste noire. */
export interface BlacklistFilter {
  matches: (name: string) => boolean;
  /** Plats de l'historique sur la liste noire : leurs repas ne comptent pas dans les goûts. */
  keys: ReadonlySet<string>;
  /** Option « inclure la liste noire » : les idées concernées reviennent, mais rarement. */
  include: boolean;
}

/**
 * Ajoute une ligne à la liste noire (texte brut, une entrée par ligne). Rien n'est ajouté si la
 * ligne y est déjà (sans tenir compte des majuscules ni des accents).
 */
export function addToBlacklist(text: string, entry: string): string {
  const clean = entry.replace(/\s+/g, ' ').trim();
  if (!clean) return text;
  const folded = fold(clean);
  if (text.split(/\r?\n/).some((line) => fold(line.trim()) === folded)) return text;
  const base = text.replace(/\s+$/, '');
  return base ? `${base}\n${clean}` : clean;
}

/**
 * Retire une ligne d'une liste (liste noire ou favoris), sans tenir compte des majuscules ni des accents.
 * Une règle plus large (« pâtes », un motif) qui couvre aussi ce plat n'est pas touchée.
 */
export function removeFromList(text: string, entry: string): string {
  const folded = fold(entry.replace(/\s+/g, ' ').trim());
  return text
    .split(/\r?\n/)
    .filter((line) => fold(line.trim()) !== folded)
    .join('\n');
}

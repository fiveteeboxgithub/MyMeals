import { fold, normalize, singular, type Dish, type DishIndex } from './suggest';
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

/** Première lettre du libellé en minuscule ? (undefined s'il n'y a aucune lettre) */
function startsLowercase(label: string): boolean | undefined {
  const letter = label.match(/\p{L}/u)?.[0];
  if (letter === undefined) return undefined;
  return letter === letter.toLowerCase() && letter !== letter.toUpperCase();
}

/** Vrai si la majorité des repas du calendrier commencent par une minuscule (c'est ton style d'écriture). */
export function prefersLowercase(meals: Meal[]): boolean {
  let lower = 0;
  let upper = 0;
  for (const meal of meals) {
    const isLower = startsLowercase(meal.name);
    if (isLower === true) lower++;
    else if (isLower === false) upper++;
  }
  return lower >= upper;
}

/** Met la première lettre dans le style voulu, sauf pour un sigle (« PDT », « KFC »). */
export function applyInitialStyle(label: string, lowercase: boolean): string {
  const index = label.search(/\p{L}/u);
  if (index < 0) return label;
  const letter = label[index];
  const next = label[index + 1] ?? '';
  const isAcronym = next !== '' && next === next.toUpperCase() && next !== next.toLowerCase();
  if (isAcronym) return label;
  const styled = lowercase ? letter.toLowerCase() : letter.toUpperCase();
  return label.slice(0, index) + styled + label.slice(index + 1);
}

/**
 * Libellé proposé pour fusionner des repas : le plus utilisé des libellés cochés ;
 * à égalité, celui qui commence comme le reste du calendrier (minuscule ou majuscule, si
 * `lowercase` est précisé), puis le plus court, puis l'ordre alphabétique.
 */
export function proposeLabel(selected: Occurrence[], lowercase?: boolean): string {
  const styleRank = (label: string) => (lowercase === undefined || startsLowercase(label) === lowercase ? 0 : 1);
  const best = [...selected].sort(
    (a, b) =>
      b.count - a.count ||
      styleRank(a.label) - styleRank(b.label) ||
      a.label.length - b.label.length ||
      a.label.localeCompare(b.label),
  )[0];
  return best?.label ?? '';
}

/** Une façon de nommer un même plat qui revient plusieurs fois sous des écritures différentes. */
export interface SuspectedGroup {
  /** Identifie le groupe (pour se souvenir qu'on l'a écarté) : les libellés triés. */
  signature: string;
  occurrences: Occurrence[];
  mealCount: number;
  /** Libellé retenu par défaut. */
  proposal: string;
  /** Ce qui distingue les libellés : « majuscules ou accents », « singulier ou pluriel »… */
  reasons: string[];
}

function words(text: string, plural: boolean): string[] {
  const list = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
  return plural ? list : list.map(singular);
}

/** Pourquoi `label` est pris pour un doublon de `reference` (du plus évident au plus incertain). */
export function reasonFor(label: string, reference: string): string {
  if (fold(label) === fold(reference)) return 'majuscules ou accents';
  if (words(label, true).join(' ') === words(reference, true).join(' ')) return 'ponctuation ou espaces';
  if (words(label, false).join(' ') === words(reference, false).join(' ')) return 'singulier ou pluriel';
  if (words(label, false).sort().join(' ') === words(reference, false).sort().join(' ')) return 'ordre des mots';
  if (normalize(label) === normalize(reference)) return 'autre écriture du même plat';
  return 'faute de frappe probable';
}

/**
 * Groupes de libellés que l'on soupçonne de désigner le même plat : mêmes mots à la
 * majuscule, aux accents, au pluriel, à l'ordre ou à une faute de frappe près (le même
 * regroupement que pour les propositions de repas). Les plus lourds (le plus de repas
 * concernés) viennent en premier. `ignored` contient les signatures déjà écartées.
 */
export function suspectedGroups(meals: Meal[], index: DishIndex, ignored: ReadonlySet<string> = new Set()): SuspectedGroup[] {
  const byDish = new Map<unknown, Occurrence[]>();
  for (const occurrence of groupByLabel(meals)) {
    const dish = index.byKey.get(normalize(occurrence.label));
    if (!dish) continue;
    const list = byDish.get(dish);
    if (list) list.push(occurrence);
    else byDish.set(dish, [occurrence]);
  }
  const lowercase = prefersLowercase(meals);
  const groups: SuspectedGroup[] = [];
  for (const occurrences of byDish.values()) {
    if (occurrences.length < 2) continue;
    const signature = occurrences.map((o) => o.label).sort().join('\u001f');
    if (ignored.has(signature)) continue;
    const chosen = proposeLabel(occurrences, lowercase);
    const proposal = applyInitialStyle(chosen, lowercase);
    const reasons = [...new Set(occurrences.filter((o) => o.label !== chosen).map((o) => reasonFor(o.label, chosen)))];
    groups.push({
      signature,
      occurrences,
      mealCount: occurrences.reduce((sum, o) => sum + o.count, 0),
      proposal,
      reasons,
    });
  }
  return groups.sort((a, b) => b.mealCount - a.mealCount || a.proposal.localeCompare(b.proposal));
}

/** Mots d'« habillage » : un plat qui n'en diffère que par eux est très probablement le même (formes normalisées). */
const QUALIFIERS = new Set(
  [
    'maison', 'frais', 'fraiche', 'fume', 'grille', 'roti', 'rotie', 'gratine', 'vapeur', 'nature', 'simple',
    'chaud', 'froid', 'rapide', 'express', 'leger', 'bio', 'cuit', 'poele', 'saute', 'mijote', 'petit', 'grand',
  ].map(singular),
);

/** Le mot tel qu'il est écrit dans le libellé (avec ses accents et son pluriel), à partir de sa forme normalisée. */
function showWord(label: string, word: string): string {
  const tokens = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.find((token) => singular(fold(token)) === word) ?? word;
}

/** Un plat plus détaillé qu'un autre : mêmes mots, plus un ou deux. */
export interface ApproxCandidate {
  /** Libellé le plus utilisé de ce plat. */
  label: string;
  occurrences: Occurrence[];
  mealCount: number;
  /** Mots en plus par rapport au plat de base (sans accents, au singulier). */
  extra: string[];
  /** Les mêmes mots, écrits comme dans le libellé. */
  shown: string[];
  /** Les mots en plus ne sont que de l'habillage (« fumé », « maison »…) : très probablement le même plat. */
  likely: boolean;
}

export interface ApproxGroup {
  signature: string;
  /** Libellé le plus utilisé du plat de base. */
  label: string;
  base: Occurrence[];
  baseCount: number;
  candidates: ApproxCandidate[];
  /** Total des repas du plat de base et de ses candidats. */
  mealCount: number;
  likely: boolean;
}

/**
 * Plats dont les mots sont inclus dans ceux d'un autre plat plus détaillé : « pâtes saumon » et
 * « pâtes saumon fumé ». Chaque plat détaillé est rangé sous le plat de base le plus proche (celui
 * qui a le plus de mots). Le plat de base a au moins deux mots, et le plat détaillé en a un ou deux de
 * plus. Ce sont des soupçons moins sûrs que les variantes d'écriture : on les propose sans les cocher.
 */
export function approximateGroups(meals: Meal[], index: DishIndex, ignored: ReadonlySet<string> = new Set()): ApproxGroup[] {
  const occByDish = new Map<Dish, Occurrence[]>();
  for (const occurrence of groupByLabel(meals)) {
    const dish = index.byKey.get(normalize(occurrence.label));
    if (!dish || dish.generic) continue;
    const list = occByDish.get(dish);
    if (list) list.push(occurrence);
    else occByDish.set(dish, [occurrence]);
  }
  const countOf = (dish: Dish) => (occByDish.get(dish) ?? []).reduce((sum, o) => sum + o.count, 0);

  const grouped = new Map<Dish, { dish: Dish; extra: string[] }[]>();
  for (const dish of occByDish.keys()) {
    const words = dish.key.split(' ');
    if (words.length < 3 || words.length > 10) continue;
    let best: { base: Dish; extra: string[]; size: number } | undefined;
    const attempt = (removed: number[]) => {
      const rest = words.filter((_, i) => !removed.includes(i));
      if (rest.length < 2) return;
      const base = index.byKey.get(rest.join(' '));
      if (!base || base === dish || !occByDish.has(base)) return;
      if (!best || rest.length > best.size || (rest.length === best.size && countOf(base) > countOf(best.base))) {
        best = { base, extra: removed.map((i) => words[i]), size: rest.length };
      }
    };
    for (let i = 0; i < words.length; i++) attempt([i]);
    for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) attempt([i, j]);
    if (!best) continue;
    const list = grouped.get(best.base);
    if (list) list.push({ dish, extra: best.extra });
    else grouped.set(best.base, [{ dish, extra: best.extra }]);
  }

  const groups: ApproxGroup[] = [];
  for (const [baseDish, found] of grouped) {
    const base = occByDish.get(baseDish)!;
    const candidates: ApproxCandidate[] = found
      .map(({ dish, extra }) => {
        const occurrences = occByDish.get(dish)!;
        const label = proposeLabel(occurrences);
        return {
          label,
          occurrences,
          mealCount: countOf(dish),
          extra,
          shown: extra.map((word) => showWord(label, word)),
          likely: extra.every((word) => QUALIFIERS.has(word)),
        };
      })
      .sort((a, b) => Number(b.likely) - Number(a.likely) || b.mealCount - a.mealCount || a.label.localeCompare(b.label));
    const signature = `~${base.map((o) => o.label).sort().join('\u001f')}\u001e${candidates.map((c) => c.label).sort().join('\u001f')}`;
    if (ignored.has(signature)) continue;
    groups.push({
      signature,
      label: proposeLabel(base),
      base,
      baseCount: countOf(baseDish),
      candidates,
      mealCount: countOf(baseDish) + candidates.reduce((sum, c) => sum + c.mealCount, 0),
      likely: candidates.some((c) => c.likely),
    });
  }
  return groups.sort((a, b) => Number(b.likely) - Number(a.likely) || b.mealCount - a.mealCount || a.label.localeCompare(b.label));
}

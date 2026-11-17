import { ago, dayNumber, monthOf, todayIso, weekday } from './dates';
import type { Meal, Slot } from './types';

interface Occurrence {
  day: number;
  slot: Slot;
  weekday: number;
  month: number;
}

export interface Dish {
  key: string;
  label: string;
  /** Autres façons dont ce plat a été écrit, de la plus à la moins fréquente. */
  variants: string[];
  /**
   * Les « restes » ne sont pas un plat mais une habitude : on ne les propose que
   * le jour et le créneau où ils reviennent, sans délai entre deux occurrences.
   */
  generic: boolean;
  /** Mots qui décrivent le plat (« pate », « saumon »), pour varier la semaine. */
  words: string[];
  /** Nombre de jours habituel entre deux fois, si le plat a été assez mangé pour le savoir. */
  interval?: number;
  occurrences: Occurrence[];
}

export interface DishIndex {
  dishes: Dish[];
  /** Retrouve un plat par la clé de n'importe laquelle de ses écritures. */
  byKey: Map<string, Dish>;
}

export interface Suggestion {
  key: string;
  label: string;
  variants: string[];
  /** Texte sans accents ni majuscules, pour la recherche. */
  search: string;
  score: number;
  count: number;
  /** Mangé ou prévu à moins d'une semaine de la date visée. */
  recent?: boolean;
  /** Plat de la liste noire (seulement quand `suggest` a reçu l'option `includeBlacklist`). */
  blacklisted?: boolean;
  reason: string;
}

/** Minuscules, sans accents ni espaces en trop : sert à chercher et à comparer. */
export function fold(text: string): string {
  return text
    .replace(/œ/gi, 'oe')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function singular(word: string): string {
  return word.length > 3 && /[sx]$/.test(word) ? word.slice(0, -1) : word;
}

/**
 * Expressions ramenées à un seul mot, pour que les différentes façons de nommer
 * un même ingrédient donnent la même clé. L'ordre compte : les expressions les
 * plus longues passent avant les mots qu'elles contiennent.
 */
const PHRASES: [RegExp, string][] = [
  [/\b(?:noix de |coquilles? (?:de )?)?(?:st|ste|saint|sainte) *jac?ques?\b/g, 'saintjacque'],
  [/\bcoquilles?\b/g, 'saintjacque'],
  [/\bpatates? douces?\b/g, 'patatedouce'],
  [/\b(?:pommes? de terre|patates?|pdt)\b/g, 'pdt'],
  [/\bpuree (?:de )?pdt\b/g, 'puree'],
  [/\bma?c ?do(?:nald)?s?\b/g, 'mcdo'],
  [/\bharicots? verts?\b/g, 'haricotvert'],
  [/\bharicots? blancs?\b/g, 'haricotblanc'],
  [/\bharicots? rouges?\b/g, 'haricotrouge'],
  [/\bpetits? pois\b/g, 'petitpoi'],
  [/\bpois chiches?\b/g, 'poichiche'],
  [/\bfruits? de mer\b/g, 'fruitdemer'],
  [/\bpetit sale\b/g, 'petitsale'],
  [/\bhot ?dogs?\b/g, 'hotdog'],
  [/\bbo ?buns?\b/g, 'bobun'],
  [/\bsteac?ks?\b/g, 'steak'],
  [/\b(?:spaghettis?|tagliatelles?|pennes?|fusillis?|farfalles?|linguines?|macaronis?|torsades?)\b/g, 'pate'],
  [/\bcarbo\b/g, 'carbonara'],
  [/\b(?:bolo|bolognese)\b/g, 'bolognaise'],
  [/\bhachis parmentier\b/g, 'parmentier'],
  [/\b(?:blancs?|filets?|paves?|dos|eminces?|aiguillettes?) de (?=\w)/g, ''],
  [/\briz (?:basmati|blanc|thai|complet)\b/g, 'riz'],
  [/\bsalade verte\b/g, 'salade'],
  [/\brestaurant\b/g, 'resto'],
];

/** Petits mots qui ne changent pas le plat. */
const LINK_WORDS = new Set(['de', 'du', 'des', 'au', 'aux', 'la', 'le', 'les', 'en', 'et', 'ou', 'un', 'une', 'avec', 'sur', 'sauce', 'maison', 'facon']);

/**
 * Clé de regroupement d'un plat : la liste triée de ses mots importants.
 * Sont ignorés : majuscules, accents, pluriels, ponctuation, petits mots (« aux »,
 * « de », « maison »), ordre des mots, et les façons courantes de nommer un même
 * ingrédient. « Pâtes aux St-Jacques », « coquilles/pates » et « pates/coquilles
 * st jacques » donnent ainsi la même clé.
 */
export function normalize(name: string): string {
  let text = fold(name).replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [pattern, replacement] of PHRASES) text = text.replace(pattern, replacement);
  const words = text
    .split(' ')
    .filter((word) => word.length > 1 && !LINK_WORDS.has(word))
    .map(singular);
  return [...new Set(words)].sort().join(' ');
}

/**
 * Vrai si les deux textes ne diffèrent que d'une faute de frappe : une lettre en
 * trop, en moins, changée, ou deux lettres voisines inversées. La première lettre
 * doit être la même, pour ne pas confondre « oeuf » et « boeuf ».
 */
export function isTypoOf(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.max(a.length, b.length) < 5) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === 0) return false;
  if (a.length === b.length) {
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
    );
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/**
 * Vrai si deux clés désignent le même plat à une faute de frappe près : tous les
 * mots sont communs sauf un de chaque côté (ou un mot coupé en deux), et ces
 * restes ne diffèrent que d'une lettre.
 */
export function isVariantKey(a: string, b: string): boolean {
  const restA = a.split(' ');
  const restB: string[] = [];
  for (const word of b.split(' ')) {
    const at = restA.indexOf(word);
    if (at >= 0) restA.splice(at, 1);
    else restB.push(word);
  }
  if (restA.length === 0 || restB.length === 0 || restA.length > 2 || restB.length > 2) return false;
  return isTypoOf(restA.join(''), restB.join(''));
}

function wordsOf(key: string): string[] {
  return key.split(' ').filter((w) => w.length >= 3);
}

/** Écart médian entre deux fois, sur les trois dernières années où le plat a été mangé. */
function usualInterval(occurrences: Occurrence[]): number | undefined {
  const days = [...new Set(occurrences.map((o) => o.day))].sort((a, b) => a - b);
  const recent = days.filter((d) => d >= days[days.length - 1] - 3 * 365);
  if (recent.length < 3) return undefined;
  const gaps = recent.slice(1).map((d, i) => d - recent[i]).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

export function buildIndex(meals: Meal[]): DishIndex {
  // 1. Regroupement exact par clé.
  interface Group {
    key: string;
    generic: boolean;
    occurrences: Occurrence[];
    spellings: Map<string, number>;
    keys: string[];
  }
  const groups = new Map<string, Group>();
  for (const meal of meals) {
    const key = normalize(meal.name);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = { key, generic: /^restes?\b/.test(fold(meal.name)), occurrences: [], spellings: new Map(), keys: [key] };
      groups.set(key, group);
    }
    group.occurrences.push({
      day: dayNumber(meal.date),
      slot: meal.slot,
      weekday: weekday(meal.date),
      month: monthOf(meal.date),
    });
    const spelling = meal.name.replace(/\s+/g, ' ').trim();
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
  }

  // 2. Les écritures à une faute de frappe près rejoignent l'écriture la plus fréquente.
  const merged: Group[] = [];
  const ranked = [...groups.values()].sort((a, b) => b.occurrences.length - a.occurrences.length);
  // Deux clés à une lettre près ont presque la même longueur : on ne compare qu'entre voisines.
  const byLength = new Map<number, Group[]>();
  for (const group of ranked) {
    const length = group.key.replace(/ /g, '').length;
    let target: Group | undefined;
    for (const near of [length, length - 1, length + 1]) {
      target = byLength.get(near)?.find((m) => m.generic === group.generic && isVariantKey(m.key, group.key));
      if (target) break;
    }
    if (target) {
      target.occurrences.push(...group.occurrences);
      target.keys.push(group.key);
      for (const [spelling, count] of group.spellings) {
        target.spellings.set(spelling, (target.spellings.get(spelling) ?? 0) + count);
      }
    } else {
      merged.push(group);
      if (!byLength.has(length)) byLength.set(length, []);
      byLength.get(length)!.push(group);
    }
  }

  // 3. On affiche l'écriture la plus utilisée ; les autres sont gardées comme variantes.
  const dishes: Dish[] = [];
  const byKey = new Map<string, Dish>();
  for (const group of merged) {
    const spellings = [...group.spellings].sort((a, b) => b[1] - a[1]).map(([spelling]) => spelling);
    const label = spellings[0];
    const seen = new Set([fold(label)]);
    const variants = spellings.slice(1).filter((s) => !seen.has(fold(s)) && seen.add(fold(s)));
    const dish: Dish = {
      key: group.key,
      label,
      variants,
      generic: group.generic,
      words: wordsOf(group.key),
      interval: usualInterval(group.occurrences),
      occurrences: group.occurrences,
    };
    dishes.push(dish);
    for (const key of group.keys) byKey.set(key, dish);
  }
  return { dishes, byKey };
}

/** Sans période choisie, un repas d'il y a deux ans compte moitié moins qu'un repas d'aujourd'hui. */
const HALF_LIFE_DAYS = 2 * 365;
/** Demi-vie quand tout l'historique est pris en compte. */
const ALL_HISTORY_HALF_LIFE_DAYS = 10 * 365;

/** Périodes d'historique proposées pour classer les plats (0 : toute la période). */
export const HISTORY_WINDOWS: { months: number; label: string }[] = [
  { months: 6, label: '6 derniers mois' },
  { months: 12, label: '1 an' },
  { months: 24, label: '2 ans' },
  { months: 60, label: '5 ans' },
  { months: 120, label: '10 ans' },
  { months: 0, label: 'Toute la période' },
];
export const DEFAULT_HISTORY_MONTHS = 60;

/** Les plats de la liste noire gardent ce dixième de leur score quand on les inclut : ils restent exceptionnels. */
export const BLACKLIST_PENALTY = 0.1;
/** Avec l'option « inclure la liste noire », environ une proposition sur dix vient de la liste. */
export const BLACKLIST_CHANCE = 0.1;

function seasonWeight(a: number, b: number): number {
  const diff = Math.abs(a - b);
  const distance = Math.min(diff, 12 - diff);
  if (distance === 0) return 1;
  if (distance === 1) return 0.7;
  if (distance === 2) return 0.4;
  return 0.15;
}

/**
 * Délai avant de reproposer un plat. Il dépend du plat : un plat qui revient chaque
 * semaine peut revenir vite, un plat mensuel attend plus longtemps (entre 2 semaines
 * et 3 mois). Sans habitude connue, on attend un mois.
 */
function cooldown(gapDays: number, interval: number | undefined): number {
  if (gapDays < 7) return 0.05;
  const rest = Math.min(90, Math.max(14, interval ?? 30));
  if (gapDays >= rest) return 1;
  return 0.05 + 0.95 * (gapDays / rest) ** 2;
}

/** Un plat plus mangé depuis un certain temps s'efface : moitié moins par année supplémentaire. */
function staleness(daysSinceLast: number, staleAfterDays: number): number {
  return Math.pow(0.5, Math.max(0, daysSinceLast - staleAfterDays) / 365);
}

/** Chaque mot déjà présent dans la semaine (« pate », « poisson ») réduit le score. */
const REPEAT_PENALTY = 0.65;

export interface SuggestOptions {
  /** Clés de plats à ne pas proposer. */
  exclude?: ReadonlySet<string>;
  /** Nombre de fois où chaque mot apparaît déjà dans la semaine. */
  weekWords?: ReadonlyMap<string, number>;
  today?: string;
  /**
   * Période d'historique prise en compte, en mois (0 : toute la période). Les repas plus
   * anciens sont ignorés ; plus la période est longue, plus les vieux repas pèsent
   * (la demi-vie suit la période). Sans cette option : demi-vie de deux ans, rien d'ignoré.
   */
  historyMonths?: number;
  /** Clés des plats de la liste noire. Sans `includeBlacklist`, ils ne sont pas proposés du tout. */
  blacklist?: ReadonlySet<string>;
  /** Garde les plats de la liste noire (repérés par `blacklisted`), avec un score divisé par dix. */
  includeBlacklist?: boolean;
}

/**
 * Classe les plats connus pour un créneau donné.
 *
 * Un plat monte dans le classement s'il a été mangé souvent, récemment, à la même
 * saison, au même créneau et le même jour de la semaine. Il redescend s'il revient
 * plus tôt que d'habitude, s'il n'a plus été mangé depuis plus d'un an, ou si la
 * semaine contient déjà un plat proche.
 */
export function suggest(index: DishIndex, date: string, slot: Slot, options: SuggestOptions = {}): Suggestion[] {
  const { exclude, weekWords, historyMonths, blacklist, includeBlacklist } = options;
  const target = dayNumber(date);
  const now = dayNumber(options.today ?? todayIso());
  const windowDays = historyMonths ? Math.round(historyMonths * 30.44) : undefined;
  const cutoff = windowDays === undefined ? -Infinity : now - windowDays;
  const halfLife = historyMonths === undefined ? HALF_LIFE_DAYS : (windowDays ?? ALL_HISTORY_HALF_LIFE_DAYS);
  const staleAfter = Math.max(365, halfLife / 2);
  const targetWeekday = weekday(date);
  const targetMonth = monthOf(date);
  const out: Suggestion[] = [];

  for (const dish of index.dishes) {
    if (exclude?.has(dish.key)) continue;
    const listed = blacklist?.has(dish.key) ?? false;
    if (listed && !includeBlacklist) continue;
    let base = 0;
    let count = 0;
    let lastEaten = -Infinity;
    let nearestGap = Infinity;

    for (const occ of dish.occurrences) {
      nearestGap = Math.min(nearestGap, Math.abs(occ.day - target));
      if (occ.day >= target || occ.day < cutoff) continue;
      count++;
      if (occ.day <= now) lastEaten = Math.max(lastEaten, occ.day);
      if (dish.generic && (occ.weekday !== targetWeekday || occ.slot !== slot)) continue;
      base +=
        Math.pow(0.5, (target - occ.day) / halfLife) *
        seasonWeight(occ.month, targetMonth) *
        (occ.slot === slot ? 1 : 0.3) *
        (occ.weekday === targetWeekday ? 1.5 : 1);
    }
    if (base === 0) continue;

    let score = base;
    const eaten = Number.isFinite(lastEaten);
    if (eaten) score *= staleness(now - lastEaten, staleAfter);
    if (!dish.generic) {
      score *= cooldown(nearestGap, dish.interval);
      const repeats = Math.max(0, ...dish.words.map((w) => weekWords?.get(w) ?? 0));
      score *= Math.pow(REPEAT_PENALTY, repeats);
    }
    if (listed) score *= BLACKLIST_PENALTY;
    out.push({
      key: dish.key,
      label: dish.label,
      variants: dish.variants,
      search: [dish.label, ...dish.variants].map(fold).join(' | '),
      score,
      count,
      recent: !dish.generic && nearestGap < 7,
      blacklisted: listed,
      reason: eaten ? `${count} fois · ${ago(now - lastEaten)}` : `${count} fois`,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

/**
 * Indique pour chaque (jour de semaine, créneau) si un repas y est habituellement
 * noté, d'après les 12 derniers mois d'historique. Sert à ne pas proposer de
 * déjeuner les jours où l'on ne mange jamais à la maison le midi.
 */
export function usualSlots(meals: Meal[], today: string): Set<string> {
  const end = dayNumber(today);
  const past = meals.filter((m) => dayNumber(m.date) < end);
  if (past.length === 0) return new Set();
  let last = -Infinity;
  let earliest = Infinity;
  for (const meal of past) {
    const day = dayNumber(meal.date);
    last = Math.max(last, day);
    earliest = Math.min(earliest, day);
  }
  const first = Math.max(last - 364, earliest);
  const weeks = Math.max(1, (last - first + 1) / 7);

  const filled = new Map<string, Set<number>>();
  for (const meal of past) {
    const day = dayNumber(meal.date);
    if (day < first) continue;
    const key = `${weekday(meal.date)}-${meal.slot}`;
    if (!filled.has(key)) filled.set(key, new Set());
    filled.get(key)!.add(day);
  }
  const usual = new Set<string>();
  for (const [key, days] of filled) {
    if (days.size / weeks >= 0.3) usual.add(key);
  }
  return usual;
}

/**
 * Niveaux de hasard. `pool` et `power` règlent les propositions du planning, `surprisePool`
 * et `surprisePower` les idées de « Surprise Me » : on tire au sort parmi les `pool`
 * premiers, chacun avec un poids égal à (score / meilleur score) puissance `power`.
 * Une puissance de 0 donne à tous la même chance. Les niveaux ne doivent être qu'ajoutés
 * à la fin : le niveau choisi est mémorisé par son rang.
 */
export const RANDOMNESS_LEVELS = [
  { label: 'Aucun', pool: 1, power: 1, surprisePool: 1, surprisePower: 1 },
  { label: 'Faible', pool: 10, power: 2, surprisePool: 10, surprisePower: 1 },
  { label: 'Moyen', pool: 30, power: 1, surprisePool: 40, surprisePower: 1 },
  { label: 'Fort', pool: 80, power: 0.4, surprisePool: 150, surprisePower: 0.4 },
  { label: 'Très fort', pool: 200, power: 0.15, surprisePool: 400, surprisePower: 0.15 },
  { label: 'Total', pool: Infinity, power: 0, surprisePool: Infinity, surprisePower: 0 },
] as const;
export const DEFAULT_RANDOMNESS = 3;

/** Nombre pseudo-aléatoire entre 0 et 1, toujours le même pour un texte donné. */
export function hashToUnit(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}

/**
 * Choisit une proposition dans un classement, avec plus ou moins de hasard.
 *
 * Au niveau 0, c'est toujours la mieux classée. Aux niveaux suivants, on tire au sort
 * parmi les premières (10, 30, 80, 200, toutes), les mieux classées gardant plus de chances ;
 * plus le niveau est élevé, plus les chances s'égalisent. Le tirage dépend de `seed` :
 * à seed égal le choix ne change pas, ce qui évite que l'écran bouge tout seul.
 */
export function pickProposal(ranked: Suggestion[], level: number, seed: string): Suggestion | undefined {
  const { pool, power } = RANDOMNESS_LEVELS[level] ?? RANDOMNESS_LEVELS[DEFAULT_RANDOMNESS];
  // Un plat mangé la semaine dernière n'est proposé que s'il n'y a rien d'autre.
  const notRecent = ranked.filter((s) => !s.recent);
  const candidates = (notRecent.length > 0 ? notRecent : ranked).slice(0, pool);
  if (candidates.length <= 1 || !(candidates[0].score > 0)) return candidates[0];
  const top = candidates[0].score;
  let best: Suggestion | undefined;
  let bestDraw = -Infinity;
  for (const candidate of candidates) {
    const weight = Math.pow(candidate.score / top, power);
    if (weight <= 0) continue;
    // Tirage pondéré : chaque plat reçoit une note au hasard, d'autant plus haute que son poids est grand.
    const draw = Math.log(hashToUnit(`${seed}|${candidate.key}`)) / weight;
    if (draw > bestDraw) {
      bestDraw = draw;
      best = candidate;
    }
  }
  return best ?? candidates[0];
}

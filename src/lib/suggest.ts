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

function singular(word: string): string {
  return word.length > 3 && /[sx]$/.test(word) ? word.slice(0, -1) : word;
}

/**
 * Clé de regroupement d'un plat. Sont ignorés : majuscules, accents, pluriels,
 * et l'ordre des éléments (« saumon/pâtes » = « Pates / saumon » = « pâtes et saumon »).
 */
export function normalize(name: string): string {
  return fold(name)
    .split(/\s*(?:[/,+&]|\bet\b)\s*/)
    .map((part) => part.split(' ').map(singular).join(' ').trim())
    .filter(Boolean)
    .sort()
    .join('/');
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

const STOP_WORDS = new Set(['aux', 'avec', 'des', 'les', 'sans', 'sauce', 'sur', 'une']);

function wordsOf(key: string): string[] {
  return [...new Set(key.split(/[/ ]/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w)))];
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
  const byLength = new Map<number, { compact: string; group: Group }[]>();
  const ranked = [...groups.values()].sort((a, b) => b.occurrences.length - a.occurrences.length);
  for (const group of ranked) {
    const compact = group.key.replace(/ /g, '');
    let target: Group | undefined;
    for (const length of [compact.length, compact.length - 1, compact.length + 1]) {
      target = byLength.get(length)?.find((c) => c.group.generic === group.generic && isTypoOf(c.compact, compact))?.group;
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
      if (!byLength.has(compact.length)) byLength.set(compact.length, []);
      byLength.get(compact.length)!.push({ compact, group });
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

/** Un repas d'il y a deux ans compte moitié moins qu'un repas d'aujourd'hui. */
const HALF_LIFE_DAYS = 2 * 365;

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

/** Un plat plus mangé depuis plus d'un an s'efface : moitié moins par année supplémentaire. */
function staleness(daysSinceLast: number): number {
  const years = daysSinceLast / 365;
  return years <= 1 ? 1 : Math.pow(0.5, years - 1);
}

/** Chaque mot déjà présent dans la semaine (« pate », « poisson ») réduit le score. */
const REPEAT_PENALTY = 0.65;

export interface SuggestOptions {
  /** Clés de plats à ne pas proposer. */
  exclude?: ReadonlySet<string>;
  /** Nombre de fois où chaque mot apparaît déjà dans la semaine. */
  weekWords?: ReadonlyMap<string, number>;
  today?: string;
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
  const { exclude, weekWords } = options;
  const target = dayNumber(date);
  const now = dayNumber(options.today ?? todayIso());
  const targetWeekday = weekday(date);
  const targetMonth = monthOf(date);
  const out: Suggestion[] = [];

  for (const dish of index.dishes) {
    if (exclude?.has(dish.key)) continue;
    let base = 0;
    let count = 0;
    let lastEaten = -Infinity;
    let nearestGap = Infinity;

    for (const occ of dish.occurrences) {
      nearestGap = Math.min(nearestGap, Math.abs(occ.day - target));
      if (occ.day >= target) continue;
      count++;
      if (occ.day <= now) lastEaten = Math.max(lastEaten, occ.day);
      if (dish.generic && (occ.weekday !== targetWeekday || occ.slot !== slot)) continue;
      base +=
        Math.pow(0.5, (target - occ.day) / HALF_LIFE_DAYS) *
        seasonWeight(occ.month, targetMonth) *
        (occ.slot === slot ? 1 : 0.3) *
        (occ.weekday === targetWeekday ? 1.5 : 1);
    }
    if (base === 0) continue;

    let score = base;
    const eaten = Number.isFinite(lastEaten);
    if (eaten) score *= staleness(now - lastEaten);
    if (!dish.generic) {
      score *= cooldown(nearestGap, dish.interval);
      const repeats = Math.max(0, ...dish.words.map((w) => weekWords?.get(w) ?? 0));
      score *= Math.pow(REPEAT_PENALTY, repeats);
    }
    out.push({
      key: dish.key,
      label: dish.label,
      variants: dish.variants,
      search: [dish.label, ...dish.variants].map(fold).join(' | '),
      score,
      count,
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

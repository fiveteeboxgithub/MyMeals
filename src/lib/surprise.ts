import { CATALOG, CONCEPTS, type CatalogDish, type Concept } from './catalog';
import { dayNumber, monthOf } from './dates';
import type { BlacklistFilter } from './blacklist';
import { BLACKLIST_PENALTY, DEFAULT_RANDOMNESS, RANDOMNESS_LEVELS, fold, normalize, type DishIndex } from './suggest';

/** Périodes proposées pour calculer les préférences, en mois (0 : tout l'historique). */
export const PERIODS: { months: number; label: string }[] = [
  { months: 6, label: '6 derniers mois' },
  { months: 12, label: '12 derniers mois' },
  { months: 24, label: '2 dernières années' },
  { months: 36, label: '3 dernières années' },
  { months: 60, label: '5 dernières années' },
  { months: 120, label: '10 dernières années' },
  { months: 0, label: "Tout l'historique" },
];
export const DEFAULT_PERIOD_MONTHS = 60;

export interface Surprise {
  name: string;
  /** Vient de « Mes idées ». */
  own?: boolean;
  /** Familles du plat que l'on retrouve le plus dans les repas récents. */
  because: string[];
  score: number;
}

/** Vrai si chaque mot-clé est le début d'un des mots du plat. */
function hasCore(dishWords: string[], coreWords: string[]): boolean {
  return coreWords.every((core) => dishWords.some((word) => word.startsWith(core)));
}

const CONCEPT_IDS = Object.keys(CONCEPTS) as Concept[];

/** Familles reconnues dans un plat de l'historique, d'après sa clé normalisée. */
export function conceptsOf(key: string): Concept[] {
  const words = key.split(' ');
  return CONCEPT_IDS.filter((id) => CONCEPTS[id].stems.some((stem) => words.some((word) => word.startsWith(stem))));
}

/**
 * Part des repas de la période qui contiennent chaque famille (entre 0 et 1).
 * Les « restes » ne comptent pas.
 */
export function tasteProfile(index: DishIndex, months: number, today: string, skip?: ReadonlySet<string>): Map<Concept, number> {
  const now = dayNumber(today);
  const from = months > 0 ? now - Math.round(months * 30.44) : -Infinity;
  const counts = new Map<Concept, number>();
  let total = 0;
  for (const dish of index.dishes) {
    if (dish.generic || skip?.has(dish.key)) continue;
    const eaten = dish.occurrences.filter((o) => o.day >= from && o.day <= now).length;
    if (eaten === 0) continue;
    total += eaten;
    for (const concept of conceptsOf(dish.key)) counts.set(concept, (counts.get(concept) ?? 0) + eaten);
  }
  const profile = new Map<Concept, number>();
  for (const [concept, count] of counts) profile.set(concept, count / total);
  return profile;
}

/** Vrai si l'historique complet contient déjà ce plat du catalogue. */
function isKnown(entry: CatalogDish, dishWords: string[][], index: DishIndex): boolean {
  if (index.byKey.has(normalize(entry.name))) return true;
  const core = normalize(entry.core).split(' ');
  return dishWords.some((words) => hasCore(words, core));
}

function inSeason(entry: CatalogDish, month: number): boolean {
  if (entry.season === '') return true;
  const winter = month >= 10 || month <= 3;
  return entry.season === 'h' ? winter : !winter;
}

/**
 * Idées de plats absents de l'historique, classées par proximité avec les goûts
 * récents : un plat est bien classé si ses familles (poisson, riz…) reviennent
 * souvent dans les repas de la période, et s'il est de saison à la date visée.
 */
/** Les idées de l'utilisateur ont un peu plus de chances : il les a choisies. */
export const OWN_IDEA_BOOST = 1.5;

/** Lit la liste « Mes idées » : une idée par ligne, sans doublon. */
export function parseIdeas(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const idea = line.replace(/\s+/g, ' ').trim();
    if (!idea || idea.startsWith('#') || seen.has(normalize(idea))) continue;
    seen.add(normalize(idea));
    out.push(idea);
  }
  return out;
}

export function surpriseIdeas(
  index: DishIndex,
  date: string,
  months: number,
  today: string,
  blacklist?: BlacklistFilter,
  ownIdeas: string[] = [],
): Surprise[] {
  // Les repas de la liste noire (restos…) ne disent rien de ce que tu aimes cuisiner.
  const profile = tasteProfile(index, months, today, blacklist?.keys);
  const dishWords = index.dishes.map((d) => d.key.split(' '));
  const month = monthOf(date);
  const ideas: Surprise[] = [];
  // Tes idées passent par le même calcul : leurs familles sont déduites de leur nom.
  const own: CatalogDish[] = ownIdeas.map((name) => ({ name, core: normalize(name), tags: conceptsOf(normalize(name)), season: '', own: true }));
  for (const entry of [...own, ...CATALOG]) {
    if (isKnown(entry, dishWords, index)) continue;
    const listed = blacklist?.matches(entry.name) ?? false;
    if (listed && !blacklist?.include) continue;
    const weights = entry.tags.map((tag) => profile.get(tag) ?? 0);
    const affinity = weights.length > 0 ? weights.reduce((sum, w) => sum + w, 0) / weights.length : 0;
    const because = entry.tags
      .filter((tag) => (profile.get(tag) ?? 0) > 0)
      .sort((a, b) => profile.get(b)! - profile.get(a)!)
      .slice(0, 2)
      .map((tag) => CONCEPTS[tag].label);
    ideas.push({ name: entry.name, because, score: (affinity + 0.01) * (inSeason(entry, month) ? 1 : 0.3) * (listed ? BLACKLIST_PENALTY : 1) * (entry.own ? OWN_IDEA_BOOST : 1), own: entry.own === true });
  }
  return ideas.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Tire une idée au hasard parmi les mieux classées qui n'ont pas encore été montrées.
 * Le niveau de hasard (voir RANDOMNESS_LEVELS) règle le nombre d'idées en lice et l'écart
 * de chances entre la première et les suivantes. Renvoie null quand tout a été montré.
 */
export function pickSurprise(
  ideas: Surprise[],
  shown: ReadonlySet<string>,
  level: number = DEFAULT_RANDOMNESS,
  random: () => number = Math.random,
): Surprise | null {
  const { surprisePool, surprisePower } = RANDOMNESS_LEVELS[level] ?? RANDOMNESS_LEVELS[DEFAULT_RANDOMNESS];
  const pool = ideas.filter((idea) => !shown.has(idea.name)).slice(0, surprisePool);
  if (pool.length === 0) return null;
  const top = pool[0].score;
  const weights = pool.map((idea) => (top > 0 ? Math.pow(idea.score / top, surprisePower) : 1));
  let roll = random() * weights.reduce((sum, w) => sum + w, 0);
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** Recherche utilisée par la validation du catalogue. */
export function catalogProblems(): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const entry of CATALOG) {
    if (names.has(entry.name)) problems.push(`doublon : ${entry.name}`);
    names.add(entry.name);
    for (const tag of entry.tags) if (!(tag in CONCEPTS)) problems.push(`famille inconnue « ${tag} » : ${entry.name}`);
    if (!hasCore(normalize(entry.name).split(' '), normalize(entry.core).split(' '))) problems.push(`mots-clés absents du nom : ${entry.name}`);
    if (fold(entry.core) !== entry.core) problems.push(`mots-clés non normalisés : ${entry.name}`);
  }
  return problems;
}

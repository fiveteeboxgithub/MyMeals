import { CATALOG, CONCEPTS, type CatalogDish, type Concept } from './catalog';
import { dayNumber, monthOf } from './dates';
import { fold, normalize, type DishIndex } from './suggest';

/** Périodes proposées pour calculer les préférences, en mois. */
export const PERIODS: { months: number; label: string }[] = [
  { months: 6, label: '6 derniers mois' },
  { months: 12, label: '12 derniers mois' },
  { months: 24, label: '2 dernières années' },
  { months: 36, label: '3 dernières années' },
  { months: 60, label: '5 dernières années' },
];
export const DEFAULT_PERIOD_MONTHS = 24;

export interface Surprise {
  name: string;
  /** Familles du plat que l'on retrouve le plus dans les repas récents. */
  because: string[];
  score: number;
}

/** Met un nom de plat sous une forme où l'on peut chercher des débuts de mots. */
function haystack(key: string): string {
  return ` ${key.replace(/[/'’-]/g, ' ').replace(/\s+/g, ' ')} `;
}

function hasWords(hay: string, words: string): boolean {
  return words.split(' ').every((word) => hay.includes(` ${word}`));
}

const CONCEPT_IDS = Object.keys(CONCEPTS) as Concept[];

/** Familles reconnues dans un plat de l'historique, d'après sa clé normalisée. */
export function conceptsOf(key: string): Concept[] {
  const hay = haystack(key);
  return CONCEPT_IDS.filter((id) => CONCEPTS[id].stems.some((stem) => hay.includes(` ${stem}`)));
}

/**
 * Part des repas de la période qui contiennent chaque famille (entre 0 et 1).
 * Les « restes » ne comptent pas.
 */
export function tasteProfile(index: DishIndex, months: number, today: string): Map<Concept, number> {
  const now = dayNumber(today);
  const from = now - Math.round(months * 30.44);
  const counts = new Map<Concept, number>();
  let total = 0;
  for (const dish of index.dishes) {
    if (dish.generic) continue;
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
function isKnown(entry: CatalogDish, hays: string[], index: DishIndex): boolean {
  if (index.byKey.has(normalize(entry.name))) return true;
  return hays.some((hay) => hasWords(hay, entry.core));
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
export function surpriseIdeas(index: DishIndex, date: string, months: number, today: string): Surprise[] {
  const profile = tasteProfile(index, months, today);
  const hays = index.dishes.map((d) => haystack(d.key));
  const month = monthOf(date);
  const ideas: Surprise[] = [];
  for (const entry of CATALOG) {
    if (isKnown(entry, hays, index)) continue;
    const weights = entry.tags.map((tag) => profile.get(tag) ?? 0);
    const affinity = weights.reduce((sum, w) => sum + w, 0) / weights.length;
    const because = entry.tags
      .filter((tag) => (profile.get(tag) ?? 0) > 0)
      .sort((a, b) => profile.get(b)! - profile.get(a)!)
      .slice(0, 2)
      .map((tag) => CONCEPTS[tag].label);
    ideas.push({ name: entry.name, because, score: (affinity + 0.01) * (inSeason(entry, month) ? 1 : 0.3) });
  }
  return ideas.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Tire une idée au hasard parmi les mieux classées qui n'ont pas encore été montrées,
 * les meilleures ayant plus de chances. Renvoie null quand tout a été montré.
 */
export function pickSurprise(ideas: Surprise[], shown: ReadonlySet<string>, random: () => number = Math.random): Surprise | null {
  const pool = ideas.filter((idea) => !shown.has(idea.name)).slice(0, 10);
  if (pool.length === 0) return null;
  let roll = random() * pool.reduce((sum, idea) => sum + idea.score, 0);
  for (const idea of pool) {
    roll -= idea.score;
    if (roll <= 0) return idea;
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
    if (!hasWords(haystack(normalize(entry.name)), entry.core)) problems.push(`mots-clés absents du nom : ${entry.name}`);
    if (fold(entry.core) !== entry.core) problems.push(`mots-clés non normalisés : ${entry.name}`);
  }
  return problems;
}

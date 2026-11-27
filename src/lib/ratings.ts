import { normalize } from './suggest';

/**
 * Notes des plats (1 à 5), une par personne et par plat (pas par repas). Chaque personne a son propre
 * événement spécial dans l'agenda, avec toutes ses notes : chacun n'écrit que le sien, donc deux personnes
 * qui notent en même temps ne s'écrasent jamais.
 */
export type Ratings = Record<string, Record<string, number>>;

/** Début de l'identifiant des événements de notes (lettres a-v et chiffres, comme l'exige Google). */
export const RATINGS_EVENT_PREFIX = 'mmealsnotes';
/** Identité des notes sans compte Google (tout reste dans le navigateur). */
export const LOCAL_RATER = 'moi';

/** Empreinte courte et stable, en base 32 (chiffres et lettres a-v). */
export function hash32(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text.trim().toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(32);
}

export function ratingsEventId(email: string): string {
  return `${RATINGS_EVENT_PREFIX}${hash32(email)}`;
}

const validRating = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5;

/** Contenu de l'événement d'une personne : son adresse et ses notes. */
export function ratingsPayload(email: string, ratings: Record<string, number>): { e: string; r: Record<string, number> } {
  return { e: email, r: ratings };
}

/** Relit l'événement de notes d'une personne ; null si illisible. */
export function parseRatingsPayload(payload: unknown): { email: string; ratings: Record<string, number> } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { e, r } = payload as { e?: unknown; r?: unknown };
  if (typeof e !== 'string' || !e || typeof r !== 'object' || r === null) return null;
  const ratings: Record<string, number> = {};
  for (const [key, n] of Object.entries(r as Record<string, unknown>)) if (key && validRating(n)) ratings[key] = n;
  return { email: e.trim().toLowerCase(), ratings };
}

/** Clés sous lesquelles une note de ce plat peut avoir été enregistrée : le plat et toutes ses écritures. */
export function ratingKeys(dish: { key: string; variants: string[] } | undefined, name: string): string[] {
  const keys = dish ? [dish.key, ...dish.variants.map(normalize)] : [normalize(name)];
  return [...new Set(keys.filter(Boolean))];
}

export function personRating(map: Record<string, number> | undefined, keys: string[]): number | undefined {
  if (!map) return undefined;
  for (const key of keys) if (validRating(map[key])) return map[key];
  return undefined;
}

export interface DishRating {
  /** Ma note, si j'en ai mis une. */
  mine?: number;
  /** Les notes des autres. */
  others: { who: string; n: number }[];
  /** Moyenne de toutes les notes, et leur nombre. */
  avg?: number;
  count: number;
}

export function dishRating(ratings: Ratings, keys: string[], me: string | undefined): DishRating {
  let sum = 0;
  let count = 0;
  let mine: number | undefined;
  const others: DishRating['others'] = [];
  for (const [who, map] of Object.entries(ratings)) {
    const n = personRating(map, keys);
    if (n === undefined) continue;
    sum += n;
    count++;
    if (who === me) mine = n;
    else others.push({ who, n });
  }
  return { mine, others: others.sort((a, b) => a.who.localeCompare(b.who)), avg: count ? sum / count : undefined, count };
}

/** Moyenne des notes de chaque plat de l'historique (clé du plat → moyenne). */
export function averageRatings(dishes: { key: string; variants: string[] }[], ratings: Ratings): Map<string, number> {
  const out = new Map<string, number>();
  if (Object.keys(ratings).length === 0) return out;
  for (const dish of dishes) {
    const { avg } = dishRating(ratings, ratingKeys(dish, dish.key), undefined);
    if (avg !== undefined) out.set(dish.key, avg);
  }
  return out;
}

/** Ma nouvelle carte de notes après avoir noté (ou retiré la note d') un plat. */
export function withRating(map: Record<string, number> | undefined, keys: string[], n: number | null): Record<string, number> {
  const next = { ...(map ?? {}) };
  for (const key of keys) delete next[key];
  if (n !== null && keys[0]) next[keys[0]] = n;
  return next;
}

/** « 4,5 » */
export const formatRating = (avg: number): string => (Math.round(avg * 10) / 10).toLocaleString('fr-FR');

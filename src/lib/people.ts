import type { Meal } from './types';

/** Préfixe des propriétés partagées de l'événement : une par personne qui aime (valeur : son adresse). */
export const LIKE_PREFIX = 'mmlike_';
/** Propriété partagée : qui a choisi le plat actuel de l'événement. */
export const BY_KEY = 'mmby';

/** Clé courte et stable pour une adresse : chaque personne n'écrit que sa propre clé (pas de conflit). */
export function likeKey(email: string): string {
  let h = 0x811c9dc5;
  for (const ch of email.trim().toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${LIKE_PREFIX}${h.toString(36)}`;
}

/** Prénom ou nom lisible tiré d'une adresse (« marie.dupont@exemple.fr » → « Marie Dupont »). */
export function displayName(email: string): string {
  const local = email.split('@')[0] ?? email;
  const words = local.split(/[._-]+/).filter(Boolean);
  return (words.length ? words : [email]).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function initial(email: string): string {
  return displayName(email).charAt(0);
}

/** Lit qui a choisi le plat et qui l'aime, dans les propriétés partagées d'un événement Google. */
export function readLikes(
  shared: Record<string, string> | undefined,
  creator: string | undefined,
): { by?: string; likes?: string[] } {
  const by = (shared?.[BY_KEY] || creator || '').trim().toLowerCase() || undefined;
  const likes = Object.entries(shared ?? {})
    .filter(([key, value]) => key.startsWith(LIKE_PREFIX) && value)
    .map(([, value]) => value.trim().toLowerCase())
    .filter((email) => email && email !== by)
    .sort();
  return { ...(by ? { by } : {}), ...(likes.length ? { likes } : {}) };
}

/** Propriétés partagées à envoyer pour effacer tous les « J'aime » connus d'un repas. */
export function clearLikes(meal: Pick<Meal, 'likes'> | undefined): Record<string, string> {
  return Object.fromEntries((meal?.likes ?? []).map((email) => [likeKey(email), '']));
}

/** Peut-on aimer ce repas ? Oui s'il a été choisi par quelqu'un d'autre. */
export function canLike(meal: Pick<Meal, 'by'>, me: string | undefined): boolean {
  return !!me && !!meal.by && meal.by !== me;
}

export function likedBy(meal: Pick<Meal, 'likes'>, me: string | undefined): boolean {
  return !!me && (meal.likes ?? []).includes(me);
}

/** Y a-t-il quelque chose à montrer sur la ligne d'un créneau (un « J'aime » possible, ou déjà donné) ? */
export function likeVisible(meals: Pick<Meal, 'by' | 'likes'>[], me: string | undefined, past = false): boolean {
  if (!me) return false;
  // Dans le passé, on ne propose plus d'aimer : seuls les « J'aime » déjà donnés restent visibles.
  if (past) return meals.some((m) => (m.likes?.length ?? 0) > 0);
  if (meals.length === 1) return canLike(meals[0], me) || (meals[0].likes?.length ?? 0) > 0;
  return meals.some((m) => (m.likes?.length ?? 0) > 0);
}

/** « toi » pour soi-même, sinon le nom lisible. */
export function whoName(email: string, me: string | undefined): string {
  return email === me ? 'toi' : displayName(email);
}

/** Phrase décrivant qui a choisi le plat et qui l'aime. */
export function likeSummary(meal: Pick<Meal, 'by' | 'likes'>, me: string | undefined): string {
  const parts: string[] = [];
  if (meal.by) parts.push(`Choisi par ${whoName(meal.by, me)}`);
  if (meal.likes?.length) parts.push(`Aimé par ${meal.likes.map((e) => whoName(e, me)).join(', ')}`);
  return parts.join(' · ');
}

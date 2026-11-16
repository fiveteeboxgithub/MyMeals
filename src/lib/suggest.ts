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
  /**
   * Les « restes » ne sont pas un plat mais une habitude : on ne les propose que
   * le jour et le créneau où ils reviennent, sans délai entre deux occurrences.
   */
  generic: boolean;
  occurrences: Occurrence[];
}

export interface Suggestion {
  key: string;
  label: string;
  score: number;
  count: number;
  reason: string;
}

/** Clé de regroupement : « Poisson / Purée » et « poisson/purée » sont le même plat. */
export function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildIndex(meals: Meal[]): Map<string, Dish> {
  const dishes = new Map<string, Dish>();
  const spellings = new Map<string, Map<string, number>>();

  for (const meal of meals) {
    const key = normalize(meal.name);
    if (!key) continue;
    let dish = dishes.get(key);
    if (!dish) {
      dish = { key, label: meal.name.trim(), generic: /^restes?\b/.test(key), occurrences: [] };
      dishes.set(key, dish);
      spellings.set(key, new Map());
    }
    dish.occurrences.push({
      day: dayNumber(meal.date),
      slot: meal.slot,
      weekday: weekday(meal.date),
      month: monthOf(meal.date),
    });
    const counts = spellings.get(key)!;
    const spelling = meal.name.trim();
    counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
  }

  // On affiche l'orthographe la plus utilisée.
  for (const [key, counts] of spellings) {
    let best = '';
    let bestCount = 0;
    for (const [spelling, count] of counts) {
      if (count > bestCount) {
        best = spelling;
        bestCount = count;
      }
    }
    dishes.get(key)!.label = best;
  }
  return dishes;
}

const HALF_LIFE_DAYS = 3 * 365;

function seasonWeight(a: number, b: number): number {
  const diff = Math.abs(a - b);
  const distance = Math.min(diff, 12 - diff);
  if (distance === 0) return 1;
  if (distance === 1) return 0.7;
  if (distance === 2) return 0.4;
  return 0.15;
}

function cooldown(gapDays: number): number {
  if (gapDays < 7) return 0.05;
  if (gapDays < 14) return 0.4;
  if (gapDays < 21) return 0.8;
  return 1;
}

/**
 * Classe les plats connus pour un créneau donné.
 *
 * Un plat monte dans le classement s'il a été mangé souvent, récemment (les goûts
 * changent : un repas d'il y a 3 ans compte moitié moins), à la même saison, au même
 * créneau et le même jour de la semaine. Il redescend s'il est déjà prévu ou mangé
 * à moins de trois semaines de la date visée.
 */
export function suggest(
  dishes: Map<string, Dish>,
  date: string,
  slot: Slot,
  exclude: ReadonlySet<string> = new Set(),
  today: string = todayIso(),
): Suggestion[] {
  const target = dayNumber(date);
  const now = dayNumber(today);
  const targetWeekday = weekday(date);
  const targetMonth = monthOf(date);
  const out: Suggestion[] = [];

  for (const dish of dishes.values()) {
    if (exclude.has(dish.key)) continue;
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

    const score = base * (dish.generic ? 1 : cooldown(nearestGap));
    out.push({
      key: dish.key,
      label: dish.label,
      score,
      count,
      reason: Number.isFinite(lastEaten) ? `${count} fois · ${ago(now - lastEaten)}` : `${count} fois`,
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
  const last = Math.max(...past.map((m) => dayNumber(m.date)));
  const first = Math.max(last - 364, Math.min(...past.map((m) => dayNumber(m.date))));
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

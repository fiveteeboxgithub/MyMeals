import { dayNumber, monthOf } from './dates';
import { normalize, type DishIndex } from './suggest';
import type { Meal } from './types';

export interface DishCount {
  label: string;
  count: number;
}

/** Repas du même jour (mois et jour) les années précédentes, du plus récent au plus ancien. */
export function onThisDay(meals: Meal[], today: string): { year: number; meals: Meal[] }[] {
  const monthDay = today.slice(5);
  const thisYear = Number(today.slice(0, 4));
  const byYear = new Map<number, Meal[]>();
  for (const meal of meals) {
    if (meal.date.slice(5) !== monthDay) continue;
    const year = Number(meal.date.slice(0, 4));
    if (year >= thisYear) continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(meal);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, meals: list.sort((a, b) => (a.slot === b.slot ? 0 : a.slot === 'midi' ? -1 : 1)) }));
}

/** Plats les plus mangés parmi les repas retenus (sans les « restes »), regroupés comme les propositions. */
function countDishes(index: DishIndex, meals: Meal[], limit: number): DishCount[] {
  const counts = new Map<string, number>();
  for (const meal of meals) {
    const dish = index.byKey.get(normalize(meal.name));
    if (!dish || dish.generic) continue;
    counts.set(dish.key, (counts.get(dish.key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ label: index.byKey.get(key)!.label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Les plus mangés pendant les `days` derniers jours. */
export function topDishes(index: DishIndex, meals: Meal[], today: string, days = 365, limit = 10): DishCount[] {
  const end = dayNumber(today);
  return countDishes(index, meals.filter((m) => dayNumber(m.date) <= end && dayNumber(m.date) > end - days), limit);
}

/** Les plus mangés à cette saison (le mois en cours et ses voisins), toutes années confondues. */
export function seasonTop(index: DishIndex, meals: Meal[], today: string, limit = 8): DishCount[] {
  const month = monthOf(today);
  const near = (m: number) => {
    const diff = Math.abs(m - month);
    return Math.min(diff, 12 - diff) <= 1;
  };
  const end = dayNumber(today);
  return countDishes(index, meals.filter((m) => dayNumber(m.date) <= end && near(monthOf(m.date))), limit);
}

/** Nombre de plats goûtés pour la première fois, par année (les « restes » ne comptent pas). */
export function newDishesByYear(index: DishIndex, today: string): { year: number; count: number }[] {
  const end = dayNumber(today);
  const counts = new Map<number, number>();
  for (const dish of index.dishes) {
    if (dish.generic) continue;
    const first = Math.min(...dish.occurrences.map((o) => o.day));
    if (first > end) continue;
    const year = new Date(first * 86_400_000).getUTCFullYear();
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  const years = [...counts.keys()];
  if (years.length === 0) return [];
  const out: { year: number; count: number }[] = [];
  for (let year = Math.min(...years); year <= Math.max(...years); year++) out.push({ year, count: counts.get(year) ?? 0 });
  return out;
}

/** Chiffres de l'année en cours, jusqu'à aujourd'hui. */
export function yearSummary(index: DishIndex, meals: Meal[], today: string, blacklistKeys: ReadonlySet<string>) {
  const year = today.slice(0, 4);
  const done = meals.filter((m) => m.date.startsWith(year) && m.date <= today);
  const keys = new Set<string>();
  let listed = 0;
  for (const meal of done) {
    const dish = index.byKey.get(normalize(meal.name));
    if (!dish) continue;
    if (!dish.generic) keys.add(dish.key);
    if (blacklistKeys.has(dish.key)) listed++;
  }
  const fresh = newDishesByYear(index, today).find((y) => String(y.year) === year)?.count ?? 0;
  return { year, meals: done.length, dishes: keys.size, newDishes: fresh, listed };
}

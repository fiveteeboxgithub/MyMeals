import { useCallback, useState } from 'react';
import type { Meal, Slot } from './types';

const STORAGE_KEY = 'mymeals.v1';

function load(): Meal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(meals: Meal[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meals));
  } catch {
    // Stockage indisponible ou plein : l'app reste utilisable pour la session.
  }
}

export function useMeals() {
  const [meals, setMeals] = useState<Meal[]>(load);

  const update = useCallback((fn: (current: Meal[]) => Meal[]) => {
    setMeals((current) => {
      const next = fn(current);
      save(next);
      return next;
    });
  }, []);

  /** Ajoute les repas importés ; un repas déjà importé (même identifiant) est mis à jour. */
  const importMeals = useCallback(
    (imported: Meal[]) => {
      update((current) => {
        const byId = new Map(current.map((m) => [m.id, m]));
        for (const meal of imported) byId.set(meal.id, meal);
        return [...byId.values()];
      });
    },
    [update],
  );

  /** Remplace le contenu d'un créneau par un seul plat. */
  const setSlot = useCallback(
    (date: string, slot: Slot, name: string) => {
      update((current) => [
        ...current.filter((m) => !(m.date === date && m.slot === slot)),
        { id: `app-${date}-${slot}-${Date.now()}`, date, slot, name: name.trim(), source: 'app' },
      ]);
    },
    [update],
  );

  const clearSlot = useCallback(
    (date: string, slot: Slot) => {
      update((current) => current.filter((m) => !(m.date === date && m.slot === slot)));
    },
    [update],
  );

  const clearAll = useCallback(() => update(() => []), [update]);

  const renameMeals = useCallback(
    async (ids: string[], rawName: string) => {
      const name = rawName.trim();
      const wanted = new Set(ids);
      const renamed = name ? meals.filter((m) => wanted.has(m.id) && m.name !== name).length : 0;
      if (name) update((current) => current.map((m) => (wanted.has(m.id) ? { ...m, name } : m)));
      return { renamed, failed: 0 };
    },
    [meals, update],
  );

  return { meals, importMeals, setSlot, clearSlot, clearAll, renameMeals };
}

const SKIPPED_KEY = 'mymeals.skipped.v1';

/**
 * Créneaux marqués « pas de repas » (clés « AAAA-MM-JJ|créneau »). Ils sont gardés
 * dans ce navigateur seulement ; les créneaux passés sont oubliés au chargement.
 */
export function useSkippedSlots(today: string) {
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(SKIPPED_KEY) ?? '[]') as unknown;
      return new Set(Array.isArray(stored) ? stored.filter((k): k is string => typeof k === 'string' && k >= today) : []);
    } catch {
      return new Set<string>();
    }
  });

  const setSkip = useCallback((key: string, skip: boolean) => {
    setSkipped((current) => {
      if (current.has(key) === skip) return current;
      const next = new Set(current);
      if (skip) next.add(key);
      else next.delete(key);
      try {
        localStorage.setItem(SKIPPED_KEY, JSON.stringify([...next]));
      } catch {
        // stockage indisponible : le choix vaut pour cette session
      }
      return next;
    });
  }, []);

  return { skipped, setSkip };
}

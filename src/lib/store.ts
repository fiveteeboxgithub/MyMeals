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

  return { meals, importMeals, setSlot, clearSlot, clearAll };
}

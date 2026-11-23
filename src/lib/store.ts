import { useCallback, useState } from 'react';
import { MAX_MEMO_CHARS, memoRoom, newMemoId, type Memo } from './memos';
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

/** Le repas avec cette note (une note vide retire le champ). */
export function withNote(meal: Meal, note: string): Meal {
  if (note) return { ...meal, note };
  const { note: _removed, ...rest } = meal;
  return rest;
}

const MEMOS_KEY = 'mymeals.memos';

function loadMemos(): Memo[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMOS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((m): m is Memo => typeof m?.id === 'string' && typeof m?.text === 'string' && typeof m?.at === 'number')
      : [];
  } catch {
    return [];
  }
}

/** Fridge memo sans Google : gardé dans le navigateur, comme les repas. */
export function useLocalMemos() {
  const [memos, setMemos] = useState<Memo[]>(loadMemos);
  const save = (next: Memo[]) => {
    setMemos(next);
    try {
      localStorage.setItem(MEMOS_KEY, JSON.stringify(next));
    } catch {
      // stockage plein : le mémo vaut pour cette session
    }
  };
  const addMemo = (raw: string): 'ok' | 'full' | 'empty' => {
    const text = raw.trim().slice(0, MAX_MEMO_CHARS);
    if (!text) return 'empty';
    if (memoRoom(memos, text) === 'full') return 'full';
    save([{ id: newMemoId(), text, at: Date.now() }, ...memos]);
    return 'ok';
  };
  const removeMemo = (id: string) => save(memos.filter((m) => m.id !== id));
  return { memos, addMemo, removeMemo };
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

  /**
   * Donne un plat au créneau : le premier repas du créneau est renommé (les autres, s'il y en a,
   * restent), ou un repas est créé si le créneau est vide. Même règle qu'avec Google Agenda.
   */
  const setSlot = useCallback(
    (date: string, slot: Slot, rawName: string) => {
      const name = rawName.trim();
      if (!name) return;
      update((current) => {
        const first = current.find((m) => m.date === date && m.slot === slot);
        if (first) return current.map((m) => (m === first ? { ...m, name } : m));
        return [...current, { id: `app-${date}-${slot}-${Date.now()}`, date, slot, name, source: 'app' }];
      });
    },
    [update],
  );

  const addMeal = useCallback(
    (date: string, slot: Slot, rawName: string) => {
      const name = rawName.trim();
      if (!name) return;
      update((current) => [...current, { id: `app-${date}-${slot}-${Date.now()}`, date, slot, name, source: 'app' }]);
    },
    [update],
  );

  const removeMeal = useCallback((id: string) => update((current) => current.filter((m) => m.id !== id)), [update]);

  const clearSlot = useCallback(
    (date: string, slot: Slot) => {
      update((current) => current.filter((m) => !(m.date === date && m.slot === slot)));
    },
    [update],
  );

  const moveMeal = useCallback(
    (id: string, date: string, slot: Slot) => update((current) => current.map((m) => (m.id === id ? { ...m, date, slot } : m))),
    [update],
  );

  const setNote = useCallback(
    (id: string, note: string) => update((current) => current.map((m) => (m.id === id ? withNote(m, note.trim()) : m))),
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

  return { meals, importMeals, setSlot, addMeal, clearSlot, removeMeal, clearAll, renameMeals, setNote, moveMeal, toggleLike: () => undefined };
}

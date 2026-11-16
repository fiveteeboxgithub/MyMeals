export type Slot = 'midi' | 'soir';

export const SLOTS: Slot[] = ['midi', 'soir'];

/** Avant cette heure, un repas compte pour le midi ; après, pour le soir. */
export const LUNCH_LIMIT_HOUR = 16;

export interface Meal {
  id: string;
  /** Date locale au format AAAA-MM-JJ */
  date: string;
  slot: Slot;
  name: string;
  source: 'import' | 'app' | 'google';
}

/** Ce dont le planning a besoin, que les repas viennent du navigateur ou de Google Agenda. */
export interface MealStore {
  meals: Meal[];
  setSlot: (date: string, slot: Slot, name: string) => void;
  clearSlot: (date: string, slot: Slot) => void;
  /** Donne le même nom à tous les repas indiqués. Renvoie le nombre de repas renommés ou en échec. */
  renameMeals: (ids: string[], name: string) => Promise<{ renamed: number; failed: number }>;
}

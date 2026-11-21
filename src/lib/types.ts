import type { SettingsRecord } from './settings';
export type { ImagesSync } from './customImages';

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
  /** Note libre (lien de recette, « trop salé »…) : la description de l'événement Google. */
  note?: string;
}

/** Ce dont le planning a besoin, que les repas viennent du navigateur ou de Google Agenda. */
/** Réglages partagés via l'agenda (mode Google) : ceux lus dans l'agenda, et de quoi les y enregistrer. */
export interface SettingsSync {
  /** undefined tant qu'ils n'ont pas été lus, null s'ils n'existent pas encore. */
  remote: SettingsRecord | null | undefined;
  save: (record: SettingsRecord) => void;
}

/** Résultat de l'ajout d'un nom à la liste noire. */
export type BlacklistOutcome = 'added' | 'already' | 'full';

export interface MealStore {
  meals: Meal[];
  setSlot: (date: string, slot: Slot, name: string) => void;
  /** Ajoute un repas au créneau sans toucher à ceux qui y sont déjà. */
  addMeal: (date: string, slot: Slot, name: string) => void;
  clearSlot: (date: string, slot: Slot) => void;
  /** Retire un seul repas (utile quand un créneau en contient plusieurs). */
  removeMeal: (id: string) => void;
  /** Donne le même nom à tous les repas indiqués. Renvoie le nombre de repas renommés ou en échec. */
  renameMeals: (ids: string[], name: string) => Promise<{ renamed: number; failed: number }>;
  /** Déplace un repas vers un autre jour ou créneau (sa note le suit). */
  moveMeal: (id: string, date: string, slot: Slot) => void;
  /** Remplace la note d'un repas (texte vide : la retire). */
  setNote: (id: string, note: string) => void;
}

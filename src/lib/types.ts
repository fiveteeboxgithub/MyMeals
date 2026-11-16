export type Slot = 'midi' | 'soir';

export const SLOTS: Slot[] = ['midi', 'soir'];

export interface Meal {
  id: string;
  /** Date locale au format AAAA-MM-JJ */
  date: string;
  slot: Slot;
  name: string;
  source: 'import' | 'app';
}

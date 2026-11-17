/** Clés de stockage de l'appareil (localStorage). */
export const KEYS = {
  blacklistText: 'mymeals.blacklist.text',
  includeBlacklist: 'mymeals.blacklist.include',
  randomness: 'mymeals.randomness',
  historyMonths: 'mymeals.historyMonths',
  surprisePeriod: 'mymeals.surprise.months',
  ideasText: 'mymeals.ideas.text',
  favoritesText: 'mymeals.favorites.text',
  lunchTime: 'mymeals.time.midi',
  dinnerTime: 'mymeals.time.soir',
  slotMode: 'mymeals.slotMode',
  pendingOnly: 'mymeals.pendingOnly',
  calendars: 'mymeals.calendars.shown',
} as const;

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // le réglage vaudra pour cette session
  }
}

/** Nombre enregistré, s'il fait partie des valeurs permises. */
export function readChoice(key: string, allowed: number[], fallback: number): number {
  const raw = readPref(key);
  const value = raw === null ? NaN : Number(raw);
  return allowed.includes(value) ? value : fallback;
}

/** Demande au navigateur de ne pas effacer les données de l'application quand il manque de place. */
export function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    // pas pris en charge : sans conséquence
  }
}

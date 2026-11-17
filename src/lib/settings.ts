import { DEFAULT_HISTORY_MONTHS, DEFAULT_RANDOMNESS, HISTORY_WINDOWS, RANDOMNESS_LEVELS } from './suggest';
import { DEFAULT_PERIOD_MONTHS, PERIODS } from './surprise';

/**
 * Réglages partagés entre tes appareils (et avec le foyer), enregistrés dans l'événement spécial de
 * l'agenda. Les réglages d'affichage (couleurs, créneaux affichés, « à décider seulement ») restent
 * propres à chaque appareil.
 */
export interface SharedSettings {
  blacklistText: string;
  includeBlacklist: boolean;
  randomness: number;
  historyMonths: number;
  surprisePeriod: number;
}

/** Réglages et date (en ms) de leur dernière modification : la plus récente l'emporte. */
export interface SettingsRecord {
  updatedAt: number;
  settings: SharedSettings;
}

export const DEFAULT_SETTINGS: SharedSettings = {
  blacklistText: '',
  includeBlacklist: false,
  randomness: DEFAULT_RANDOMNESS,
  historyMonths: DEFAULT_HISTORY_MONTHS,
  surprisePeriod: DEFAULT_PERIOD_MONTHS,
};

const MAX_BLACKLIST_CHARS = 4000;

/** Valide ce qui vient de l'agenda (qui a pu être modifié à la main) : une valeur douteuse retombe sur le défaut. */
export function parseSettingsRecord(payload: unknown): SettingsRecord | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { updatedAt, settings } = payload as { updatedAt?: unknown; settings?: unknown };
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || typeof settings !== 'object' || settings === null) return null;
  const s = settings as Record<string, unknown>;
  const pick = (value: unknown, allowed: number[], fallback: number) =>
    typeof value === 'number' && allowed.includes(value) ? value : fallback;
  return {
    updatedAt,
    settings: {
      blacklistText: typeof s.blacklistText === 'string' ? s.blacklistText.slice(0, MAX_BLACKLIST_CHARS) : DEFAULT_SETTINGS.blacklistText,
      includeBlacklist: s.includeBlacklist === true,
      randomness: pick(s.randomness, RANDOMNESS_LEVELS.map((_, i) => i), DEFAULT_SETTINGS.randomness),
      historyMonths: pick(s.historyMonths, HISTORY_WINDOWS.map((w) => w.months), DEFAULT_SETTINGS.historyMonths),
      surprisePeriod: pick(s.surprisePeriod, PERIODS.map((p) => p.months), DEFAULT_SETTINGS.surprisePeriod),
    },
  };
}

export type SyncDecision = 'adopt-remote' | 'push-local' | 'none';

/**
 * Compare les réglages de cet appareil à ceux de l'agenda.
 * `remote` : undefined tant qu'on ne les a pas lus, null s'ils n'existent pas encore.
 * `localUpdatedAt` : 0 si rien n'a jamais été réglé ici.
 */
export function decideSync(localUpdatedAt: number, remote: SettingsRecord | null | undefined): SyncDecision {
  if (remote === undefined) return 'none';
  if (remote === null) return localUpdatedAt > 0 ? 'push-local' : 'none';
  if (remote.updatedAt > localUpdatedAt) return 'adopt-remote';
  if (remote.updatedAt < localUpdatedAt) return 'push-local';
  return 'none';
}

/** Date de dernière modification des réglages sur cet appareil. */
const STAMP_KEY = 'mymeals.settings.updatedAt';

export function loadSettingsStamp(hasCustomSettings: boolean): number {
  try {
    const stored = Number(localStorage.getItem(STAMP_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
    // illisible : voir ci-dessous
  }
  // Réglages faits avant la synchronisation : plus anciens que tout réglage enregistré dans l'agenda,
  // mais envoyés s'il n'y en a pas encore.
  return hasCustomSettings ? 1 : 0;
}

export function saveSettingsStamp(stamp: number): void {
  try {
    localStorage.setItem(STAMP_KEY, String(stamp));
  } catch {
    // le choix vaudra pour cette session
  }
}

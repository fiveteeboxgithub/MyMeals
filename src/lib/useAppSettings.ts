import { useCallback, useEffect, useRef, useState } from 'react';
import { KEYS, readChoice, readPref, requestPersistentStorage, writePref } from './prefs';
import {
  DEFAULT_SETTINGS,
  MAX_BLACKLIST_CHARS,
  MAX_FAVORITES_CHARS,
  MAX_IDEAS_CHARS,
  MAX_SKIPPED,
  decideSync,
  parseSkipped,
  loadSettingsStamp,
  sameSettings,
  saveSettingsStamp,
  validTime,
  type SharedSettings,
} from './settings';
import { HISTORY_WINDOWS, RANDOMNESS_LEVELS } from './suggest';
import { PERIODS } from './surprise';
import type { SettingsSync } from './types';

/** Réglages partagés tels qu'enregistrés sur cet appareil. */
export function loadSharedSettings(): SharedSettings {
  return {
    blacklistText: (readPref(KEYS.blacklistText) ?? '').slice(0, MAX_BLACKLIST_CHARS),
    includeBlacklist: readPref(KEYS.includeBlacklist) === '1',
    useRatings: readPref(KEYS.useRatings) !== '0',
    favoritesText: (readPref(KEYS.favoritesText) ?? '').slice(0, MAX_FAVORITES_CHARS),
    randomness: readChoice(KEYS.randomness, RANDOMNESS_LEVELS.map((_, i) => i), DEFAULT_SETTINGS.randomness),
    historyMonths: readChoice(KEYS.historyMonths, HISTORY_WINDOWS.map((w) => w.months), DEFAULT_SETTINGS.historyMonths),
    surprisePeriod: readChoice(KEYS.surprisePeriod, PERIODS.map((p) => p.months), DEFAULT_SETTINGS.surprisePeriod),
    ideasText: (readPref(KEYS.ideasText) ?? '').slice(0, MAX_IDEAS_CHARS),
    lunchTime: validTime(readPref(KEYS.lunchTime)) ?? DEFAULT_SETTINGS.lunchTime,
    dinnerTime: validTime(readPref(KEYS.dinnerTime)) ?? DEFAULT_SETTINGS.dinnerTime,
    skippedSlots: parseSkipped(readPref(KEYS.skippedSlots) ?? legacySkipped()).slice(-MAX_SKIPPED).join(','),
  };
}

/** Créneaux « Pas de repas » enregistrés par une version précédente, sur cet appareil seulement. */
function legacySkipped(): string {
  try {
    const stored = JSON.parse(readPref(KEYS.skippedLegacy) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((k) => typeof k === 'string').join(',') : '';
  } catch {
    return '';
  }
}

function saveSharedSettings(settings: SharedSettings): void {
  writePref(KEYS.blacklistText, settings.blacklistText);
  writePref(KEYS.includeBlacklist, settings.includeBlacklist ? '1' : '0');
  writePref(KEYS.useRatings, settings.useRatings ? '1' : '0');
  writePref(KEYS.randomness, String(settings.randomness));
  writePref(KEYS.historyMonths, String(settings.historyMonths));
  writePref(KEYS.surprisePeriod, String(settings.surprisePeriod));
  writePref(KEYS.ideasText, settings.ideasText);
  writePref(KEYS.favoritesText, settings.favoritesText);
  writePref(KEYS.lunchTime, settings.lunchTime);
  writePref(KEYS.dinnerTime, settings.dinnerTime);
  writePref(KEYS.skippedSlots, settings.skippedSlots);
}

/**
 * Réglages partagés : gardés sur l'appareil, et (avec Google) envoyés à l'événement spécial de l'agenda
 * ou repris de lui, le plus récent l'emportant. `onAdopt` est appelé quand ceux de l'agenda remplacent
 * ceux de l'appareil.
 */
export function useAppSettings(sync: SettingsSync | undefined, onAdopt?: () => void) {
  const [shared, setShared] = useState(loadSharedSettings);
  const [stamp, setStamp] = useState(() => loadSettingsStamp(!sameSettings(loadSharedSettings(), DEFAULT_SETTINGS)));
  const sharedRef = useRef(shared);
  sharedRef.current = shared;
  const onAdoptRef = useRef(onAdopt);
  onAdoptRef.current = onAdopt;

  const update = useCallback((patch: Partial<SharedSettings>) => {
    const next = { ...sharedRef.current, ...patch };
    next.blacklistText = next.blacklistText.slice(0, MAX_BLACKLIST_CHARS);
    next.ideasText = next.ideasText.slice(0, MAX_IDEAS_CHARS);
    sharedRef.current = next;
    setShared(next);
    saveSharedSettings(next);
    requestPersistentStorage();
    const now = Date.now();
    setStamp(now);
    saveSettingsStamp(now);
  }, []);

  const remote = sync?.remote;
  const save = sync?.save;
  useEffect(() => {
    if (!save) return;
    const decision = decideSync(stamp, remote);
    if (decision === 'adopt-remote' && remote) {
      sharedRef.current = remote.settings;
      setShared(remote.settings);
      saveSharedSettings(remote.settings);
      setStamp(remote.updatedAt);
      saveSettingsStamp(remote.updatedAt);
      onAdoptRef.current?.();
    } else if (decision === 'push-local') {
      save({ updatedAt: stamp, settings: sharedRef.current });
    }
  }, [remote, save, stamp]);

  return { shared, update };
}

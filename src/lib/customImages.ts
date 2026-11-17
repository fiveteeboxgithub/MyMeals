import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { decideSync } from './settings';

/**
 * Images choisies à la main pour des plats : adresse d'une image par plat (clé : `imageKey`).
 * Avec Google, elles sont partagées via un second événement spécial de l'agenda (le plus récent
 * l'emporte, comme les réglages) ; sinon elles restent dans ce navigateur.
 */
export interface ImagesRecord {
  updatedAt: number;
  images: Record<string, string>;
}

/** Ce que l'agenda en sait (mode Google), et de quoi y enregistrer. */
export interface ImagesSync {
  /** undefined tant qu'elles n'ont pas été lues, null si l'événement n'existe pas encore. */
  remote: ImagesRecord | null | undefined;
  save: (record: ImagesRecord) => void;
}

export const MAX_IMAGE_URL = 1000;
const STORAGE_KEY = 'mymeals.images.custom';

/** Adresse d'image acceptée : https uniquement, sans espaces, de longueur raisonnable. */
export function validImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (url.length > MAX_IMAGE_URL || /\s/.test(url)) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Valide ce qui vient de l'agenda ou du navigateur. */
export function parseImagesRecord(payload: unknown): ImagesRecord | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { updatedAt, images } = payload as { updatedAt?: unknown; images?: unknown };
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || typeof images !== 'object' || images === null) return null;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(images as Record<string, unknown>)) {
    const url = validImageUrl(value);
    if (key && url) clean[key] = url;
  }
  return { updatedAt, images: clean };
}

function loadLocal(): ImagesRecord {
  try {
    return parseImagesRecord(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) ?? { updatedAt: 0, images: {} };
  } catch {
    return { updatedAt: 0, images: {} };
  }
}

function saveLocal(record: ImagesRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // le choix vaudra pour cette session
  }
}

export interface CustomImages {
  images: Readonly<Record<string, string>>;
  /** Donne une image à un plat (clé `imageKey`), ou la retire (null). */
  setImage: (key: string, url: string | null) => void;
}

/** Images choisies, gardées sur l'appareil et synchronisées avec l'agenda quand il y en a un. */
export function useCustomImages(sync: ImagesSync | undefined): CustomImages {
  const [record, setRecord] = useState(loadLocal);
  const recordRef = useRef(record);
  recordRef.current = record;

  const setImage = useCallback((key: string, url: string | null) => {
    const images = { ...recordRef.current.images };
    if (url) images[key] = url;
    else delete images[key];
    const next = { updatedAt: Date.now(), images };
    recordRef.current = next;
    setRecord(next);
    saveLocal(next);
  }, []);

  const remote = sync?.remote;
  const save = sync?.save;
  useEffect(() => {
    if (!save) return;
    const decision = decideSync(record.updatedAt, remote);
    if (decision === 'adopt-remote' && remote) {
      recordRef.current = remote;
      setRecord(remote);
      saveLocal(remote);
    } else if (decision === 'push-local') {
      save(record);
    }
  }, [record, remote, save]);

  return { images: record.images, setImage };
}

export const CustomImagesContext = createContext<CustomImages>({ images: {}, setImage: () => undefined });

export function useCustomImagesContext(): CustomImages {
  return useContext(CustomImagesContext);
}

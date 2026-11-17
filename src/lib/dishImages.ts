import { useEffect, useState } from 'react';
import { fold, leftoverOf, singular } from './suggest';

/**
 * Images des plats, cherchées sur Wikipédia en français (encyclopédie publique, images libres de
 * Wikimedia Commons). Aucune clé, aucun compte : seul le nom du plat est envoyé. Chaque plat n'est
 * cherché qu'une fois, puis gardé sur l'appareil.
 */
export interface DishImage {
  /** Miniature (upload.wikimedia.org). */
  url: string;
  /** Titre de l'article Wikipédia d'où vient l'image. */
  title: string;
}

const API = 'https://fr.wikipedia.org/w/api.php';
const CACHE_KEY = 'mymeals.images.v1';
const HIDDEN_KEY = 'mymeals.images.hidden';
/** Un plat sans image est recherché à nouveau au bout d'un mois. */
const RETRY_MISSING_MS = 30 * 24 * 3600_000;
const THUMB_SIZE = 240;

const STOP = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'au', 'aux', 'et', 'a', 'en', 'avec', 'sauce', 'maison', 'un', 'une', 'sur', 'son', 'sa']);

/** Ce qu'on cherche pour un libellé : « restes » retiré, la première partie d'un plat composé (« agneau/pates » → « agneau »). */
export function imageQuery(name: string): string {
  if (/^restes?\b/i.test(fold(name)) && !leftoverOf(name)) return '';
  const base = leftoverOf(name) ?? name;
  const first = base.split(/[/+,;]| - /)[0] ?? '';
  return first.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Mots significatifs, au singulier, sans accents. */
export function imageWords(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map(singular);
}

interface WikiPage {
  title: string;
  index?: number;
  missing?: boolean;
  thumbnail?: { source: string };
  pageprops?: { disambiguation?: string };
}

/** Choisit l'image parmi les pages renvoyées : une vraie page (pas d'homonymie), avec image, qui partage un mot avec le plat. */
export function pickImage(pages: WikiPage[] | undefined, query: string, exact: boolean): DishImage | null {
  if (!pages) return null;
  const wanted = new Set(imageWords(query));
  const sorted = [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const page of sorted) {
    if (page.missing || !page.thumbnail?.source || page.pageprops?.disambiguation !== undefined) continue;
    if (!exact && !imageWords(page.title).some((w) => wanted.has(w))) continue;
    return { url: page.thumbnail.source, title: page.title };
  }
  return null;
}

async function wiki(params: Record<string, string>): Promise<WikiPage[] | undefined> {
  const query = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    origin: '*',
    redirects: '1',
    prop: 'pageimages|pageprops',
    piprop: 'thumbnail',
    pithumbsize: String(THUMB_SIZE),
    ppprop: 'disambiguation',
    ...params,
  });
  const response = await fetch(`${API}?${query}`, { referrerPolicy: 'no-referrer', credentials: 'omit' });
  if (!response.ok) throw new Error(`Wikipédia : ${response.status}`);
  const data = (await response.json()) as { query?: { pages?: WikiPage[] } };
  return data.query?.pages;
}

/** Cherche l'image d'un plat : l'article du même nom d'abord, sinon les premiers résultats de recherche. */
export async function findDishImage(query: string): Promise<DishImage | null> {
  if (imageWords(query).length === 0) return null;
  const direct = pickImage(await wiki({ titles: query }), query, true);
  if (direct) return direct;
  return pickImage(await wiki({ generator: 'search', gsrsearch: query, gsrlimit: '5', gsrnamespace: '0' }), query, false);
}

type CacheEntry = { image: DishImage | null; at: number };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage plein : l'image sera cherchée à nouveau
  }
}

let cache: Record<string, CacheEntry> | null = null;
let hidden: Set<string> | null = null;
const inflight = new Map<string, Promise<DishImage | null>>();
const listeners = new Set<() => void>();
const queue: (() => void)[] = [];
let running = 0;

function cacheMap(): Record<string, CacheEntry> {
  cache ??= readJson<Record<string, CacheEntry>>(CACHE_KEY, {});
  return cache;
}

function hiddenSet(): Set<string> {
  hidden ??= new Set(readJson<string[]>(HIDDEN_KEY, []));
  return hidden;
}

/** Clé de cache d'un libellé : les mots cherchés, sans accents. */
export function imageKey(name: string): string {
  return fold(imageQuery(name));
}

/** Deux recherches à la fois au plus, pour rester discret avec Wikipédia. */
function limited<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      task()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < 2) run();
    else queue.push(run);
  });
}

function lookup(key: string, query: string): Promise<DishImage | null> {
  const known = cacheMap()[key];
  if (known && (known.image || Date.now() - known.at < RETRY_MISSING_MS)) return Promise.resolve(known.image);
  let pending = inflight.get(key);
  if (!pending) {
    pending = limited(() => findDishImage(query))
      .then((image) => {
        cacheMap()[key] = { image, at: Date.now() };
        writeJson(CACHE_KEY, cacheMap());
        return image;
      })
      .catch(() => null) // hors connexion ou Wikipédia indisponible : pas d'image cette fois
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

/** « Pas la bonne image » : ce plat n'en affiche plus (sur cet appareil). `false` la rétablit. */
export function hideDishImage(name: string, hide = true): void {
  const set = hiddenSet();
  if (hide) set.add(imageKey(name));
  else set.delete(imageKey(name));
  writeJson(HIDDEN_KEY, [...set]);
  for (const listener of listeners) listener();
}

/** Nombre de plats dont l'image a été écartée, et de quoi toutes les rétablir. */
export function hiddenImageCount(): number {
  return hiddenSet().size;
}

export function resetHiddenImages(): void {
  hidden = new Set();
  writeJson(HIDDEN_KEY, []);
  for (const listener of listeners) listener();
}

/** Image d'un plat (null s'il n'y en a pas, ou si les images sont désactivées). */
export function useDishImage(name: string | undefined, enabled: boolean): DishImage | null {
  const [image, setImage] = useState<DishImage | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    setImage(null);
    if (!enabled || !name) return;
    const key = imageKey(name);
    if (!key || hiddenSet().has(key)) return;
    let alive = true;
    void lookup(key, imageQuery(name)).then((found) => {
      if (alive) setImage(found);
    });
    return () => {
      alive = false;
    };
  }, [name, enabled, version]);
  return image;
}

/** Lien vers l'article Wikipédia d'une image (crédit et licence). */
export function articleUrl(image: DishImage): string {
  return `https://fr.wikipedia.org/wiki/${encodeURIComponent(image.title.replace(/ /g, '_'))}`;
}

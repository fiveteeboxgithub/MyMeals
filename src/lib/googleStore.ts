import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AuthError,
  SyncExpiredError,
  deleteEvent,
  setEventNote,
  eventToMeal,
  findCalendar,
  forgetToken,
  getAccount,
  SETTINGS_EVENT_ID,
  insertEvent,
  listCalendars,
  listChanges,
  listTimedEvents,
  loadGoogleSignIn,
  readSettingsEvent,
  readSpecialEvent,
  writeSpecialEvent,
  IMAGES_EVENT,
  IMAGES_EVENT_ID,
  renameEvent,
  moveEvent,
  setLikeEvent,
  patchSpecialShared,
  FRIDGE_EVENT,
  FRIDGE_EVENT_ID,
  signIn,
  storedToken,
  tokenRemainingMs,
  writeSettingsEvent,
  type CalendarInfo,
  type GoogleCalendar,
  type TimedEvent,
  type GoogleEvent,
} from './google';
import { parseSettingsRecord, type SettingsRecord } from './settings';
import { parseImagesRecord, type ImagesRecord } from './customImages';
import type { Meal, MealStore, Slot } from './types';
import { withNote } from './store';
import { clearLikes } from './people';
import { MAX_MEMO_CHARS, encodeMemo, memoKey, memoRoom, parseMemos, pickMemoId, type Memo } from './memos';

const CACHE_KEY = 'mymeals.google.v1';

interface Cache {
  calendar?: GoogleCalendar;
  /** Adresse du compte Google, pour renouveler la connexion sans demander de choisir un compte. */
  account?: string;
  syncToken?: string;
  /** Vrai une fois l'agenda relu en entier avec les notes (descriptions) des repas. */
  notes?: boolean;
  /** Vrai une fois l'agenda relu avec qui a choisi chaque plat et qui l'aime. */
  likes?: boolean;
  /** Fridge memo : mémos lus dans l'événement spécial, et propriétés vidées (réutilisables). */
  memos?: Memo[];
  memoFree?: string[];
  meals: Meal[];
}

function loadCache(): Cache {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cache | null;
    return parsed && Array.isArray(parsed.meals) ? parsed : { meals: [] };
  } catch {
    return { meals: [] };
  }
}

function applyEvents(meals: Meal[], events: GoogleEvent[]): Meal[] {
  const byId = new Map(meals.map((m) => [m.id, m]));
  for (const event of events) {
    const meal = eventToMeal(event);
    if (meal) byId.set(event.id, meal);
    else byId.delete(event.id);
  }
  return [...byId.values()];
}

/** Le repas devenu un autre plat : choisi par `me`, sans les « J'aime » de l'ancien. */
function changedDish(meal: Meal, name: string, me: string | undefined): Meal {
  const { likes: _likes, ...rest } = meal;
  return { ...rest, name, ...(me ? { by: me } : {}) };
}

/** Le repas sans ses « J'aime » (ils ne valent que pour un plat à un créneau). */
function withoutLikes(meal: Meal): Meal {
  const { likes: _likes, ...rest } = meal;
  return rest;
}

/** Repas en cours de création (pas encore dans l'agenda) : une relecture complète ne doit pas les effacer. */
function keepPending(meals: Meal[]): Meal[] {
  return meals.filter((m) => m.id.startsWith('tmp-'));
}

export interface GoogleMealStore extends MealStore {
  connected: boolean;
  /** Réglages lus dans l'événement spécial de l'agenda : undefined avant lecture, null s'il n'existe pas. */
  settings: SettingsRecord | null | undefined;
  saveSettings: (record: SettingsRecord) => void;
  /** Images choisies pour des plats, lues dans le second événement spécial. */
  images: ImagesRecord | null | undefined;
  saveImages: (record: ImagesRecord) => void;
  /** Adresse du compte connecté, si elle est connue. */
  account: string | undefined;
  /** L'agenda a déjà été lu au moins une fois (sur cet appareil). */
  synced: boolean;
  /** Identifiant de l'agenda des repas (pour l'exclure des « autres agendas »). */
  mealsCalendarId: string | undefined;
  /** Agendas de l'utilisateur (sans renouveler la connexion : null si elle n'est pas valable). */
  listCalendars: () => Promise<CalendarInfo[] | null>;
  /** Événements à heure fixe d'un agenda sur une période (null si la connexion n'est pas valable). */
  listTimedEvents: (calendarId: string, from: Date, to: Date) => Promise<TimedEvent[] | null>;
  /** Une connexion a déjà eu lieu : la reconnexion peut se faire d'un simple toucher. */
  canRenew: boolean;
  syncing: boolean;
  error: string;
  connect: () => void;
  disconnect: () => void;
  dismissError: () => void;
}

/**
 * Les repas vivent dans un agenda Google, qui reste la référence. Une copie est gardée
 * dans le navigateur pour afficher le planning tout de suite, même sans connexion.
 */
export function useGoogleMeals(clientId: string, calendarName: string): GoogleMealStore {
  const [cache, setCache] = useState<Cache>(loadCache);
  const [token, setToken] = useState<string | null>(storedToken);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  // Le message d'erreur actuel vient d'une connexion expirée : il disparaît dès qu'on est reconnecté et synchronisé.
  const authError = useRef(false);
  const clearAuthError = useCallback(() => {
    if (!authError.current) return;
    authError.current = false;
    setError('');
  }, []);
  const cacheRef = useRef(cache);
  const busy = useRef(false);
  const renewing = useRef<Promise<string | null> | null>(null);
  const lastRenewFailure = useRef(0);
  const lastRenewSuccess = useRef(0);
  const [settings, setSettings] = useState<SettingsRecord | null | undefined>(undefined);
  const settingsLoaded = useRef(false);
  const [images, setImages] = useState<ImagesRecord | null | undefined>(undefined);
  const imagesLoaded = useRef(false);
  const pendingSettings = useRef<SettingsRecord | null>(null);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Repas retirés pendant leur création : ils seront supprimés dès que Google leur aura donné un identifiant.
  const pendingDeletes = useRef(new Set<string>());
  // Mémos ajoutés ou supprimés ici mais pas encore confirmés par Google : une synchronisation ne doit pas les défaire.
  const pendingMemoAdds = useRef(new Map<string, Memo>());
  const pendingMemoRemoves = useRef(new Set<string>());

  const commit = useCallback((fn: (current: Cache) => Cache) => {
    const next = fn(cacheRef.current);
    cacheRef.current = next;
    setCache(next);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
      // stockage plein : la copie locale sera relue depuis Google au prochain lancement
    }
  }, []);

  const fail = useCallback((e: unknown) => {
    if (e instanceof AuthError) {
      // C'est ici, et seulement ici, qu'un refus de Google fait perdre la connexion.
      forgetToken();
      setToken(null);
    }
    authError.current = e instanceof AuthError;
    setError(e instanceof Error ? e.message : 'Erreur inattendue.');
  }, []);

  const sync = useCallback(
    async (accessToken: string) => {
      if (busy.current) return;
      busy.current = true;
      setSyncing(true);
      try {
        let calendar = cacheRef.current.calendar;
        if (!calendar) {
          calendar = (await findCalendar(accessToken, calendarName)) ?? undefined;
          if (!calendar) throw new Error(`L'agenda « ${calendarName} » est introuvable dans ce compte Google.`);
          const found = calendar;
          commit((c) => ({ ...c, calendar: found }));
        }
        if (!cacheRef.current.account) {
          // Sert seulement à renouveler la connexion plus discrètement : un échec ne gêne pas.
          const account = await getAccount(accessToken).catch(() => undefined);
          if (account) commit((c) => ({ ...c, account }));
        }
        let changes;
        // Les copies faites avant les notes sont relues en entier une fois, pour récupérer les descriptions.
        let full = !cacheRef.current.syncToken || !cacheRef.current.notes || !cacheRef.current.likes;
        try {
          changes = await listChanges(accessToken, calendar.id, full ? undefined : cacheRef.current.syncToken);
        } catch (e) {
          if (!(e instanceof SyncExpiredError)) throw e;
          full = true;
          changes = await listChanges(accessToken, calendar.id);
        }
        const { events, syncToken } = changes;
        commit((c) => ({ ...c, syncToken, notes: true, likes: true, meals: applyEvents(full ? keepPending(c.meals) : c.meals, events) }));
        // Fridge memo : relu quand son événement a changé (ou à chaque lecture complète).
        const fridge = events.find((event) => event.id === FRIDGE_EVENT_ID);
        if (fridge || full) {
          const parsed = fridge && fridge.status !== 'cancelled' ? parseMemos(fridge.extendedProperties?.shared) : { memos: [], free: [] };
          const kept = parsed.memos.filter((m) => !pendingMemoRemoves.current.has(m.id));
          for (const [id, memo] of pendingMemoAdds.current) if (!kept.some((m) => m.id === id)) kept.unshift(memo);
          commit((c) => ({ ...c, memos: kept, memoFree: parsed.free }));
        }
        // Les réglages se relisent une fois par session, et quand l'événement spécial a changé.
        if (!settingsLoaded.current || events.some((event) => event.id === SETTINGS_EVENT_ID)) {
          try {
            const found = await readSettingsEvent(accessToken, calendar);
            setSettings(found ? parseSettingsRecord(found.payload) : null);
            settingsLoaded.current = true;
          } catch (e) {
            if (e instanceof AuthError) throw e;
            // lecture impossible : les réglages de cet appareil restent seuls en vigueur
          }
        }
        if (!imagesLoaded.current || events.some((event) => event.id === IMAGES_EVENT_ID)) {
          try {
            const found = await readSpecialEvent(accessToken, calendar, IMAGES_EVENT);
            setImages(found ? parseImagesRecord(found.payload) : null);
            imagesLoaded.current = true;
          } catch (e) {
            if (e instanceof AuthError) throw e;
            // lecture impossible : les images choisies sur cet appareil restent seules
          }
        }
        // Reconnecté et synchronisé : l'avertissement de connexion expirée n'a plus lieu d'être.
        clearAuthError();
      } catch (e) {
        fail(e);
      } finally {
        busy.current = false;
        setSyncing(false);
      }
    },
    [calendarName, commit, fail, clearAuthError],
  );

  // Charge la connexion Google à l'avance, et resynchronise au retour sur l'application.
  useEffect(() => {
    loadGoogleSignIn().catch(() => undefined);
  }, []);

  // Relit l'agenda : à la connexion, au retour sur l'onglet ou la fenêtre, et toutes les trois minutes
  // tant que la page est visible (pour voir un repas ajouté depuis Google Agenda ou un autre appareil).
  useEffect(() => {
    if (!token) return;
    let last = Date.now();
    void sync(token);
    const refresh = (minGapMs: number) => {
      if (document.visibilityState !== 'visible' || Date.now() - last < minGapMs) return;
      last = Date.now();
      void sync(token);
    };
    const onVisible = () => refresh(10_000);
    const timer = setInterval(() => refresh(60_000), 180_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [token, sync]);

  const connect = useCallback(() => {
    setError('');
    signIn(clientId, { hint: cacheRef.current.account }).then(setToken, fail);
  }, [clientId, fail]);

  const disconnect = useCallback(() => {
    forgetToken();
    setToken(null);
    // Déconnexion voulue : on ne se reconnecte plus tout seul au prochain toucher.
    commit((c) => ({ ...c, calendar: undefined, account: undefined, syncToken: undefined }));
    setSettings(undefined);
    settingsLoaded.current = false;
    setImages(undefined);
    imagesLoaded.current = false;
  }, [commit]);

  /**
   * Demande un nouveau jeton à Google, sans rien afficher si le compte est connu. À appeler
   * pendant un toucher ou un clic (sinon le navigateur bloque la fenêtre). Plusieurs appels
   * simultanés partagent la même demande.
   */
  const renew = useCallback((): Promise<string | null> => {
    if (!renewing.current) {
      renewing.current = signIn(clientId, { hint: cacheRef.current.account })
        .then(
          (fresh) => {
            lastRenewSuccess.current = Date.now();
            setToken(fresh);
            clearAuthError();
            return fresh;
          },
          () => {
            lastRenewFailure.current = Date.now();
            return null;
          },
        )
        .finally(() => {
          renewing.current = null;
        });
    }
    return renewing.current;
  }, [clientId, clearAuthError]);

  const canRenew = cache.calendar !== undefined;

  // Le jeton Google ne dure qu'une heure. Au premier toucher après son expiration (ou dans ses
  // cinq dernières minutes), on le renouvelle : pas besoin de se reconnecter à la main.
  useEffect(() => {
    if (!canRenew) return;
    const onGesture = () => {
      // Jamais plus d'une fenêtre de reconnexion toutes les deux minutes, quoi qu'il arrive.
      if (renewing.current || Date.now() - lastRenewFailure.current < 60_000) return;
      if (Date.now() - lastRenewSuccess.current < 120_000) return;
      if (tokenRemainingMs() > 5 * 60_000) return;
      void renew();
    };
    document.addEventListener('pointerup', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
    return () => {
      document.removeEventListener('pointerup', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
    };
  }, [canRenew, renew]);

  /** Donne accès à l'agenda pour écrire, en renouvelant la connexion si elle a expiré. */
  const access = useCallback(async (): Promise<{ token: string; calendar: GoogleCalendar } | null> => {
    const calendar = cacheRef.current.calendar;
    if (!calendar) {
      setError("Connecte-toi à Google pour modifier l'agenda.");
      return null;
    }
    const fresh = storedToken() ?? (await renew());
    if (!fresh) {
      setToken(null);
      authError.current = true;
      setError('La connexion Google a expiré : reconnecte-toi, puis recommence.');
      return null;
    }
    return { token: fresh, calendar };
  }, [renew]);

  /** Exécute une écriture tout de suite si la connexion est valable, sinon après l'avoir renouvelée. */
  const withAccess = useCallback(
    (action: (a: { token: string; calendar: GoogleCalendar }) => void) => {
      const calendar = cacheRef.current.calendar;
      const fresh = storedToken();
      if (calendar && fresh) {
        action({ token: fresh, calendar });
        return;
      }
      void access().then((a) => {
        if (a) action(a);
      });
    },
    [access],
  );

  /** Crée un événement pour un repas (affiché tout de suite, avec un identifiant provisoire). */
  const insertMeal = useCallback(
    (a: { token: string; calendar: GoogleCalendar }, date: string, slot: Slot, name: string) => {
      const tempId = `tmp-${date}-${slot}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const me = cacheRef.current.account;
      commit((c) => ({ ...c, meals: [...c.meals, { id: tempId, date, slot, name, source: 'google', ...(me ? { by: me } : {}) }] }));
      insertEvent(a.token, a.calendar, date, slot, name, me).then(
        (event) => {
          if (pendingDeletes.current.delete(tempId)) {
            deleteEvent(a.token, a.calendar, event.id).catch(fail);
            return;
          }
          commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === tempId ? { ...m, id: event.id } : m)) }));
        },
        (e) => {
          commit((c) => ({ ...c, meals: c.meals.filter((m) => m.id !== tempId) }));
          fail(e);
        },
      );
    },
    [commit, fail],
  );

  /** Ajoute un repas au créneau, même s'il en a déjà un (un événement de plus, à la même heure). */
  const addMeal = useCallback(
    (date: string, slot: Slot, rawName: string) => {
      const name = rawName.trim();
      if (name) withAccess((a) => insertMeal(a, date, slot, name));
    },
    [insertMeal, withAccess],
  );

  const setSlot = useCallback(
    (date: string, slot: Slot, rawName: string) => {
      const name = rawName.trim();
      if (!name) return;
      withAccess((a) => {
        const existing = cacheRef.current.meals.find((m) => m.date === date && m.slot === slot);
        if (existing) {
          // Le créneau a déjà un événement : on change seulement son titre.
          // Un autre plat : c'est moi qui l'ai choisi, et les « J'aime » de l'ancien plat tombent.
          const me = cacheRef.current.account;
          commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === existing.id ? changedDish(m, name, me) : m)) }));
          renameEvent(a.token, a.calendar, existing.id, name, { by: me, clear: clearLikes(existing) }).catch((e) => {
            commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === existing.id ? existing : m)) }));
            fail(e);
          });
        } else {
          insertMeal(a, date, slot, name);
        }
      });
    },
    [commit, fail, withAccess, insertMeal],
  );

  const clearSlot = useCallback(
    (date: string, slot: Slot) => {
      withAccess((a) => {
        const removed = cacheRef.current.meals.filter((m) => m.date === date && m.slot === slot);
        commit((c) => ({ ...c, meals: c.meals.filter((m) => !removed.includes(m)) }));
        for (const meal of removed) {
          if (meal.id.startsWith('tmp-')) {
            pendingDeletes.current.add(meal.id);
            continue;
          }
          deleteEvent(a.token, a.calendar, meal.id).catch((e) => {
            commit((c) => ({ ...c, meals: [...c.meals, meal] }));
            fail(e);
          });
        }
      });
    },
    [commit, fail, withAccess],
  );

  /** Retire un seul repas de l'agenda. */
  const removeMeal = useCallback(
    (id: string) => {
      // Un repas encore en cours de création sera supprimé dès que Google lui aura donné un identifiant.
      if (id.startsWith('tmp-')) {
        pendingDeletes.current.add(id);
        commit((c) => ({ ...c, meals: c.meals.filter((m) => m.id !== id) }));
        return;
      }
      withAccess((a) => {
        const meal = cacheRef.current.meals.find((m) => m.id === id);
        if (!meal) return;
        commit((c) => ({ ...c, meals: c.meals.filter((m) => m.id !== id) }));
        deleteEvent(a.token, a.calendar, id).catch((e) => {
          commit((c) => ({ ...c, meals: [...c.meals, meal] }));
          fail(e);
        });
      });
    },
    [commit, fail, withAccess],
  );

  /** Ajoute un mémo : une propriété de plus sur l'événement spécial, sans toucher à celles des autres. */
  const addMemo = useCallback(
    (raw: string): 'ok' | 'full' | 'empty' => {
      const text = raw.trim().slice(0, MAX_MEMO_CHARS);
      if (!text) return 'empty';
      if (memoRoom(cacheRef.current.memos ?? [], text) === 'full') return 'full';
      const me = cacheRef.current.account;
      const { id, reused } = pickMemoId(cacheRef.current.memoFree ?? []);
      const memo: Memo = { id, text, at: Date.now(), ...(me ? { by: me } : {}) };
      pendingMemoAdds.current.set(id, memo);
      commit((c) => ({
        ...c,
        memos: [memo, ...(c.memos ?? []).filter((m) => m.id !== id)],
        memoFree: reused ? (c.memoFree ?? []).filter((f) => f !== id) : c.memoFree,
      }));
      withAccess((a) => {
        patchSpecialShared(a.token, a.calendar, FRIDGE_EVENT, { [memoKey(id)]: encodeMemo(memo) }).then(
          () => pendingMemoAdds.current.delete(id),
          (e) => {
            pendingMemoAdds.current.delete(id);
            commit((c) => ({ ...c, memos: (c.memos ?? []).filter((m) => m.id !== id) }));
            fail(e);
          },
        );
      });
      return 'ok';
    },
    [commit, fail, withAccess],
  );

  /** Supprime un mémo (le sien ou celui d'un autre) : sa propriété est vidée, les autres restent. */
  const removeMemo = useCallback(
    (id: string) => {
      const memo = (cacheRef.current.memos ?? []).find((m) => m.id === id);
      if (!memo) return;
      pendingMemoRemoves.current.add(id);
      pendingMemoAdds.current.delete(id);
      commit((c) => ({ ...c, memos: (c.memos ?? []).filter((m) => m.id !== id), memoFree: [...new Set([...(c.memoFree ?? []), id])] }));
      withAccess((a) => {
        patchSpecialShared(a.token, a.calendar, FRIDGE_EVENT, { [memoKey(id)]: '' }).then(
          () => pendingMemoRemoves.current.delete(id),
          (e) => {
            pendingMemoRemoves.current.delete(id);
            commit((c) => ({ ...c, memos: [memo, ...(c.memos ?? [])].sort((x, y) => y.at - x.at), memoFree: (c.memoFree ?? []).filter((f) => f !== id) }));
            fail(e);
          },
        );
      });
    },
    [commit, fail, withAccess],
  );

  /** J'aime ce repas (ou je ne l'aime plus) : visible de tous ceux qui partagent l'agenda. */
  const toggleLike = useCallback(
    (id: string) => {
      const me = cacheRef.current.account;
      const meal = cacheRef.current.meals.find((m) => m.id === id);
      if (!me || !meal || id.startsWith('tmp-') || !meal.by || meal.by === me) return;
      const liked = !(meal.likes ?? []).includes(me);
      withAccess((a) => {
        const likes = liked ? [...(meal.likes ?? []), me].sort() : (meal.likes ?? []).filter((e) => e !== me);
        commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === id ? (likes.length ? { ...m, likes } : withoutLikes(m)) : m)) }));
        setLikeEvent(a.token, a.calendar, id, me, liked).catch((e) => {
          commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === id ? meal : m)) }));
          fail(e);
        });
      });
    },
    [commit, fail, withAccess],
  );

  /** Déplace un repas vers un autre créneau (le même événement : sa note le suit). */
  const moveMeal = useCallback(
    (id: string, date: string, slot: Slot) => {
      withAccess((a) => {
        const meal = cacheRef.current.meals.find((m) => m.id === id);
        if (!meal || id.startsWith('tmp-') || (meal.date === date && meal.slot === slot)) return;
        commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === id ? { ...withoutLikes(m), date, slot } : m)) }));
        moveEvent(a.token, a.calendar, id, date, slot, clearLikes(meal)).catch((e) => {
          commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === id ? meal : m)) }));
          fail(e);
        });
      });
    },
    [commit, fail, withAccess],
  );

  /** Écrit la note d'un repas dans la description de son événement. */
  const setNote = useCallback(
    (id: string, rawNote: string) => {
      const note = rawNote.trim();
      withAccess((a) => {
        const meal = cacheRef.current.meals.find((m) => m.id === id);
        if (!meal || id.startsWith('tmp-') || (meal.note ?? '') === note) return;
        commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === id ? withNote(m, note) : m)) }));
        setEventNote(a.token, a.calendar, id, note).catch((e) => {
          commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === id ? withNote(m, meal.note ?? '') : m)) }));
          fail(e);
        });
      });
    },
    [commit, fail, withAccess],
  );

  /** Envoie les réglages en attente, si la connexion est valable (sinon ils attendent la prochaine). */
  const flushSettings = useCallback(() => {
    const record = pendingSettings.current;
    const fresh = storedToken();
    const calendar = cacheRef.current.calendar;
    if (!record || !fresh || !calendar) return;
    pendingSettings.current = null;
    writeSettingsEvent(fresh, calendar, record).then(
      () => setSettings(record),
      (e) => {
        pendingSettings.current ??= record;
        fail(e);
      },
    );
  }, [fail]);

  /** Enregistre les réglages dans l'événement spécial, un instant après la dernière modification. */
  const saveSettings = useCallback(
    (record: SettingsRecord) => {
      pendingSettings.current = record;
      clearTimeout(settingsTimer.current);
      settingsTimer.current = setTimeout(flushSettings, 1200);
    },
    [flushSettings],
  );

  /** Enregistre les images choisies dans leur événement spécial (rare : tout de suite). */
  const pendingImages = useRef<ImagesRecord | null>(null);
  const flushImages = useCallback(() => {
    const record = pendingImages.current;
    const fresh = storedToken();
    const calendar = cacheRef.current.calendar;
    if (!record || !fresh || !calendar) return;
    pendingImages.current = null;
    writeSpecialEvent(fresh, calendar, record, IMAGES_EVENT).then(
      () => setImages(record),
      (e) => {
        pendingImages.current ??= record;
        fail(e);
      },
    );
  }, [fail]);
  const saveImages = useCallback(
    (record: ImagesRecord) => {
      pendingImages.current = record;
      flushImages();
    },
    [flushImages],
  );
  useEffect(() => {
    if (token) flushImages();
  }, [token, flushImages]);

  // Une connexion toute neuve (ou renouvelée) envoie ce qui attendait.
  useEffect(() => {
    if (token) flushSettings();
  }, [token, flushSettings]);

  /** Renomme des événements de l'agenda, quelques-uns à la fois ; ceux qui échouent reprennent leur nom. */
  const renameMeals = useCallback(
    async (ids: string[], rawName: string, options?: { changeDish?: boolean }) => {
      const name = rawName.trim();
      const granted = await access();
      if (!granted || !name) return { renamed: 0, failed: granted ? 0 : ids.length };
      const wanted = new Set(ids);
      // Les repas pas encore créés dans l'agenda (identifiant provisoire) sont laissés de côté.
      const targets = cacheRef.current.meals.filter((m) => wanted.has(m.id) && !m.id.startsWith('tmp-') && m.name !== name);
      const me = cacheRef.current.account;
      commit((c) => ({
        ...c,
        meals: c.meals.map((m) => (targets.some((t) => t.id === m.id) ? (options?.changeDish ? changedDish(m, name, me) : { ...m, name }) : m)),
      }));
      const revert = (meal: Meal) =>
        commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === meal.id ? meal : m)) }));

      const queue = [...targets];
      let renamed = 0;
      let failed = 0;
      let stop = false;
      let lastError: unknown;
      const worker = async () => {
        while (!stop) {
          const meal = queue.shift();
          if (!meal) return;
          try {
            await renameEvent(granted.token, granted.calendar, meal.id, name, options?.changeDish ? { by: me, clear: clearLikes(meal) } : undefined);
            renamed++;
          } catch (e) {
            failed++;
            revert(meal);
            lastError = e;
            if (e instanceof AuthError) stop = true;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, targets.length) }, worker));
      for (const meal of queue) {
        failed++;
        revert(meal);
      }
      if (failed > 0) {
        if (lastError instanceof AuthError) fail(lastError);
        else fail(new Error(`${failed} repas ${failed > 1 ? "n'ont" : "n'a"} pas pu être renommé${failed > 1 ? 's' : ''} dans l'agenda. ${lastError instanceof Error ? lastError.message : ''}`.trim()));
      }
      return { renamed, failed };
    },
    [access, commit, fail],
  );

  const listCalendarsNow = useCallback(async () => {
    const fresh = storedToken();
    if (!fresh) return null;
    try {
      return await listCalendars(fresh);
    } catch {
      return null;
    }
  }, []);

  const listTimedEventsNow = useCallback(async (calendarId: string, from: Date, to: Date) => {
    const fresh = storedToken();
    if (!fresh) return null;
    try {
      return await listTimedEvents(fresh, calendarId, from, to);
    } catch {
      return null;
    }
  }, []);

  return {
    meals: cache.meals,
    account: cache.account,
    synced: cache.syncToken !== undefined,
    mealsCalendarId: cache.calendar?.id,
    listCalendars: listCalendarsNow,
    listTimedEvents: listTimedEventsNow,
    setSlot,
    addMeal,
    clearSlot,
    removeMeal,
    renameMeals,
    setNote,
    moveMeal,
    toggleLike,
    memos: cache.memos ?? [],
    addMemo,
    removeMemo,
    me: cache.account,
    settings,
    saveSettings,
    images,
    saveImages,
    connected: token !== null,
    canRenew,
    syncing,
    error,
    connect,
    disconnect,
    dismissError: () => {
      authError.current = false;
      setError('');
    },
  };
}

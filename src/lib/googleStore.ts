import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AuthError,
  SyncExpiredError,
  deleteEvent,
  eventToMeal,
  findCalendar,
  forgetToken,
  getAccount,
  insertEvent,
  listChanges,
  loadGoogleSignIn,
  renameEvent,
  signIn,
  storedToken,
  tokenRemainingMs,
  type GoogleCalendar,
  type GoogleEvent,
} from './google';
import type { Meal, MealStore, Slot } from './types';

const CACHE_KEY = 'mymeals.google.v1';

interface Cache {
  calendar?: GoogleCalendar;
  /** Adresse du compte Google, pour renouveler la connexion sans demander de choisir un compte. */
  account?: string;
  syncToken?: string;
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

export interface GoogleMealStore extends MealStore {
  connected: boolean;
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
  const cacheRef = useRef(cache);
  const busy = useRef(false);
  const renewing = useRef<Promise<string | null> | null>(null);
  const lastRenewFailure = useRef(0);

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
    if (e instanceof AuthError) setToken(null);
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
        let full = !cacheRef.current.syncToken;
        try {
          changes = await listChanges(accessToken, calendar.id, cacheRef.current.syncToken);
        } catch (e) {
          if (!(e instanceof SyncExpiredError)) throw e;
          full = true;
          changes = await listChanges(accessToken, calendar.id);
        }
        const { events, syncToken } = changes;
        commit((c) => ({ ...c, syncToken, meals: applyEvents(full ? [] : c.meals, events) }));
      } catch (e) {
        fail(e);
      } finally {
        busy.current = false;
        setSyncing(false);
      }
    },
    [calendarName, commit, fail],
  );

  // Charge la connexion Google à l'avance, et resynchronise au retour sur l'application.
  useEffect(() => {
    loadGoogleSignIn().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!token) return;
    void sync(token);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync(token);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
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
            setToken(fresh);
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
  }, [clientId]);

  const canRenew = cache.calendar !== undefined;

  // Le jeton Google ne dure qu'une heure. Au premier toucher après son expiration (ou dans ses
  // cinq dernières minutes), on le renouvelle : pas besoin de se reconnecter à la main.
  useEffect(() => {
    if (!canRenew) return;
    const onGesture = () => {
      if (renewing.current || Date.now() - lastRenewFailure.current < 60_000) return;
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

  const setSlot = useCallback(
    (date: string, slot: Slot, rawName: string) => {
      const name = rawName.trim();
      if (!name) return;
      withAccess((a) => {
        const existing = cacheRef.current.meals.find((m) => m.date === date && m.slot === slot);
        if (existing) {
          // Le créneau a déjà un événement : on change seulement son titre.
          commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === existing.id ? { ...m, name } : m)) }));
          renameEvent(a.token, a.calendar, existing.id, name).catch((e) => {
            commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === existing.id ? existing : m)) }));
            fail(e);
          });
        } else {
          const tempId = `tmp-${date}-${slot}-${Date.now()}`;
          commit((c) => ({ ...c, meals: [...c.meals, { id: tempId, date, slot, name, source: 'google' }] }));
          insertEvent(a.token, a.calendar, date, slot, name).then(
            (event) => commit((c) => ({ ...c, meals: c.meals.map((m) => (m.id === tempId ? { ...m, id: event.id } : m)) })),
            (e) => {
              commit((c) => ({ ...c, meals: c.meals.filter((m) => m.id !== tempId) }));
              fail(e);
            },
          );
        }
      });
    },
    [commit, fail, withAccess],
  );

  const clearSlot = useCallback(
    (date: string, slot: Slot) => {
      withAccess((a) => {
        const removed = cacheRef.current.meals.filter((m) => m.date === date && m.slot === slot);
        commit((c) => ({ ...c, meals: c.meals.filter((m) => !removed.includes(m)) }));
        for (const meal of removed) {
          deleteEvent(a.token, a.calendar, meal.id).catch((e) => {
            commit((c) => ({ ...c, meals: [...c.meals, meal] }));
            fail(e);
          });
        }
      });
    },
    [commit, fail, withAccess],
  );

  /** Renomme des événements de l'agenda, quelques-uns à la fois ; ceux qui échouent reprennent leur nom. */
  const renameMeals = useCallback(
    async (ids: string[], rawName: string) => {
      const name = rawName.trim();
      const granted = await access();
      if (!granted || !name) return { renamed: 0, failed: granted ? 0 : ids.length };
      const wanted = new Set(ids);
      // Les repas pas encore créés dans l'agenda (identifiant provisoire) sont laissés de côté.
      const targets = cacheRef.current.meals.filter((m) => wanted.has(m.id) && !m.id.startsWith('tmp-') && m.name !== name);
      commit((c) => ({ ...c, meals: c.meals.map((m) => (targets.some((t) => t.id === m.id) ? { ...m, name } : m)) }));
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
            await renameEvent(granted.token, granted.calendar, meal.id, name);
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

  return {
    meals: cache.meals,
    setSlot,
    clearSlot,
    renameMeals,
    connected: token !== null,
    canRenew,
    syncing,
    error,
    connect,
    disconnect,
    dismissError: () => setError(''),
  };
}

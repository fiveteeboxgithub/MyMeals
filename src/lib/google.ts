import { addDays } from './dates';
import { LUNCH_LIMIT_HOUR, type Meal, type Slot } from './types';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_KEY = 'mymeals.google.token';

/** Heures de début des repas créés depuis l'application. */
const SLOT_START: Record<Slot, number> = { midi: 13, soir: 20 };

/** La connexion Google a expiré ou a été refusée : il faut se reconnecter. */
export class AuthError extends Error {}
/** Le jeton de synchronisation n'est plus valable : il faut tout relire. */
export class SyncExpiredError extends Error {}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type: string }) => void;
          }) => TokenClient;
          hasGrantedAllScopes: (response: TokenResponse, ...scopes: string[]) => boolean;
        };
      };
    };
  }
}

export interface GoogleCalendar {
  id: string;
  timeZone: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
}

let gisLoading: Promise<void> | null = null;

/** Charge la bibliothèque de connexion Google. À appeler tôt, avant le clic. */
export function loadGoogleSignIn(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoading = null;
      reject(new Error('Impossible de charger la connexion Google.'));
    };
    document.head.append(script);
  });
  return gisLoading;
}

export function storedToken(): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, expires } = JSON.parse(raw) as { token: string; expires: number };
    return Date.now() < expires ? token : null;
  } catch {
    return null;
  }
}

/** Durée de validité restante du jeton enregistré, en millisecondes (0 s'il n'y en a pas ou s'il a expiré). */
export function tokenRemainingMs(): number {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return 0;
    const { expires } = JSON.parse(raw) as { expires: number };
    return Math.max(0, expires - Date.now());
  } catch {
    return 0;
  }
}

export function forgetToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // rien à faire
  }
}

/**
 * Ouvre la fenêtre de connexion Google et renvoie un jeton d'accès (valable environ 1 h).
 * Avec `hint` (l'adresse du compte déjà utilisé), Google peut renouveler le jeton sans rien
 * demander : la fenêtre s'ouvre et se referme seule. Il faut appeler cette fonction pendant
 * un geste de l'utilisateur (clic, toucher), sinon le navigateur bloque la fenêtre.
 */
export async function signIn(clientId: string, options: { hint?: string } = {}): Promise<string> {
  await loadGoogleSignIn();
  const oauth2 = window.google!.accounts.oauth2;
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(' '),
      hint: options.hint,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new AuthError('Connexion Google refusée.'));
        } else if (!oauth2.hasGrantedAllScopes(response, ...SCOPES)) {
          reject(new AuthError("Il faut cocher toutes les autorisations demandées pour lire et modifier l'agenda."));
        } else {
          const expires = Date.now() + ((response.expires_in ?? 3600) - 60) * 1000;
          try {
            localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: response.access_token, expires }));
          } catch {
            // le jeton restera en mémoire pour cette session
          }
          resolve(response.access_token);
        }
      },
      error_callback: () => reject(new AuthError('Connexion Google annulée.')),
    });
    client.requestAccessToken(options.hint ? { prompt: '', hint: options.hint } : undefined);
  });
}

/** Motifs de refus 403 qui veulent dire « trop de requêtes », pas « pas connecté ». */
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);
/** Motifs de refus 403 qui veulent dire que les autorisations accordées ne suffisent pas. */
const PERMISSION_REASONS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);
const MAX_RETRIES = 4;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function errorReason(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error?: { errors?: { reason?: string }[]; status?: string; details?: { reason?: string }[] } };
    return body.error?.errors?.[0]?.reason ?? body.error?.details?.[0]?.reason ?? body.error?.status ?? '';
  } catch {
    return '';
  }
}

async function call<T>(token: string, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  // Seul 401 veut dire « jeton expiré » : un 403 est souvent une simple limite de débit.
  if (response.status === 401) {
    forgetToken();
    throw new AuthError('La connexion Google a expiré.');
  }
  if (response.status === 410) throw new SyncExpiredError();
  if (!response.ok) {
    const reason = await errorReason(response);
    const limited = response.status === 429 || (response.status === 403 && RATE_LIMIT_REASONS.has(reason));
    const serverError = response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504;
    if ((limited || serverError) && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      await sleep((retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt) + Math.random() * 400);
      return call<T>(token, path, init, attempt + 1);
    }
    if (response.status === 403 && PERMISSION_REASONS.has(reason)) {
      forgetToken();
      throw new AuthError("Autorisations insuffisantes : reconnecte-toi en cochant toutes les cases demandées.");
    }
    if (limited) throw new Error('Google limite temporairement les requêtes : réessaie dans une minute.');
    if (response.status === 403) throw new Error(`Google Agenda a refusé la demande${reason ? ` (${reason})` : ''}.`);
    throw new Error(`Google Agenda a répondu ${response.status}.`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Adresse du compte connecté (l'identifiant de son agenda principal), pour renouveler la connexion sans la redemander. */
export async function getAccount(token: string): Promise<string | undefined> {
  const calendar = await call<{ id?: string }>(token, '/calendars/primary?fields=id');
  return calendar.id;
}

export async function findCalendar(token: string, name: string): Promise<GoogleCalendar | null> {
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ maxResults: '250', fields: 'items(id,summary,timeZone),nextPageToken' });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await call<{ items?: { id: string; summary?: string; timeZone?: string }[]; nextPageToken?: string }>(
      token,
      `/users/me/calendarList?${query}`,
    );
    const found = page.items?.find((c) => c.summary?.trim().toLowerCase() === name.trim().toLowerCase());
    if (found) return { id: found.id, timeZone: found.timeZone ?? 'Europe/Paris' };
    pageToken = page.nextPageToken;
  } while (pageToken);
  return null;
}

/**
 * Lit les événements de l'agenda : tous sans jeton de synchronisation, sinon seulement
 * ceux qui ont changé depuis (les suppressions arrivent avec le statut « cancelled »).
 */
export async function listChanges(
  token: string,
  calendarId: string,
  syncToken?: string,
): Promise<{ events: GoogleEvent[]; syncToken?: string }> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const query = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '2500',
      fields: 'items(id,status,summary,start),nextPageToken,nextSyncToken',
    });
    if (syncToken) query.set('syncToken', syncToken);
    if (pageToken) query.set('pageToken', pageToken);
    const page = await call<{ items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }>(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
    );
    events.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
    nextSyncToken = page.nextSyncToken ?? nextSyncToken;
  } while (pageToken);
  return { events, syncToken: nextSyncToken };
}

export function insertEvent(
  token: string,
  calendar: GoogleCalendar,
  date: string,
  slot: Slot,
  name: string,
): Promise<GoogleEvent> {
  const hour = SLOT_START[slot];
  const at = (h: number) => (h < 24 ? `${date}T${String(h).padStart(2, '0')}:00:00` : `${addDays(date, 1)}T00:00:00`);
  return call<GoogleEvent>(token, `/calendars/${encodeURIComponent(calendar.id)}/events?fields=id,status,summary,start`, {
    method: 'POST',
    body: JSON.stringify({
      summary: name,
      start: { dateTime: at(hour), timeZone: calendar.timeZone },
      end: { dateTime: at(hour + 1), timeZone: calendar.timeZone },
    }),
  });
}

export function renameEvent(token: string, calendar: GoogleCalendar, eventId: string, name: string): Promise<GoogleEvent> {
  return call<GoogleEvent>(
    token,
    `/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(eventId)}?fields=id,status,summary,start`,
    { method: 'PATCH', body: JSON.stringify({ summary: name }) },
  );
}

export function deleteEvent(token: string, calendar: GoogleCalendar, eventId: string): Promise<void> {
  return call<void>(token, `/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}

/** Un événement devient un repas ; renvoie null s'il est annulé, sans titre ou sans date. */
export function eventToMeal(event: GoogleEvent): Meal | null {
  const name = event.summary?.trim();
  if (event.status === 'cancelled' || !name || !event.start) return null;
  // Google renvoie l'heure dans le fuseau de l'agenda : on lit la date et l'heure telles quelles.
  const { dateTime, date } = event.start;
  if (dateTime) {
    const hour = Number(dateTime.slice(11, 13));
    return { id: event.id, date: dateTime.slice(0, 10), slot: hour < LUNCH_LIMIT_HOUR ? 'midi' : 'soir', name, source: 'google' };
  }
  if (date) return { id: event.id, date, slot: 'soir', name, source: 'google' };
  return null;
}

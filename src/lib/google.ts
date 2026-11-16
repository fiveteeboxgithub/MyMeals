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
  requestAccessToken: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
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

export function forgetToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // rien à faire
  }
}

/** Ouvre la fenêtre de connexion Google et renvoie un jeton d'accès (valable environ 1 h). */
export async function signIn(clientId: string): Promise<string> {
  await loadGoogleSignIn();
  const oauth2 = window.google!.accounts.oauth2;
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(' '),
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
    client.requestAccessToken();
  });
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (response.status === 401 || response.status === 403) {
    forgetToken();
    throw new AuthError('La connexion Google a expiré.');
  }
  if (response.status === 410) throw new SyncExpiredError();
  if (!response.ok) throw new Error(`Google Agenda a répondu ${response.status}.`);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
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

import { noteFromDescription } from './notes';
import { addDays } from './dates';
import { LUNCH_LIMIT_HOUR, type Meal, type Slot } from './types';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_KEY = 'mymeals.google.token';

/** Heures de début des repas créés depuis l'application. */
let mealTimes: Record<Slot, string> = { midi: '13:00', soir: '20:00' };

/** Heures (HH:MM) des repas créés depuis l'application, réglables. */
export function setMealTimes(times: Record<Slot, string>): void {
  mealTimes = times;
}

/** Ajoute des minutes à une date et une heure locales (AAAA-MM-JJ, HH:MM), en passant au lendemain si besoin. */
export function shiftTime(date: string, time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const day = addDays(date, Math.floor(total / 1440));
  const inDay = ((total % 1440) + 1440) % 1440;
  return `${day}T${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}:00`;
}

/** La connexion Google a expiré ou a été refusée : il faut se reconnecter. */
export class AuthError extends Error {}
/** L'élément demandé n'existe pas (ou plus). */
export class NotFoundError extends Error {}
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
  description?: string;
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

interface StoredToken {
  token: string;
  expires: number;
}

/** Copie en mémoire : le jeton reste utilisable même si le navigateur refuse d'écrire dans localStorage. */
let memoryToken: StoredToken | null = null;

function readStoredToken(): StoredToken | null {
  if (memoryToken && Date.now() < memoryToken.expires) return memoryToken;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (typeof parsed.token !== 'string' || typeof parsed.expires !== 'number' || Date.now() >= parsed.expires) return null;
    memoryToken = parsed;
    return parsed;
  } catch {
    return null;
  }
}

/** Jeton d'accès encore valable, ou null. */
export function storedToken(): string | null {
  return readStoredToken()?.token ?? null;
}

/** Durée de validité restante du jeton, en millisecondes (0 s'il n'y en a pas ou s'il a expiré). */
export function tokenRemainingMs(): number {
  const stored = readStoredToken();
  return stored ? Math.max(0, stored.expires - Date.now()) : 0;
}

/** Oublie le jeton (déconnexion voulue, ou refus de Google). */
export function forgetToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // rien à faire
  }
}

export function rememberToken(token: string, expiresInSeconds: number): void {
  // Une minute de marge : on ne s'appuie pas sur un jeton qui expire dans la seconde.
  memoryToken = { token, expires: Date.now() + (expiresInSeconds - 60) * 1000 };
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(memoryToken));
  } catch {
    // le jeton reste en mémoire pour cette session
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
          rememberToken(response.access_token, response.expires_in ?? 3600);
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
  // Ce n'est pas à cette fonction de jeter le jeton : l'appelant décide si l'échec est grave
  // (un appel facultatif qui échoue ne doit pas déconnecter).
  if (response.status === 401) throw new AuthError('La connexion Google a expiré.');
  if (response.status === 404) throw new NotFoundError('Élément introuvable dans Google Agenda.');
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
      throw new AuthError("Autorisations insuffisantes : reconnecte-toi en cochant toutes les cases demandées.");
    }
    if (limited) throw new Error('Google limite temporairement les requêtes : réessaie dans une minute.');
    if (response.status === 403) throw new Error(`Google Agenda a refusé la demande${reason ? ` (${reason})` : ''}.`);
    throw new Error(`Google Agenda a répondu ${response.status}.`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/**
 * Adresse du compte connecté : l'identifiant de son agenda principal, lu dans la liste des agendas
 * (déjà autorisée ; l'appel direct à « calendars/primary » demande une autorisation de plus).
 */
export async function getAccount(token: string): Promise<string | undefined> {
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ maxResults: '250', fields: 'items(id,primary),nextPageToken' });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await call<{ items?: { id: string; primary?: boolean }[]; nextPageToken?: string }>(
      token,
      `/users/me/calendarList?${query}`,
    );
    const primary = page.items?.find((c) => c.primary);
    if (primary) return primary.id;
    pageToken = page.nextPageToken;
  } while (pageToken);
  return undefined;
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
      fields: 'items(id,status,summary,description,start),nextPageToken,nextSyncToken',
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
  const time = mealTimes[slot];
  return call<GoogleEvent>(token, `/calendars/${encodeURIComponent(calendar.id)}/events?fields=id,status,summary,start`, {
    method: 'POST',
    body: JSON.stringify({
      summary: name,
      start: { dateTime: shiftTime(date, time, 0), timeZone: calendar.timeZone },
      end: { dateTime: shiftTime(date, time, 60), timeZone: calendar.timeZone },
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

/** Écrit la note d'un repas dans la description de l'événement (texte vide : la retire). */
export function setEventNote(token: string, calendar: GoogleCalendar, eventId: string, note: string): Promise<GoogleEvent> {
  return call<GoogleEvent>(
    token,
    `/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(eventId)}?fields=id,status,summary,start`,
    { method: 'PATCH', body: JSON.stringify({ description: note }) },
  );
}

export function deleteEvent(token: string, calendar: GoogleCalendar, eventId: string): Promise<void> {
  return call<void>(token, `/calendars/${encodeURIComponent(calendar.id)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
  });
}

/** Un événement devient un repas ; renvoie null s'il est annulé, sans titre ou sans date. */
export function eventToMeal(event: GoogleEvent): Meal | null {
  if (event.id === SETTINGS_EVENT_ID) return null;
  const name = event.summary?.trim();
  if (event.status === 'cancelled' || !name || !event.start) return null;
  // Google renvoie l'heure dans le fuseau de l'agenda : on lit la date et l'heure telles quelles.
  const { dateTime, date } = event.start;
  const note = noteFromDescription(event.description);
  const extra = note ? { note } : {};
  if (dateTime) {
    const hour = Number(dateTime.slice(11, 13));
    return { id: event.id, date: dateTime.slice(0, 10), slot: hour < LUNCH_LIMIT_HOUR ? 'midi' : 'soir', name, source: 'google', ...extra };
  }
  if (date) return { id: event.id, date, slot: 'soir', name, source: 'google', ...extra };
  return null;
}

/**
 * Événement spécial qui garde les réglages partagés dans l'agenda : un événement « journée entière »
 * en 2100, masqué des repas. Son identifiant est fixe (lettres a-v et chiffres, comme l'exige Google).
 */
export const SETTINGS_EVENT_ID = 'mmealsreglages00';
const SETTINGS_TITLE = '⚙ MyMeals : réglages (ne pas supprimer)';
const SETTINGS_MARKER = 'MYMEALS-REGLAGES';

/** Texte de l'événement : une phrase d'explication puis les réglages en JSON sur une seule ligne. */
export function encodeSettings(payload: unknown): string {
  return `Réglages de l'application MyMeals, enregistrés ici pour être retrouvés sur tous vos appareils. Ne pas supprimer ni modifier à la main.\n${SETTINGS_MARKER} ${JSON.stringify(payload)}`;
}

/** Relit les réglages dans le texte d'un événement (qu'il ait été reformaté en HTML ou non). */
export function decodeSettings(description: string | undefined): unknown {
  if (!description) return null;
  const at = description.indexOf(SETTINGS_MARKER);
  if (at < 0) return null;
  const text = description.slice(at + SETTINGS_MARKER.length).replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Lit l'événement des réglages : null s'il n'existe pas (ou a été supprimé). */
export async function readSettingsEvent(token: string, calendar: GoogleCalendar): Promise<{ payload: unknown } | null> {
  try {
    const event = await call<{ status?: string; description?: string }>(
      token,
      `/calendars/${encodeURIComponent(calendar.id)}/events/${SETTINGS_EVENT_ID}?fields=status,description`,
    );
    if (event.status === 'cancelled') return null;
    return { payload: decodeSettings(event.description) };
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

/** Écrit l'événement des réglages : le met à jour, le recrée s'il a été supprimé, ou le crée la première fois. */
/** Taille prudente du texte d'un événement (Google n'en garde qu'environ 8 000 caractères). */
export const MAX_EVENT_TEXT = 7800;

export async function writeSettingsEvent(token: string, calendar: GoogleCalendar, payload: unknown): Promise<void> {
  if (encodeSettings(payload).length > MAX_EVENT_TEXT) {
    throw new Error("Réglages trop longs pour l'agenda : raccourcis la liste noire, les favoris ou « Mes idées ». Ils restent enregistrés sur cet appareil.");
  }
  const base = `/calendars/${encodeURIComponent(calendar.id)}/events`;
  const body = {
    summary: SETTINGS_TITLE,
    description: encodeSettings(payload),
    start: { date: '2100-01-01' },
    end: { date: '2100-01-02' },
    transparency: 'transparent',
    visibility: 'private',
    reminders: { useDefault: false },
    extendedProperties: { private: { mymeals: 'settings' } },
    status: 'confirmed',
  };
  try {
    await call<unknown>(token, `${base}/${SETTINGS_EVENT_ID}?fields=id`, { method: 'PATCH', body: JSON.stringify(body) });
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
    await call<unknown>(token, `${base}?fields=id`, { method: 'POST', body: JSON.stringify({ id: SETTINGS_EVENT_ID, ...body }) });
  }
}

/** Un agenda de la liste de l'utilisateur. */
export interface CalendarInfo {
  id: string;
  name: string;
  primary: boolean;
  /** Coché dans Google Agenda (affiché par défaut). */
  selected: boolean;
  color?: string;
}

export async function listCalendars(token: string): Promise<CalendarInfo[]> {
  const out: CalendarInfo[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      maxResults: '250',
      fields: 'items(id,summary,summaryOverride,primary,selected,backgroundColor),nextPageToken',
    });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await call<{
      items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; selected?: boolean; backgroundColor?: string }[];
      nextPageToken?: string;
    }>(token, `/users/me/calendarList?${query}`);
    for (const item of page.items ?? []) {
      out.push({
        id: item.id,
        name: item.summaryOverride || item.summary || item.id,
        primary: item.primary === true,
        selected: item.selected === true,
        color: item.backgroundColor,
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** Événement d'un autre agenda, réduit à ce qu'on affiche. */
export interface TimedEvent {
  id: string;
  title: string;
  /** Début et fin (horodatages en millisecondes). */
  start: number;
  end: number;
}

/** Événements à heure fixe d'un agenda entre deux instants (les événements « journée entière » sont ignorés). */
export async function listTimedEvents(token: string, calendarId: string, from: Date, to: Date): Promise<TimedEvent[]> {
  const out: TimedEvent[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      maxResults: '250',
      fields: 'items(id,status,summary,start,end),nextPageToken',
    });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await call<{
      items?: { id: string; status?: string; summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }[];
      nextPageToken?: string;
    }>(token, `/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
    for (const item of page.items ?? []) {
      if (item.status === 'cancelled' || !item.start?.dateTime || !item.end?.dateTime) continue;
      out.push({
        id: item.id,
        title: item.summary?.trim() || '(sans titre)',
        start: Date.parse(item.start.dateTime),
        end: Date.parse(item.end.dateTime),
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

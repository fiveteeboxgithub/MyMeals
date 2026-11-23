import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DuplicatesPage } from './Duplicates';
import { addToBlacklist, blacklistedKeys, parseBlacklist, removeFromList, type BlacklistFilter } from './lib/blacklist';
import { dishKeyOf, notesByDish } from './lib/notes';
import { addDays, todayIso } from './lib/dates';
import { setMealTimes, type CalendarInfo, type TimedEvent } from './lib/google';
import { shownByDefault } from './lib/otherCalendars';
import { KEYS, readPref, writePref } from './lib/prefs';
import { MAX_BLACKLIST_CHARS, MAX_FAVORITES_CHARS, parseSkipped, withSkip, type SharedSettings } from './lib/settings';
import { buildIndex, normalize } from './lib/suggest';
import { parseIdeas } from './lib/surprise';
import type { BlacklistOutcome, ImagesSync, MealStore, SettingsSync } from './lib/types';
import { CustomImagesContext, useCustomImages } from './lib/customImages';
import { useAppSettings } from './lib/useAppSettings';
import { FridgeMemo } from './FridgeMemo';
import { Icon } from './Icons';
import { Notice } from './Notice';
import { PlanningView, type SlotMode, type WeekLayout } from './PlanningView';
import { SettingsPage } from './SettingsPage';
import { StatsPage } from './StatsPage';

type View = 'planning' | 'doublons' | 'stats' | 'reglages';
const VIEWS: { id: View; label: string }[] = [
  { id: 'planning', label: 'Planning' },
  { id: 'doublons', label: 'Doublons' },
  { id: 'stats', label: 'Stats' },
  { id: 'reglages', label: 'Réglages' },
];

/** La page affichée est mémorisée dans l'adresse (#doublons, #reglages), pour que « retour » fonctionne. */
function useView(): [View, (view: View) => void] {
  const read = (): View => VIEWS.find((v) => `#${v.id}` === window.location.hash)?.id ?? 'planning';
  const [view, setView] = useState<View>(read);
  useEffect(() => {
    const onChange = () => setView(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return [view, (next) => (window.location.hash = next === 'planning' ? '' : next)];
}

function loadSlotMode(): SlotMode {
  const stored = readPref(KEYS.slotMode);
  return stored === 'midi' || stored === 'soir' || stored === 'both' ? stored : 'soir';
}

function loadShownCalendars(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(readPref(KEYS.calendars) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Accès aux agendas Google, fourni seulement quand la connexion est établie. */
export interface CalendarsAccess {
  list: () => Promise<CalendarInfo[] | null>;
  events: (calendarId: string, from: Date, to: Date) => Promise<TimedEvent[] | null>;
  mealsCalendarId?: string;
}

interface PlannerProps {
  store: MealStore;
  settingsSync?: SettingsSync;
  /** Images choisies pour des plats, partagées via l'agenda (mode Google). */
  imagesSync?: ImagesSync;
  calendars?: CalendarsAccess;
  /** Premier chargement de l'agenda, encore vide. */
  loading?: boolean;
  /** Bouton à droite du titre, seulement quand il faut agir (se connecter, importer). */
  headerAction?: ReactNode;
  banner: ReactNode;
  /** Bloc « Compte » de la page des réglages. */
  account: ReactNode;
  footer: ReactNode;
}

export function Planner(props: PlannerProps) {
  const { store } = props;
  const [view, setView] = useView();
  const today = todayIso();
  const [memoOpen, setMemoOpen] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const bump = useCallback(() => setResetToken((t) => t + 1), []);
  const { shared, update } = useAppSettings(props.settingsSync, bump);
  const customImages = useCustomImages(props.imagesSync);
  const change = useCallback(
    (patch: Partial<SharedSettings>) => {
      update(patch);
      bump();
    },
    [update, bump],
  );
  const [slotMode, setSlotMode] = useState<SlotMode>(loadSlotMode);
  const [pendingOnly, setPendingOnly] = useState(() => readPref(KEYS.pendingOnly) === '1');
  // Images des plats (Wikipédia) : affichées sauf si on les a désactivées sur cet appareil.
  // Sur ordinateur : la semaine en sept colonnes, ou en liste verticale comme sur téléphone.
  const [weekLayout, setWeekLayoutState] = useState<WeekLayout>(() => (readPref(KEYS.weekLayout) === 'list' ? 'list' : 'columns'));
  const setWeekLayout = useCallback((layout: WeekLayout) => {
    setWeekLayoutState(layout);
    writePref(KEYS.weekLayout, layout);
  }, []);
  const [showImages, setShowImages] = useState(() => readPref(KEYS.images) !== '0');
  const [flash, setFlash] = useState<{ text: string; undo?: () => void } | null>(null);
  const showFlash = useCallback((text: string, undo?: () => void) => setFlash({ text, undo }), []);
  // Le message s'efface tout seul après quelques secondes (un peu plus quand il propose « Annuler »).
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), flash.undo ? 12_000 : 6_000);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => setMealTimes({ midi: shared.lunchTime, soir: shared.dinnerTime }), [shared.lunchTime, shared.dinnerTime]);

  const dishes = useMemo(() => buildIndex(store.meals), [store.meals]);
  // Écritures exactes différentes (ce que les fusions de doublons font baisser), puis plats après regroupement automatique.
  const labelCount = useMemo(() => new Set(store.meals.map((m) => m.name.replace(/\s+/g, ' ').trim())).size, [store.meals]);
  const blacklist = useMemo(() => parseBlacklist(shared.blacklistText), [shared.blacklistText]);
  const blacklistKeys = useMemo(() => blacklistedKeys(dishes, blacklist), [dishes, blacklist]);
  const blacklistFilter = useMemo<BlacklistFilter>(
    () => ({ matches: blacklist.matches, keys: blacklistKeys, include: shared.includeBlacklist }),
    [blacklist, blacklistKeys, shared.includeBlacklist],
  );
  const ideas = useMemo(() => parseIdeas(shared.ideasText), [shared.ideasText]);
  const eatenIdeas = useMemo(() => ideas.filter((idea) => dishes.byKey.has(normalize(idea))), [ideas, dishes]);

  /** Ajoute un plat à la liste noire depuis une proposition, avec de quoi annuler. */
  const blacklistDish = useCallback(
    (name: string) => {
      const previous = shared.blacklistText;
      const next = addToBlacklist(previous, name);
      if (next === previous) return;
      change({ blacklistText: next });
      const hidden = [...blacklistedKeys(dishes, parseBlacklist(next))]
        .filter((key) => !blacklistKeys.has(key))
        .map((key) => dishes.byKey.get(key)?.label ?? key);
      const more = hidden.length > 1 ? ` (${hidden.length} plats masqués : ${hidden.slice(0, 4).join(', ')}${hidden.length > 4 ? '…' : ''})` : '';
      showFlash(`« ${name} » est sur la liste noire${more}.`, () => change({ blacklistText: previous }));
    },
    [shared.blacklistText, change, dishes, blacklistKeys, showFlash],
  );

  /** Ajoute un nom à la liste noire sans message (fusion de doublons) : dit ce qui s'est passé. */
  const blacklistTextRef = useRef(shared.blacklistText);
  blacklistTextRef.current = shared.blacklistText;
  const blacklistName = useCallback(
    (name: string): BlacklistOutcome => {
      const previous = blacklistTextRef.current;
      const next = addToBlacklist(previous, name);
      if (next === previous) return 'already';
      if (next.length > MAX_BLACKLIST_CHARS) return 'full';
      blacklistTextRef.current = next;
      change({ blacklistText: next });
      return 'added';
    },
    [change],
  );

  /** Plat sur la liste noire (par une de ses écritures ou une règle). */
  const isBlacklisted = useCallback(
    (name: string) => blacklist.matches(name) || blacklistKeys.has(dishKeyOf(name, dishes)),
    [blacklist, blacklistKeys, dishes],
  );
  /** Ajoute un plat à la liste noire, ou l'en retire, depuis la fiche d'un plat. */
  const toggleBlacklist = useCallback(
    (name: string) => {
      if (!isBlacklisted(name)) {
        blacklistDish(name);
        return;
      }
      const previous = shared.blacklistText;
      const next = removeFromList(previous, name);
      const stillListed = parseBlacklist(next);
      if (stillListed.matches(name) || blacklistedKeys(dishes, stillListed).has(dishKeyOf(name, dishes))) {
        showFlash(`« ${name} » est sur la liste noire par une règle plus large : modifie-la dans Réglages → Liste noire.`);
        return;
      }
      change({ blacklistText: next });
      showFlash(`« ${name} » n'est plus sur la liste noire.`, () => change({ blacklistText: previous }));
    },
    [isBlacklisted, blacklistDish, shared.blacklistText, dishes, change, showFlash],
  );

  // Favoris : même syntaxe que la liste noire ; ils reviennent plus souvent dans les propositions.
  const favorites = useMemo(() => parseBlacklist(shared.favoritesText), [shared.favoritesText]);
  const favoriteKeys = useMemo(() => blacklistedKeys(dishes, favorites), [dishes, favorites]);
  const isFavorite = useCallback(
    (name: string) => favorites.matches(name) || favoriteKeys.has(dishKeyOf(name, dishes)),
    [favorites, favoriteKeys, dishes],
  );
  /** Ajoute ou retire un plat des favoris, avec de quoi annuler. */
  const toggleFavorite = useCallback(
    (name: string) => {
      const previous = shared.favoritesText;
      const undo = () => change({ favoritesText: previous });
      if (!isFavorite(name)) {
        const next = addToBlacklist(previous, name);
        if (next.length > MAX_FAVORITES_CHARS) {
          showFlash('La liste des favoris est pleine : fais de la place dans Réglages → Favoris.');
          return;
        }
        change({ favoritesText: next });
        showFlash(`⭐ « ${name} » est dans tes favoris : il sera proposé plus souvent.`, undo);
        return;
      }
      const next = removeFromList(previous, name);
      if (parseBlacklist(next).matches(name) || blacklistedKeys(dishes, parseBlacklist(next)).has(dishKeyOf(name, dishes))) {
        showFlash(`« ${name} » est favori par une règle plus large : modifie-la dans Réglages → Favoris.`);
        return;
      }
      change({ favoritesText: next });
      showFlash(`« ${name} » n'est plus dans tes favoris.`, undo);
    },
    [shared.favoritesText, change, isFavorite, dishes, showFlash],
  );
  const notes = useMemo(() => notesByDish(store.meals, dishes), [store.meals, dishes]);

  // Créneaux « Pas de repas » : partagés avec les réglages (sans effacer les tirages en cours).
  const skipped = useMemo<ReadonlySet<string>>(() => new Set(parseSkipped(shared.skippedSlots)), [shared.skippedSlots]);
  const skippedRef = useRef(shared.skippedSlots);
  skippedRef.current = shared.skippedSlots;
  const setSkip = useCallback(
    (key: string, skip: boolean) => {
      const next = withSkip(skippedRef.current, key, skip, today, addDays(today, -7));
      if (next === skippedRef.current) return;
      skippedRef.current = next;
      update({ skippedSlots: next });
    },
    [update, today],
  );

  // Autres agendas : la liste (pour les réglages) et ceux affichés à côté des créneaux.
  const listCalendars = props.calendars?.list;
  const eventsOf = props.calendars?.events;
  const mealsCalendarId = props.calendars?.mealsCalendarId;
  const [calendarList, setCalendarList] = useState<CalendarInfo[] | null>(null);
  const [shownPrefs, setShownPrefs] = useState(loadShownCalendars);
  const loadCalendars = useCallback(() => {
    if (!listCalendars) return;
    setCalendarList(null);
    void listCalendars().then((list) => {
      if (list) setCalendarList(list.filter((c) => c.id !== mealsCalendarId));
    });
  }, [listCalendars, mealsCalendarId]);
  useEffect(() => {
    if (listCalendars) loadCalendars();
    else setCalendarList(null);
  }, [listCalendars, loadCalendars]);
  const isShown = useCallback((c: CalendarInfo) => shownPrefs[c.id] ?? shownByDefault(c, mealsCalendarId), [shownPrefs, mealsCalendarId]);
  const shownCalendars = useMemo(() => (calendarList ?? []).filter(isShown), [calendarList, isShown]);
  const eventsApi = useMemo(() => (eventsOf ? { events: eventsOf } : undefined), [eventsOf]);

  return (
    <CustomImagesContext.Provider value={customImages}>
    <div className={`app${view === 'planning' && weekLayout === 'columns' ? ' wide' : ''}`}>
      <header className="top">
        <h1>MyMeals</h1>
        <div className="top-actions">
          <button className="memo-btn" onClick={() => setMemoOpen(true)} aria-label={`Fridge memo (${store.memos.length})`} title="Fridge memo : le pense-bête partagé">
            <Icon name="note" />
            Fridge memo
            {store.memos.length > 0 && <span className="memo-count">{store.memos.length}</span>}
          </button>
          {props.headerAction}
        </div>
      </header>

      {props.banner}

      <nav className="tabs" aria-label="Pages">
        {VIEWS.map((v) => (
          <button key={v.id} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>

      {flash && (
        <Notice
          floating
          text={flash.text}
          onClose={() => setFlash(null)}
          action={
            flash.undo
              ? {
                  label: 'Annuler',
                  onClick: () => {
                    flash.undo?.();
                    setFlash(null);
                  },
                }
              : undefined
          }
        />
      )}

      {view === 'planning' && (
        <PlanningView
          store={store}
          dishes={dishes}
          today={today}
          shared={shared}
          ideas={ideas}
          slotMode={slotMode}
          pendingOnly={pendingOnly}
          showImages={showImages}
          weekLayout={weekLayout}
          setWeekLayout={setWeekLayout}
          skipped={skipped}
          setSkip={setSkip}
          blacklistKeys={blacklistKeys}
          blacklistFilter={blacklistFilter}
          resetToken={resetToken}
          loading={props.loading ?? false}
          flash={showFlash}
          favoriteKeys={favoriteKeys}
          isFavorite={isFavorite}
          toggleFavorite={toggleFavorite}
          isBlacklisted={isBlacklisted}
          toggleBlacklist={toggleBlacklist}
          notes={notes}
          onSurprisePeriod={(months) => change({ surprisePeriod: months })}
          calendars={eventsApi}
          shownCalendars={shownCalendars}
        />
      )}
      {view === 'doublons' && <DuplicatesPage store={store} dishes={dishes} onBlacklist={blacklistName} />}
      {view === 'stats' && <StatsPage meals={store.meals} dishes={dishes} today={today} blacklistKeys={blacklistKeys} />}
      {view === 'reglages' && (
        <SettingsPage
          shared={shared}
          update={change}
          slotMode={slotMode}
          setSlotMode={(mode) => {
            setSlotMode(mode);
            writePref(KEYS.slotMode, mode);
          }}
          pendingOnly={pendingOnly}
          setPendingOnly={(value) => {
            setPendingOnly(value);
            writePref(KEYS.pendingOnly, value ? '1' : '0');
          }}
          weekLayout={weekLayout}
          setWeekLayout={setWeekLayout}
          showImages={showImages}
          setShowImages={(value) => {
            setShowImages(value);
            writePref(KEYS.images, value ? '1' : '0');
          }}
          blacklist={blacklist}
          blacklistKeys={blacklistKeys}
          favorites={favorites}
          favoriteKeys={favoriteKeys}
          dishes={dishes}
          ideas={ideas}
          eatenIdeas={eatenIdeas}
          calendars={listCalendars ? calendarList : undefined}
          isShown={isShown}
          setShown={(calendar, shown) => {
            const next = { ...shownPrefs, [calendar.id]: shown };
            setShownPrefs(next);
            writePref(KEYS.calendars, JSON.stringify(next));
          }}
          reloadCalendars={listCalendars ? loadCalendars : undefined}
          account={props.account}
        />
      )}

      {store.meals.length > 0 && (
        <footer className="foot">
          {store.meals.length} repas · {labelCount} {labelCount > 1 ? 'libellés' : 'libellé'} · {dishes.dishes.length}{' '}
          {dishes.dishes.length > 1 ? 'plats' : 'plat'} · {props.footer}
        </footer>
      )}
      {memoOpen && (
        <FridgeMemo
          memos={store.memos}
          me={store.me}
          onAdd={store.addMemo}
          onRemove={(memo) => {
            store.removeMemo(memo.id);
            showFlash('Mémo supprimé.', () => store.addMemo(memo.text));
          }}
          onClose={() => setMemoOpen(false)}
        />
      )}
    </div>
    </CustomImagesContext.Provider>
  );
}

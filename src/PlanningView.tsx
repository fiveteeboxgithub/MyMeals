import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlacklistFilter } from './lib/blacklist';
import { addDays, dayName, longDate, mondayOf, shortDate, tinyDate, weekday } from './lib/dates';
import type { CalendarInfo, TimedEvent } from './lib/google';
import type { PastNote } from './lib/notes';
import { overlapsBySlot, weekRange, type OtherEvent } from './lib/otherCalendars';
import type { SharedSettings } from './lib/settings';
import {
  BLACKLIST_CHANCE,
  fold,
  forgottenDishes,
  hashToUnit,
  leftoverHabits,
  leftoverOf,
  normalize,
  pickProposal,
  suggest,
  usualSlots,
  type DishIndex,
  type Suggestion,
} from './lib/suggest';
import { pickSurprise, surpriseIdeas } from './lib/surprise';
import { SLOTS, type Meal, type MealStore, type Slot } from './lib/types';
import { weekText } from './lib/weekText';
import { Breakable } from './Breakable';
import { SlotPicker } from './SlotPicker';
import { DishThumb } from './DishThumb';
import { OtherEvents, SLOT_LABEL, SlotSheet, type ShownProposal } from './SlotSheet';

export type SlotMode = Slot | 'both';
/** Semaine sur ordinateur : sept colonnes, ou liste verticale comme sur téléphone. */
export type WeekLayout = 'columns' | 'list';

/** Ce qui remplace la proposition d'un créneau : une idée « Surprise Me », un plat oublié ou de la liste noire. */
interface Override {
  name: string;
  icon: string;
  note: string;
}

/** Ce qu'on place avec le choix de créneau : une proposition (acceptée ailleurs) ou un repas (déplacé). */
type Picking = { mode: 'accept'; name: string; from: string; override: boolean } | { mode: 'move'; meal: Meal };

interface Editing {
  date: string;
  slot: Slot;
  proposal?: ShownProposal;
}

/** Accès aux autres agendas Google (lecture seule). */
export interface CalendarsApi {
  events: (calendarId: string, from: Date, to: Date) => Promise<TimedEvent[] | null>;
}

interface PlanningProps {
  store: MealStore;
  dishes: DishIndex;
  today: string;
  shared: SharedSettings;
  ideas: string[];
  slotMode: SlotMode;
  pendingOnly: boolean;
  showImages: boolean;
  weekLayout: WeekLayout;
  setWeekLayout: (layout: WeekLayout) => void;
  /** Créneaux marqués « Pas de repas » (partagés avec les réglages). */
  skipped: ReadonlySet<string>;
  setSkip: (key: string, skip: boolean) => void;
  blacklistKeys: ReadonlySet<string>;
  blacklistFilter: BlacklistFilter;
  /** Change quand les réglages changent : les tirages en cours sont alors oubliés. */
  resetToken: number;
  loading: boolean;
  flash: (text: string, undo?: () => void) => void;
  favoriteKeys: ReadonlySet<string>;
  isFavorite: (name: string) => boolean;
  toggleFavorite: (name: string) => void;
  isBlacklisted: (name: string) => boolean;
  toggleBlacklist: (name: string) => void;
  /** Notes des repas, par plat. */
  notes: Map<string, PastNote[]>;
  onSurprisePeriod: (months: number) => void;
  calendars?: CalendarsApi;
  shownCalendars: CalendarInfo[];
}

const CACHE_MS = 10 * 60_000;

/** Événements des agendas choisis pendant la semaine affichée, gardés dix minutes en mémoire. */
function useOtherEvents(api: CalendarsApi | undefined, calendars: CalendarInfo[], monday: string): OtherEvent[] {
  const [events, setEvents] = useState<OtherEvent[]>([]);
  const cache = useRef(new Map<string, { at: number; events: OtherEvent[] }>());
  const ids = calendars.map((c) => c.id).join('|');
  useEffect(() => {
    if (!api || calendars.length === 0) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    const [from, to] = weekRange(monday);
    const load = async () => {
      const results: OtherEvent[] = [];
      const queue = [...calendars];
      const worker = async () => {
        for (let calendar = queue.shift(); calendar; calendar = queue.shift()) {
          const key = `${calendar.id}|${monday}`;
          const cached = cache.current.get(key);
          if (cached && Date.now() - cached.at < CACHE_MS) {
            results.push(...cached.events);
            continue;
          }
          const found = await api.events(calendar.id, from, to);
          if (!found) continue; // pas de connexion valable : on réessaiera plus tard
          const mapped = found.map((e) => ({ ...e, calendarName: calendar.name, color: calendar.color }));
          cache.current.set(key, { at: Date.now(), events: mapped });
          results.push(...mapped);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, calendars.length) }, worker));
      if (!cancelled) setEvents(results);
    };
    void load();
    return () => {
      cancelled = true;
    };
    // `ids` résume la liste des agendas : inutile de relancer pour une simple nouvelle référence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, ids, monday]);
  return events;
}

/** Menu « ⋯ » d'une proposition : les actions moins courantes, avec leur libellé. */
function ProposalMenu({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onToggle(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggle(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onToggle]);
  return (
    <div className="menu-wrap" ref={root}>
      <button className="icon" aria-label={label} title="Plus d'options" aria-haspopup="menu" aria-expanded={open} onClick={() => onToggle(!open)}>
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => onToggle(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, hint, onClick }: { icon: string; label: string; hint?: string; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick}>
      <span aria-hidden="true">{icon}</span>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}

export function PlanningView(props: PlanningProps) {
  const { store, dishes, today, shared, ideas, slotMode, pendingOnly, blacklistKeys, blacklistFilter, resetToken, loading, flash } = props;
  const { favoriteKeys, isFavorite, toggleFavorite } = props;
  const { meals, setSlot, addMeal, clearSlot, removeMeal, setNote, moveMeal } = store;
  const mealsRef = useRef(meals);
  mealsRef.current = meals;
  const { randomness, historyMonths, includeBlacklist } = shared;
  const thisMonday = mondayOf(today);
  const [monday, setMonday] = useState(thisMonday);
  const [editing, setEditing] = useState<Editing | null>(null);
  // Propositions déjà écartées avec ↻, par créneau.
  const [rejected, setRejected] = useState<Record<string, string[]>>({});
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Choix d'un autre créneau : pour accepter une proposition ailleurs, ou déplacer un repas prévu.
  const [picking, setPicking] = useState<Picking | null>(null);
  // Change à chaque ouverture de l'application, pour ne pas revoir le même tirage.
  const [seed] = useState(() => String(Math.random()));
  const shownIdeas = useRef(new Set<string>());
  const shownExtras = useRef(new Set<string>());
  const { skipped, setSkip } = props;
  const activeSlots = useMemo(() => (slotMode === 'both' ? SLOTS : SLOTS.filter((s) => s === slotMode)), [slotMode]);

  useEffect(() => {
    setRejected({});
    setOverrides({});
    shownIdeas.current.clear();
  }, [resetToken]);

  const usual = useMemo(() => usualSlots(meals, today), [meals, today]);
  const habits = useMemo(() => leftoverHabits(meals, dishes), [meals, dishes]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const bySlot = useMemo(() => {
    const map = new Map<string, Meal[]>();
    for (const meal of meals) {
      const key = `${meal.date}|${meal.slot}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(meal);
    }
    return map;
  }, [meals]);

  const otherEvents = useOtherEvents(props.calendars, props.shownCalendars, monday);
  const others = useMemo(
    () => overlapsBySlot(otherEvents, days, { midi: shared.lunchTime, soir: shared.dinnerTime }),
    [otherEvents, days, shared.lunchTime, shared.dinnerTime],
  );

  // Une proposition par créneau vide et habituel de la semaine affichée, sans doublon.
  const proposals = useMemo(() => {
    const out = new Map<string, Suggestion>();
    const used = new Set<string>();
    const weekWords = new Map<string, number>();
    const count = (key: string) => {
      const dish = dishes.byKey.get(key);
      if (!dish || dish.generic) return;
      used.add(dish.key);
      for (const word of dish.words) weekWords.set(word, (weekWords.get(word) ?? 0) + 1);
    };
    for (const date of days) for (const slot of SLOTS) for (const meal of bySlot.get(`${date}|${slot}`) ?? []) count(normalize(meal.name));

    // Restes : après un plat qui en laisse d'habitude, le créneau suivant (dans les trois) propose ses restes.
    let pendingLeftover: { name: string; key: string; count: number; ttl: number } | null = null;
    for (const date of [addDays(monday, -1), ...days]) {
      for (const slot of SLOTS) {
        const key = `${date}|${slot}`;
        const planned = bySlot.get(key);
        if (planned) {
          if (planned.some((m) => leftoverOf(m.name))) pendingLeftover = null;
          const source = planned.find((m) => habits.has(dishes.byKey.get(normalize(m.name))?.key ?? ''));
          if (source) {
            const dishKey = dishes.byKey.get(normalize(source.name))!.key;
            pendingLeftover = { name: source.name, key: normalize(`restes ${source.name}`), count: habits.get(dishKey) ?? 0, ttl: 3 };
          }
          continue;
        }
        if (pendingLeftover && --pendingLeftover.ttl < 0) pendingLeftover = null;
        if (!days.includes(date) || date < today || !activeSlots.includes(slot)) continue;
        if (skipped.has(key) || !usual.has(`${weekday(date)}-${slot}`)) continue;
        const tried = new Set(rejected[key]);
        if (pendingLeftover && !tried.has(pendingLeftover.key)) {
          const label = `restes ${pendingLeftover.name}`;
          out.set(key, {
            key: pendingLeftover.key,
            label,
            variants: [],
            search: fold(label),
            score: 0,
            count: pendingLeftover.count,
            reason: `Restes de « ${pendingLeftover.name} », comme souvent`,
          });
          pendingLeftover = null;
          continue;
        }
        const ranked = suggest(dishes, date, slot, { exclude: used, weekWords, historyMonths, blacklist: blacklistKeys, includeBlacklist, favorites: favoriteKeys });
        // Chaque appui sur ↻ change le tirage (on compte les appuis, pas les plats distincts).
        const draw = `${seed}|${key}|${rejected[key]?.length ?? 0}`;
        // Liste noire incluse : une proposition sur dix environ en vient, les autres jamais.
        const listedTurn = includeBlacklist && hashToUnit(`${draw}|liste`) < BLACKLIST_CHANCE;
        const eligible = ranked.filter((s) => (listedTurn ? s.blacklisted : !s.blacklisted));
        const pool = listedTurn && eligible.length === 0 ? ranked.filter((s) => !s.blacklisted) : eligible;
        const fresh = pool.filter((s) => !tried.has(s.key));
        // Quand tout a été écarté, on repart du classement complet.
        const pick = pickProposal(fresh.length > 0 ? fresh : pool, randomness, draw);
        if (!pick) continue;
        out.set(key, pick);
        count(pick.key);
      }
    }
    return out;
  }, [days, monday, today, bySlot, usual, habits, dishes, rejected, skipped, randomness, historyMonths, seed, activeSlots, blacklistKeys, includeBlacklist, favoriteKeys]);

  /** Un créneau attend une décision s'il est à venir, vide, non retiré et habituellement rempli. */
  const needsDecision = (date: string, slot: Slot) => {
    const key = `${date}|${slot}`;
    if (date < today || bySlot.has(key) || skipped.has(key)) return false;
    return usual.size === 0 || usual.has(`${weekday(date)}-${slot}`);
  };
  // Un créneau passé sans repas n'a plus rien à montrer : il disparaît (avec ses autres agendas), et le jour
  // aussi s'il ne lui reste aucun créneau.
  const visibleDays = days
    .map((date) => ({
      date,
      slots: activeSlots.filter((slot) => (date >= today || bySlot.has(`${date}|${slot}`)) && (!pendingOnly || needsDecision(date, slot))),
    }))
    .filter((day) => day.slots.length > 0);

  /** Ce qui sera accepté pour un créneau : l'idée affichée à la place de la proposition, sinon la proposition. */
  const shownFor = (key: string): ShownProposal | undefined => {
    const override = overrides[key];
    if (override) return { name: override.name, note: override.note };
    const proposal = proposals.get(key);
    return proposal ? { name: proposal.label, note: proposal.reason } : undefined;
  };
  const acceptable = visibleDays.flatMap(({ date, slots }) =>
    slots
      .filter((slot) => date >= today && !bySlot.has(`${date}|${slot}`) && !skipped.has(`${date}|${slot}`) && shownFor(`${date}|${slot}`))
      .map((slot) => ({ date, slot, name: shownFor(`${date}|${slot}`)!.name })),
  );

  const plannedThisWeek = () => {
    const set = new Set<string>();
    for (const day of days) for (const s of SLOTS) for (const m of bySlot.get(`${day}|${s}`) ?? []) set.add(normalize(m.name));
    return set;
  };

  function dropOverride(key: string) {
    setOverrides(({ [key]: _dropped, ...rest }) => rest);
  }

  /** Met un plat dans un créneau, avec « Annuler » pour revenir à l'état d'avant. */
  function accept(date: string, slot: Slot, name: string) {
    const key = `${date}|${slot}`;
    const previous = bySlot.get(key)?.[0]?.name;
    setSlot(date, slot, name);
    setSkip(key, false);
    dropOverride(key);
    flash(`« ${name} » prévu ${dayName(date).toLowerCase()} ${SLOT_LABEL[slot].toLowerCase()}.`, () =>
      previous ? setSlot(date, slot, previous) : clearSlot(date, slot),
    );
  }

  /** Ajoute un plat à un créneau déjà rempli, avec « Annuler ». */
  function addAnother(date: string, slot: Slot, name: string) {
    const before = new Set((bySlot.get(`${date}|${slot}`) ?? []).map((m) => m.id));
    addMeal(date, slot, name);
    flash(`« ${name} » ajouté ${dayName(date).toLowerCase()} ${SLOT_LABEL[slot].toLowerCase()}.`, () => {
      const added = mealsRef.current.find((m) => m.date === date && m.slot === slot && m.name === name.trim() && !before.has(m.id));
      if (added) removeMeal(added.id);
    });
  }

  /** Marque le créneau « Pas de repas » (la proposition disparaît), avec « Annuler ». */
  function skipSlot(key: string, date: string, slot: Slot) {
    setSkip(key, true);
    dropOverride(key);
    flash(`Pas de repas ${dayName(date).toLowerCase()} ${SLOT_LABEL[slot].toLowerCase()}.`, () => setSkip(key, false));
  }

  /** Accepte une proposition pour un autre créneau (elle s'ajoute si ce créneau a déjà un plat). */
  function acceptElsewhere(name: string, date: string, slot: Slot) {
    const key = `${date}|${slot}`;
    const before = new Set((bySlot.get(key) ?? []).map((m) => m.id));
    addMeal(date, slot, name);
    setSkip(key, false);
    flash(`« ${name} » prévu ${dayName(date).toLowerCase()} ${shortDate(date)} ${SLOT_LABEL[slot].toLowerCase()}.`, () => {
      const added = mealsRef.current.find((m) => m.date === date && m.slot === slot && m.name === name.trim() && !before.has(m.id));
      if (added) removeMeal(added.id);
    });
  }

  /** Déplace un repas prévu vers un autre créneau : l'original se vide. */
  function moveTo(meal: Meal, date: string, slot: Slot) {
    moveMeal(meal.id, date, slot);
    setSkip(`${date}|${slot}`, false);
    flash(`« ${meal.name} » déplacé ${dayName(date).toLowerCase()} ${shortDate(date)} ${SLOT_LABEL[slot].toLowerCase()}.`, () =>
      moveMeal(meal.id, meal.date, meal.slot),
    );
  }

  function acceptAll() {
    const todo = [...acceptable];
    for (const { date, slot, name } of todo) {
      setSlot(date, slot, name);
      dropOverride(`${date}|${slot}`);
    }
    flash(`${todo.length} repas ${todo.length > 1 ? 'ajoutés' : 'ajouté'} à la semaine.`, () => {
      for (const { date, slot } of todo) clearSlot(date, slot);
    });
  }

  async function shareWeek() {
    const text = weekText(days, activeSlots, bySlot, skipped);
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      flash('Semaine copiée : tu peux la coller dans un message.');
    } catch {
      window.prompt('Copie la semaine :', text);
    }
  }

  function surpriseSlot(key: string, date: string) {
    const list = surpriseIdeas(dishes, date, shared.surprisePeriod, today, blacklistFilter, ideas);
    let pick = pickSurprise(list, shownIdeas.current, randomness);
    if (!pick && list.length > 0) {
      shownIdeas.current.clear();
      pick = pickSurprise(list, shownIdeas.current, randomness);
    }
    if (!pick) return;
    shownIdeas.current.add(pick.name);
    setOverrides((o) => ({
      ...o,
      [key]: { name: pick.name, icon: '✨', note: [pick.own ? 'Mes idées' : 'Idée nouvelle', ...pick.because].join(' · ') },
    }));
  }

  /** Un plat d'une liste particulière (oubliés, liste noire), différent à chaque appui. */
  function extraSlot(key: string, list: Suggestion[], icon: string, note: (s: Suggestion) => string, empty: string) {
    if (list.length === 0) {
      flash(empty);
      return;
    }
    let fresh = list.filter((s) => !shownExtras.current.has(`${icon}|${s.key}`));
    if (fresh.length === 0) {
      for (const s of list) shownExtras.current.delete(`${icon}|${s.key}`);
      fresh = list;
    }
    const pick = pickProposal(fresh, randomness, `${Math.random()}|${icon}|${key}`);
    if (!pick) return;
    shownExtras.current.add(`${icon}|${pick.key}`);
    setOverrides((o) => ({ ...o, [key]: { name: pick.label, icon, note: note(pick) } }));
  }

  function forgottenSlot(key: string, date: string, slot: Slot) {
    const list = forgottenDishes(dishes, date, slot, { exclude: plannedThisWeek(), blacklist: blacklistKeys, today });
    extraSlot(key, list, '🕰️', (s) => `Plat oublié · ${s.reason}`, "Aucun plat oublié : tu as mangé cette année tout ce que tu mangeais souvent.");
  }

  function blacklistSlot(key: string, date: string, slot: Slot) {
    const list = suggest(dishes, date, slot, { exclude: plannedThisWeek(), blacklist: blacklistKeys, includeBlacklist: true }).filter((s) => s.blacklisted);
    extraSlot(key, list, '🍽️', (s) => `Liste noire · ${s.reason}`, "Aucun plat de la liste noire dans ton historique pour l'instant.");
  }

  // Changer de semaine : la semaine affichée glisse hors de l'écran, la nouvelle arrive du côté opposé.
  const weekRef = useRef<HTMLElement>(null);
  const animating = useRef(false);
  const [slideDir, setSlideDir] = useState<'next' | 'prev' | null>(null);

  function goToWeek(target: string, offset = 0) {
    if (target === monday || animating.current) return;
    const dir = target > monday ? 'next' : 'prev';
    const el = weekRef.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSlideDir(null);
      setMonday(target);
      return;
    }
    animating.current = true;
    const away = (dir === 'next' ? -1 : 1) * Math.max(48, Math.abs(offset) + 24);
    el.style.transition = 'transform 0.14s ease-in, opacity 0.14s ease-in';
    el.style.transform = `translateX(${away}px)`;
    el.style.opacity = '0';
    window.setTimeout(() => {
      animating.current = false;
      setSlideDir(dir);
      setMonday(target);
    }, 140);
  }

  // Sur téléphone, la semaine suit le doigt ; relâchée au-delà de 70 px, on change de semaine, sinon elle revient.
  const touch = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const FOLLOW = 0.7;
  const onTouchStart = (e: React.TouchEvent) => {
    if (animating.current) return;
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dragging: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const start = touch.current;
    const el = weekRef.current;
    if (!start || !el) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;
    if (!start.dragging) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        touch.current = null; // défilement vertical : on laisse faire
        return;
      }
      if (Math.abs(dx) < 10 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
      start.dragging = true;
    }
    el.style.transition = 'none';
    el.style.transform = `translateX(${dx * FOLLOW}px)`;
    el.style.opacity = String(1 - Math.min(Math.abs(dx) / 400, 0.5));
  };
  const snapBack = () => {
    const el = weekRef.current;
    if (!el) return;
    el.style.transition = 'transform 0.18s ease-out, opacity 0.18s ease-out';
    el.style.transform = '';
    el.style.opacity = '';
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start?.dragging) return;
    const dx = e.changedTouches[0].clientX - start.x;
    if (Math.abs(dx) > 70) goToWeek(addDays(monday, dx < 0 ? 7 : -7), dx * FOLLOW);
    else snapBack();
  };
  const onTouchCancel = () => {
    if (touch.current?.dragging) snapBack();
    touch.current = null;
  };

  return (
    <>
      <nav className="week-nav" aria-label="Semaine affichée">
        <button onClick={() => goToWeek(addDays(monday, -7))} aria-label="Semaine précédente">
          ‹
        </button>
        <span className="week-label">
          {shortDate(monday)} – {longDate(days[6])}
        </span>
        <button onClick={() => goToWeek(addDays(monday, 7))} aria-label="Semaine suivante">
          ›
        </button>
      </nav>

      <div className="week-tools">
        {monday !== thisMonday && (
          <button className="chip" onClick={() => goToWeek(thisMonday)}>
            Aujourd'hui
          </button>
        )}
        {acceptable.length > 0 && (
          <button className="chip" onClick={acceptAll}>
            ✓ Tout accepter ({acceptable.length})
          </button>
        )}
        <button className="chip" onClick={() => void shareWeek()}>
          Partager la semaine
        </button>
        <button
          className="chip layout-chip"
          onClick={() => props.setWeekLayout(props.weekLayout === 'columns' ? 'list' : 'columns')}
          title="Disposition de la semaine sur ordinateur"
        >
          {props.weekLayout === 'columns' ? '☰ Vue liste' : '▥ Vue colonnes'}
        </button>
      </div>

      {loading ? (
        <p className="loading" role="status">
          <span className="spinner" aria-hidden="true" />
          Chargement de l'agenda…
        </p>
      ) : (
        <main
          key={monday}
          ref={weekRef}
          className={`week${slideDir ? ` slide-${slideDir}` : ''}`}
          onAnimationEnd={() => setSlideDir(null)}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
        >
          {visibleDays.length === 0 && (
            <p className="all-done">{days[6] < today ? 'Aucun repas enregistré cette semaine.' : 'Tout est décidé pour cette semaine.'}</p>
          )}
          {visibleDays.map(({ date, slots }) => (
            <section
              key={date}
              className={`day${date === today ? ' today' : ''}${date < today ? ' past' : ''}`}
              // Vue colonnes : chaque jour garde sa colonne, même quand ceux d'avant sont masqués.
              style={{ '--col': days.indexOf(date) + 1 } as React.CSSProperties}
            >
              <h2>
                {dayName(date)}{' '}
                <span>
                  <span className="date-long">{shortDate(date)}</span>
                  <span className="date-short">{tinyDate(date)}</span>
                </span>
              </h2>
              {slots.map((slot) => {
                const key = `${date}|${slot}`;
                const planned = bySlot.get(key);
                const proposal = proposals.get(key);
                const override = overrides[key];
                const shown = shownFor(key);
                const slotOthers = others.get(key);
                const where = `${dayName(date)} ${SLOT_LABEL[slot]}`;
                return (
                  <div key={slot} className={`slot slot-${slot}`}>
                    <span className="slot-label">{SLOT_LABEL[slot]}</span>
                    <div className="slot-body">
                      {planned ? (
                        <button className="meal with-thumb" onClick={() => setEditing({ date, slot })}>
                          <DishThumb name={planned[0].name} enabled={props.showImages} />
                          <span className="meal-text">
                          <Breakable text={planned.map((m) => m.name).join(' + ')} />
                          {planned.some((m) => m.note) && (
                            <span className="note-mark" title={planned.map((m) => m.note).filter(Boolean).join('\n')} aria-label="avec une note">
                              📝
                            </span>
                          )}
                          </span>
                        </button>
                      ) : skipped.has(key) ? (
                        <button className="add skipped" onClick={() => setEditing({ date, slot })}>
                          Pas de repas
                        </button>
                      ) : proposal && shown ? (
                        <div className="proposal">
                          <button className="proposal-name with-thumb" onClick={() => setEditing({ date, slot, proposal: shown })}>
                            <DishThumb name={shown.name} enabled={props.showImages} />
                            <span className="meal-text">
                              <Breakable text={override ? `${override.icon} ${override.name}` : proposal.label} />
                              <small>{shown.note}</small>
                            </span>
                          </button>
                          <div className="proposal-actions">
                            <button
                              className="icon"
                              onClick={() => {
                                if (override) dropOverride(key);
                                else setRejected({ ...rejected, [key]: [...(rejected[key] ?? []), proposal.key] });
                              }}
                              aria-label={`Autre proposition pour ${where}`}
                              title="Autre proposition"
                            >
                              ↻
                            </button>
                            <button
                              className="icon ban"
                              onClick={() => skipSlot(key, date, slot)}
                              aria-label={`Pas de repas ${where}`}
                              title={`Pas besoin de repas ce ${SLOT_LABEL[slot].toLowerCase()}`}
                            >
                              ∅
                            </button>
                            <ProposalMenu label={`Plus d'options pour ${where}`} open={menuFor === key} onToggle={(open) => setMenuFor(open ? key : null)}>
                              <MenuItem
                                icon="📅"
                                label="Accepter pour un autre créneau…"
                                hint="choisir le jour, midi ou soir"
                                onClick={() => setPicking({ mode: 'accept', name: shown.name, from: key, override: !!override })}
                              />
                              <MenuItem icon="✨" label="Surprise Me" hint="un plat jamais noté" onClick={() => surpriseSlot(key, date)} />
                              <MenuItem icon="🕰️" label="Un plat oublié" hint="souvent mangé, plus depuis un an" onClick={() => forgottenSlot(key, date, slot)} />
                              {blacklistKeys.size > 0 && (
                                <MenuItem icon="🍽️" label="Un plat de la liste noire" hint="resto, à emporter…" onClick={() => blacklistSlot(key, date, slot)} />
                              )}
                              <MenuItem
                                icon={isFavorite(shown.name) ? '☆' : '⭐'}
                                label={isFavorite(shown.name) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                                hint={isFavorite(shown.name) ? undefined : 'proposé plus souvent'}
                                onClick={() => toggleFavorite(shown.name)}
                              />
                            </ProposalMenu>
                            <button className="icon accept" onClick={() => accept(date, slot, shown.name)} aria-label={`Accepter ${shown.name}`} title="Accepter">
                              ✓
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button className="add" onClick={() => setEditing({ date, slot })}>
                          + Ajouter
                        </button>
                      )}
                      {slotOthers && <OtherEvents events={slotOthers} compact />}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </main>
      )}

      {editing && (
        <SlotSheet
          date={editing.date}
          slot={editing.slot}
          current={bySlot.get(`${editing.date}|${editing.slot}`)}
          proposal={editing.proposal}
          others={others.get(`${editing.date}|${editing.slot}`)}
          suggestions={suggest(dishes, editing.date, editing.slot, { blacklist: blacklistKeys, includeBlacklist: true, favorites: favoriteKeys })}
          showImages={props.showImages}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
          isBlacklisted={props.isBlacklisted}
          onToggleBlacklist={props.toggleBlacklist}
          notes={props.notes}
          onSetNote={setNote}
          includeBlacklist={includeBlacklist}
          blacklistFilter={blacklistFilter}
          ideas={ideas}
          dishes={dishes}
          today={today}
          randomness={randomness}
          period={shared.surprisePeriod}
          onPeriodChange={props.onSurprisePeriod}
          onRemoveMeal={removeMeal}
          skipped={skipped.has(`${editing.date}|${editing.slot}`)}
          onSkip={(skip) => {
            setSkip(`${editing.date}|${editing.slot}`, skip);
            setEditing(null);
          }}
          onPick={(name) => {
            accept(editing.date, editing.slot, name);
            setEditing(null);
          }}
          onAdd={(name) => {
            addAnother(editing.date, editing.slot, name);
            setEditing(null);
          }}
          onAcceptElsewhere={(name) => {
            const key = `${editing.date}|${editing.slot}`;
            setPicking({ mode: 'accept', name, from: key, override: !!overrides[key] });
            setEditing(null);
          }}
          onMove={(meal) => {
            setPicking({ mode: 'move', meal });
            setEditing(null);
          }}
          onClear={() => {
            clearSlot(editing.date, editing.slot);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {picking && (
        <SlotPicker
          title={picking.mode === 'accept' ? 'Accepter pour un autre créneau' : 'Déplacer vers…'}
          name={picking.mode === 'accept' ? picking.name : picking.meal.name}
          today={today}
          bySlot={bySlot}
          skipped={skipped}
          from={picking.mode === 'move' ? `${picking.meal.date}|${picking.meal.slot}` : undefined}
          onPick={(date, slot) => {
            if (picking.mode === 'accept') {
              acceptElsewhere(picking.name, date, slot);
              if (picking.override) dropOverride(picking.from);
            } else moveTo(picking.meal, date, slot);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

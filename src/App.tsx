import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DuplicatesPage } from './Duplicates';
import { addDays, dayName, longDate, mondayOf, shortDate, todayIso, weekday } from './lib/dates';
import { useGoogleMeals } from './lib/googleStore';
import { parseIcs } from './lib/ics';
import { useMeals, useSkippedSlots } from './lib/store';
import {
  DEFAULT_RANDOMNESS,
  RANDOMNESS_LEVELS,
  buildIndex,
  fold,
  normalize,
  pickProposal,
  suggest,
  usualSlots,
  type DishIndex,
  type Suggestion,
} from './lib/suggest';
import { DEFAULT_PERIOD_MONTHS, PERIODS, pickSurprise, surpriseIdeas, type Surprise } from './lib/surprise';
import { SLOTS, type Meal, type MealStore, type Slot } from './lib/types';

const SLOT_LABEL: Record<Slot, string> = { midi: 'Midi', soir: 'Soir' };
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
const GOOGLE_CALENDAR_NAME = import.meta.env.VITE_GOOGLE_CALENDAR_NAME?.trim() || 'Repas';

/** Avec un ID client Google, l'agenda est la référence ; sinon tout reste dans le navigateur. */
export function App() {
  return GOOGLE_CLIENT_ID ? <GoogleApp /> : <LocalApp />;
}

function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <p className="notice" role="status">
      {text}
      <button className="link" onClick={onClose} aria-label="Fermer le message">
        ✕
      </button>
    </p>
  );
}

function GoogleApp() {
  const store = useGoogleMeals(GOOGLE_CLIENT_ID, GOOGLE_CALENDAR_NAME);
  const { connected, syncing, error, meals } = store;
  return (
    <Planner
      store={store}
      action={
        connected ? (
          <button className="ghost-btn" onClick={store.disconnect}>
            {syncing ? 'Synchronisation…' : 'Se déconnecter'}
          </button>
        ) : (
          <button className="ghost-btn primary" onClick={store.connect}>
            Se connecter avec Google
          </button>
        )
      }
      banner={
        <>
          {error && <Notice text={error} onClose={store.dismissError} />}
          {!connected && !error && (
            <p className="notice" role="status">
              {meals.length === 0
                ? `Connecte-toi avec Google pour afficher l'agenda « ${GOOGLE_CALENDAR_NAME} » et recevoir des propositions.`
                : "Tu vois la dernière copie de l'agenda. Connecte-toi avec Google pour le modifier."}
            </p>
          )}
        </>
      }
      footer={`synchronisés avec l'agenda « ${GOOGLE_CALENDAR_NAME} »`}
    />
  );
}

function LocalApp() {
  const { meals, importMeals, setSlot, clearSlot, clearAll, renameMeals } = useMeals();
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const imported = parseIcs(await file.text());
      if (imported.length === 0) {
        setNotice("Aucun repas trouvé dans ce fichier. Il faut le fichier .ics (dézippé) exporté depuis Google Agenda.");
        return;
      }
      importMeals(imported);
      const dates = imported.map((m) => m.date).sort();
      setNotice(`${imported.length} repas importés, du ${longDate(dates[0])} au ${longDate(dates[dates.length - 1])}.`);
    } catch {
      setNotice('Impossible de lire ce fichier.');
    }
  }

  return (
    <Planner
      store={{ meals, setSlot, clearSlot, renameMeals }}
      action={
        <>
          <button className="ghost-btn" onClick={() => fileInput.current?.click()}>
            Importer un .ics
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".ics,.ical,text/calendar"
            hidden
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </>
      }
      banner={
        <>
          {notice && <Notice text={notice} onClose={() => setNotice('')} />}
          {meals.length === 0 && (
            <section className="empty">
              <h2>Commencer avec ton historique</h2>
              <ol>
                <li>Sur ordinateur, ouvre Google Agenda, puis Paramètres.</li>
                <li>À gauche, clique sur l'agenda « Repas », puis sur « Exporter l'agenda ».</li>
                <li>Dézippe le fichier téléchargé : il contient un fichier .ics.</li>
                <li>Clique sur « Importer un .ics » ci-dessus et choisis ce fichier.</li>
              </ol>
              <p>Le fichier reste dans ce navigateur : rien n'est envoyé sur un serveur.</p>
            </section>
          )}
        </>
      }
      footer={
        <button
          className="link"
          onClick={() => {
            if (confirm('Effacer tous les repas enregistrés dans ce navigateur ?')) clearAll();
          }}
        >
          tout effacer
        </button>
      }
    />
  );
}

const PENDING_KEY = 'mymeals.pendingOnly';

function loadPendingOnly(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

const RANDOMNESS_KEY = 'mymeals.randomness';

function loadRandomness(): number {
  try {
    const stored = localStorage.getItem(RANDOMNESS_KEY);
    const level = stored === null ? NaN : Number(stored);
    return Number.isInteger(level) && level >= 0 && level < RANDOMNESS_LEVELS.length ? level : DEFAULT_RANDOMNESS;
  } catch {
    return DEFAULT_RANDOMNESS;
  }
}

interface Editing {
  date: string;
  slot: Slot;
}

interface PlannerProps {
  store: MealStore;
  /** Bouton affiché à droite du titre. */
  action: ReactNode;
  /** Messages affichés au-dessus de la semaine. */
  banner: ReactNode;
  /** Complément de la ligne de bas de page. */
  footer: ReactNode;
}

type View = 'planning' | 'doublons';

/** La page affichée est mémorisée dans l'adresse (#doublons), pour que « retour » fonctionne. */
function useView(): [View, (view: View) => void] {
  const read = (): View => (window.location.hash === '#doublons' ? 'doublons' : 'planning');
  const [view, setView] = useState<View>(read);
  useEffect(() => {
    const onChange = () => setView(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return [view, (next) => { window.location.hash = next === 'doublons' ? 'doublons' : ''; }];
}

function Planner({ store, action, banner, footer }: PlannerProps) {
  const { meals, setSlot, clearSlot } = store;
  const [view, setView] = useView();
  const today = todayIso();
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [editing, setEditing] = useState<Editing | null>(null);
  // Propositions déjà écartées avec ↻, par créneau.
  const [rejected, setRejected] = useState<Record<string, string[]>>({});
  const [randomness, setRandomness] = useState(loadRandomness);
  // Change à chaque ouverture de l'application, pour ne pas revoir le même tirage.
  const [seed] = useState(() => String(Math.random()));
  const [pendingOnly, setPendingOnly] = useState(loadPendingOnly);
  // Idées « Surprise Me » affichées à la place de la proposition, par créneau.
  const [surprises, setSurprises] = useState<Record<string, Surprise>>({});
  const surprisesShown = useRef(new Set<string>());
  const { skipped, setSkip } = useSkippedSlots(today);

  const dishes = useMemo(() => buildIndex(meals), [meals]);
  const usual = useMemo(() => usualSlots(meals, today), [meals, today]);
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
    for (const date of days) {
      for (const slot of SLOTS) {
        for (const meal of bySlot.get(`${date}|${slot}`) ?? []) count(normalize(meal.name));
      }
    }
    for (const date of days) {
      if (date < today) continue;
      for (const slot of SLOTS) {
        const key = `${date}|${slot}`;
        if (bySlot.has(key) || skipped.has(key) || !usual.has(`${weekday(date)}-${slot}`)) continue;
        const ranked = suggest(dishes, date, slot, { exclude: used, weekWords });
        const tried = new Set(rejected[key]);
        const fresh = ranked.filter((s) => !tried.has(s.key));
        // Quand tout a été écarté, on repart du classement complet.
        const pick = pickProposal(fresh.length > 0 ? fresh : ranked, randomness, `${seed}|${key}`);
        if (!pick) continue;
        out.set(key, pick);
        count(pick.key);
      }
    }
    return out;
  }, [days, today, bySlot, usual, dishes, rejected, skipped, randomness, seed]);

  const sunday = days[6];

  /** Un créneau attend une décision s'il est à venir, vide, non retiré et habituellement rempli. */
  const needsDecision = (date: string, slot: Slot) => {
    const key = `${date}|${slot}`;
    if (date < today || bySlot.has(key) || skipped.has(key)) return false;
    return usual.size === 0 || usual.has(`${weekday(date)}-${slot}`);
  };
  const visibleDays = days
    .map((date) => ({ date, slots: SLOTS.filter((slot) => !pendingOnly || needsDecision(date, slot)) }))
    .filter((day) => day.slots.length > 0);

  function surpriseSlot(key: string, date: string) {
    const ideas = surpriseIdeas(dishes, date, loadPeriod(), today);
    let pick = pickSurprise(ideas, surprisesShown.current);
    if (!pick && ideas.length > 0) {
      surprisesShown.current.clear();
      pick = pickSurprise(ideas, surprisesShown.current);
    }
    if (!pick) return;
    surprisesShown.current.add(pick.name);
    setSurprises({ ...surprises, [key]: pick });
  }

  function dropSurprise(key: string) {
    const { [key]: _dropped, ...rest } = surprises;
    setSurprises(rest);
  }

  return (
    <div className="app">
      <header className="top">
        <h1>MyMeals</h1>
        {action}
      </header>

      {banner}

      <nav className="tabs" aria-label="Pages">
        <button aria-current={view === 'planning' ? 'page' : undefined} onClick={() => setView('planning')}>
          Planning
        </button>
        <button aria-current={view === 'doublons' ? 'page' : undefined} onClick={() => setView('doublons')}>
          Doublons
        </button>
      </nav>

      {view === 'doublons' ? (
        <DuplicatesPage store={store} />
      ) : (
        <>
      <nav className="week-nav" aria-label="Semaine affichée">
        <button onClick={() => setMonday(addDays(monday, -7))} aria-label="Semaine précédente">
          ‹
        </button>
        <button className="week-label" onClick={() => setMonday(mondayOf(today))} title="Revenir à cette semaine">
          {shortDate(monday)} – {longDate(sunday)}
        </button>
        <button onClick={() => setMonday(addDays(monday, 7))} aria-label="Semaine suivante">
          ›
        </button>
      </nav>

      <div className="settings">
        <label className="switch">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => {
              setPendingOnly(e.target.checked);
              try {
                localStorage.setItem(PENDING_KEY, e.target.checked ? '1' : '0');
              } catch {
                // le réglage vaudra pour cette session
              }
            }}
          />
          <span className="switch-track" aria-hidden="true" />
          À décider seulement
        </label>
        {meals.length > 0 && (
          <label className="setting">
            Hasard des propositions
            <select
              value={randomness}
              onChange={(e) => {
                const level = Number(e.target.value);
                setRandomness(level);
                setRejected({});
                try {
                  localStorage.setItem(RANDOMNESS_KEY, String(level));
                } catch {
                  // le réglage vaudra pour cette session
                }
              }}
            >
              {RANDOMNESS_LEVELS.map((level, i) => (
                <option key={level.label} value={i}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <main className="week">
        {visibleDays.length === 0 && <p className="all-done">Tout est décidé pour cette semaine.</p>}
        {visibleDays.map(({ date, slots }) => (
          <section key={date} className={`day${date === today ? ' today' : ''}${date < today ? ' past' : ''}`}>
            <h2>
              {dayName(date)} <span>{shortDate(date)}</span>
            </h2>
            {slots.map((slot) => {
              const key = `${date}|${slot}`;
              const planned = bySlot.get(key);
              const proposal = proposals.get(key);
              const surprise = surprises[key];
              return (
                <div key={slot} className="slot">
                  <span className="slot-label">{SLOT_LABEL[slot]}</span>
                  {planned ? (
                    <button className="meal" onClick={() => setEditing({ date, slot })}>
                      {planned.map((m) => m.name).join(' + ')}
                    </button>
                  ) : skipped.has(key) ? (
                    <button className="add skipped" onClick={() => setEditing({ date, slot })}>
                      Pas de repas
                    </button>
                  ) : proposal ? (
                    <div className="proposal">
                      <button className="proposal-name" onClick={() => setEditing({ date, slot })}>
                        {surprise ? `✨ ${surprise.name}` : proposal.label}
                        <small>
                          {surprise
                            ? ['Idée nouvelle', ...surprise.because].join(' · ')
                            : proposal.reason}
                        </small>
                      </button>
                      <button
                        className="icon"
                        onClick={() => setSkip(key, true)}
                        aria-label={`Pas de repas ${dayName(date)} ${SLOT_LABEL[slot]}`}
                        title="Pas de repas sur ce créneau"
                      >
                        ✕
                      </button>
                      <button
                        className="icon"
                        onClick={() => {
                          if (surprise) dropSurprise(key);
                          else setRejected({ ...rejected, [key]: [...(rejected[key] ?? []), proposal.key] });
                        }}
                        aria-label={`Autre proposition pour ${dayName(date)} ${SLOT_LABEL[slot]}`}
                        title="Autre proposition"
                      >
                        ↻
                      </button>
                      <button
                        className="icon"
                        onClick={() => surpriseSlot(key, date)}
                        aria-label={`Surprise Me pour ${dayName(date)} ${SLOT_LABEL[slot]}`}
                        title="Surprise Me : un plat jamais noté"
                      >
                        ✨
                      </button>
                      <button
                        className="icon accept"
                        onClick={() => {
                          setSlot(date, slot, surprise?.name ?? proposal.label);
                          if (surprise) dropSurprise(key);
                        }}
                        aria-label={`Accepter ${surprise?.name ?? proposal.label}`}
                        title="Accepter"
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <button className="add" onClick={() => setEditing({ date, slot })}>
                      + Ajouter
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </main>
        </>
      )}

      {meals.length > 0 && (
        <footer className="foot">
          {meals.length} repas enregistrés · {dishes.dishes.length} plats différents ·{' '}
          {footer}
        </footer>
      )}

      {editing && (
        <SlotSheet
          date={editing.date}
          slot={editing.slot}
          current={bySlot.get(`${editing.date}|${editing.slot}`)}
          suggestions={suggest(dishes, editing.date, editing.slot)}
          dishes={dishes}
          today={today}
          skipped={skipped.has(`${editing.date}|${editing.slot}`)}
          onSkip={(skip) => {
            setSkip(`${editing.date}|${editing.slot}`, skip);
            setEditing(null);
          }}
          onPick={(name) => {
            setSlot(editing.date, editing.slot, name);
            setSkip(`${editing.date}|${editing.slot}`, false);
            setEditing(null);
          }}
          onClear={() => {
            clearSlot(editing.date, editing.slot);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface SheetProps {
  date: string;
  slot: Slot;
  current: Meal[] | undefined;
  suggestions: Suggestion[];
  dishes: DishIndex;
  today: string;
  skipped: boolean;
  onSkip: (skip: boolean) => void;
  onPick: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function SlotSheet({ date, slot, current, suggestions, dishes, today, skipped, onSkip, onPick, onClear, onClose }: SheetProps) {
  const [query, setQuery] = useState('');
  // Chaque mot saisi doit se retrouver dans une des écritures du plat, dans n'importe quel ordre.
  const needles = fold(query).split(/[\s/]+/).filter(Boolean);
  const shown = suggestions.filter((s) => needles.every((n) => s.search.includes(n))).slice(0, 30);
  const queryKey = normalize(query);
  const exact = suggestions.some((s) => s.key === queryKey);

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${dayName(date)} ${shortDate(date)}, ${SLOT_LABEL[slot]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2>
            {dayName(date)} {shortDate(date)} · {SLOT_LABEL[slot]}
          </h2>
          <button className="icon" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        {current && (
          <p className="current">
            Prévu : <strong>{current.map((m) => m.name).join(' + ')}</strong>
            <button className="link danger" onClick={onClear}>
              Retirer
            </button>
          </p>
        )}
        {!current && (
          <p className="current">
            {skipped ? 'Créneau marqué sans repas.' : 'Pas besoin de repas ?'}
            <button className="link skip-link" onClick={() => onSkip(!skipped)}>
              {skipped ? 'Remettre ce créneau' : 'Retirer ce créneau'}
            </button>
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) onPick(query);
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher ou saisir un plat"
            aria-label="Chercher ou saisir un plat"
          />
        </form>
        <SurpriseMe date={date} dishes={dishes} today={today} onPick={onPick} />
        <ul className="choices">
          {query.trim() && !exact && (
            <li>
              <button onClick={() => onPick(query)}>
                <span>Ajouter « {query.trim()} »</span>
              </button>
            </li>
          )}
          {shown.map((s) => (
            <li key={s.key}>
              <button onClick={() => onPick(s.label)}>
                <span>
                  {s.label}
                  {s.variants.length > 0 && <small>aussi écrit : {s.variants.slice(0, 3).join(', ')}</small>}
                </span>
                <small>{s.reason}</small>
              </button>
            </li>
          ))}
          {shown.length === 0 && !query.trim() && (
            <li className="hint">Pas encore d'historique : saisis un plat ci-dessus.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

const PERIOD_KEY = 'mymeals.surprise.months';

function loadPeriod(): number {
  try {
    const stored = Number(localStorage.getItem(PERIOD_KEY));
    return PERIODS.some((p) => p.months === stored) ? stored : DEFAULT_PERIOD_MONTHS;
  } catch {
    return DEFAULT_PERIOD_MONTHS;
  }
}

interface SurpriseProps {
  date: string;
  dishes: DishIndex;
  today: string;
  onPick: (name: string) => void;
}

/** Propose un plat absent de l'historique, choisi d'après les goûts de la période réglée. */
function SurpriseMe({ date, dishes, today, onPick }: SurpriseProps) {
  const [months, setMonths] = useState(loadPeriod);
  const [idea, setIdea] = useState<Surprise | null>(null);
  const [opened, setOpened] = useState(false);
  const shown = useRef(new Set<string>());

  function draw(period: number) {
    const ideas = surpriseIdeas(dishes, date, period, today);
    let pick = pickSurprise(ideas, shown.current);
    if (!pick && ideas.length > 0) {
      // Toutes les idées ont été vues : on repart du début.
      shown.current.clear();
      pick = pickSurprise(ideas, shown.current);
    }
    if (pick) shown.current.add(pick.name);
    setIdea(pick);
    setOpened(true);
  }

  if (!opened) {
    return (
      <button className="surprise-btn" onClick={() => draw(months)}>
        ✨ Surprise Me
      </button>
    );
  }

  return (
    <section className="surprise" aria-live="polite">
      {idea ? (
        <>
          <p className="surprise-name">✨ {idea.name}</p>
          <p className="surprise-why">
            {idea.because.length > 0
              ? `Jamais noté dans tes repas. Proche de tes goûts récents : ${idea.because.join(' et ')}.`
              : 'Jamais noté dans tes repas. Pas assez de repas sur cette période pour cerner tes goûts.'}
          </p>
          <div className="surprise-actions">
            <button className="ghost-btn primary" onClick={() => onPick(idea.name)}>
              Choisir
            </button>
            <button className="ghost-btn" onClick={() => draw(months)}>
              Une autre
            </button>
            <a
              className="link"
              href={`https://www.google.com/search?q=${encodeURIComponent(`recette ${idea.name}`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Voir des recettes
            </a>
          </div>
        </>
      ) : (
        <p className="surprise-why">Tu connais déjà tous les plats de mon catalogue.</p>
      )}
      <label className="surprise-period">
        D'après mes repas des
        <select
          value={months}
          onChange={(e) => {
            const period = Number(e.target.value);
            setMonths(period);
            try {
              localStorage.setItem(PERIOD_KEY, String(period));
            } catch {
              // le réglage vaudra pour cette session
            }
            shown.current.clear();
            draw(period);
          }}
        >
          {PERIODS.map((p) => (
            <option key={p.months} value={p.months}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

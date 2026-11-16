import { useMemo, useRef, useState, type ReactNode } from 'react';
import { addDays, dayName, longDate, mondayOf, shortDate, todayIso, weekday } from './lib/dates';
import { useGoogleMeals } from './lib/googleStore';
import { parseIcs } from './lib/ics';
import { useMeals } from './lib/store';
import { buildIndex, fold, normalize, suggest, usualSlots, type Suggestion } from './lib/suggest';
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
  const { meals, importMeals, setSlot, clearSlot, clearAll } = useMeals();
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
      store={{ meals, setSlot, clearSlot }}
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

function Planner({ store, action, banner, footer }: PlannerProps) {
  const { meals, setSlot, clearSlot } = store;
  const today = todayIso();
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [skips, setSkips] = useState<Record<string, number>>({});

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
        if (bySlot.has(key) || !usual.has(`${weekday(date)}-${slot}`)) continue;
        const ranked = suggest(dishes, date, slot, { exclude: used, weekWords }).slice(0, 12);
        if (ranked.length === 0) continue;
        const pick = ranked[(skips[key] ?? 0) % ranked.length];
        out.set(key, pick);
        count(pick.key);
      }
    }
    return out;
  }, [days, today, bySlot, usual, dishes, skips]);

  const sunday = days[6];

  return (
    <div className="app">
      <header className="top">
        <h1>MyMeals</h1>
        {action}
      </header>

      {banner}

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

      <main className="week">
        {days.map((date) => (
          <section key={date} className={`day${date === today ? ' today' : ''}${date < today ? ' past' : ''}`}>
            <h2>
              {dayName(date)} <span>{shortDate(date)}</span>
            </h2>
            {SLOTS.map((slot) => {
              const key = `${date}|${slot}`;
              const planned = bySlot.get(key);
              const proposal = proposals.get(key);
              return (
                <div key={slot} className="slot">
                  <span className="slot-label">{SLOT_LABEL[slot]}</span>
                  {planned ? (
                    <button className="meal" onClick={() => setEditing({ date, slot })}>
                      {planned.map((m) => m.name).join(' + ')}
                    </button>
                  ) : proposal ? (
                    <div className="proposal">
                      <button className="proposal-name" onClick={() => setEditing({ date, slot })}>
                        {proposal.label}
                        <small>{proposal.reason}</small>
                      </button>
                      <button
                        className="icon"
                        onClick={() => setSkips({ ...skips, [key]: (skips[key] ?? 0) + 1 })}
                        aria-label={`Autre proposition pour ${dayName(date)} ${SLOT_LABEL[slot]}`}
                        title="Autre proposition"
                      >
                        ↻
                      </button>
                      <button
                        className="icon accept"
                        onClick={() => setSlot(date, slot, proposal.label)}
                        aria-label={`Accepter ${proposal.label}`}
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
          onPick={(name) => {
            setSlot(editing.date, editing.slot, name);
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
  onPick: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function SlotSheet({ date, slot, current, suggestions, onPick, onClear, onClose }: SheetProps) {
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

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DuplicatesPage } from './Duplicates';
import { blacklistedKeys, parseBlacklist, type BlacklistFilter } from './lib/blacklist';
import {
  DEFAULT_SETTINGS,
  decideSync,
  loadSettingsStamp,
  saveSettingsStamp,
  type SharedSettings,
} from './lib/settings';
import { ThemePicker } from './ThemePicker';
import { addDays, dayName, longDate, mondayOf, shortDate, todayIso, weekday } from './lib/dates';
import { useGoogleMeals } from './lib/googleStore';
import { parseIcs } from './lib/ics';
import { useMeals, useSkippedSlots } from './lib/store';
import {
  BLACKLIST_CHANCE,
  DEFAULT_HISTORY_MONTHS,
  DEFAULT_RANDOMNESS,
  HISTORY_WINDOWS,
  RANDOMNESS_LEVELS,
  buildIndex,
  fold,
  hashToUnit,
  normalize,
  pickProposal,
  suggest,
  usualSlots,
  type DishIndex,
  type Suggestion,
} from './lib/suggest';
import { DEFAULT_PERIOD_MONTHS, PERIODS, pickSurprise, surpriseIdeas, type Surprise } from './lib/surprise';
import { SLOTS, type Meal, type MealStore, type SettingsSync, type Slot } from './lib/types';

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
  const { connected, canRenew, syncing, error, meals } = store;
  return (
    <Planner
      store={store}
      settingsSync={{ remote: store.settings, save: store.saveSettings }}
      action={
        connected ? (
          <button className="ghost-btn" onClick={store.disconnect}>
            {syncing ? 'Synchronisation…' : 'Se déconnecter'}
          </button>
        ) : (
          <button className="ghost-btn primary" onClick={store.connect}>
            {canRenew ? 'Reconnecter' : 'Se connecter avec Google'}
          </button>
        )
      }
      banner={
        <>
          {error && <Notice text={error} onClose={store.dismissError} />}
          {!connected && !error && (
            <p className="notice" role="status">
              {canRenew
                ? "La connexion Google a expiré (elle dure une heure). Touche l'écran pour la renouveler, ou utilise « Reconnecter »."
                : meals.length === 0
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
  const { meals, importMeals, setSlot, clearSlot, removeMeal, clearAll, renameMeals } = useMeals();
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
      store={{ meals, setSlot, clearSlot, removeMeal, renameMeals }}
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

type SlotMode = Slot | 'both';

const SLOT_MODES: { value: SlotMode; label: string }[] = [
  { value: 'midi', label: 'Midi' },
  { value: 'soir', label: 'Soir' },
  { value: 'both', label: 'Les deux' },
];
const SLOT_MODE_KEY = 'mymeals.slotMode';
const DEFAULT_SLOT_MODE: SlotMode = 'soir';

function loadSlotMode(): SlotMode {
  try {
    const stored = localStorage.getItem(SLOT_MODE_KEY);
    return SLOT_MODES.some((m) => m.value === stored) ? (stored as SlotMode) : DEFAULT_SLOT_MODE;
  } catch {
    return DEFAULT_SLOT_MODE;
  }
}

const PENDING_KEY = 'mymeals.pendingOnly';

function loadPendingOnly(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

const HISTORY_KEY = 'mymeals.historyMonths';

function loadHistoryMonths(): number {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    const months = stored === null ? NaN : Number(stored);
    return HISTORY_WINDOWS.some((w) => w.months === months) ? months : DEFAULT_HISTORY_MONTHS;
  } catch {
    return DEFAULT_HISTORY_MONTHS;
  }
}

const PERIOD_KEY = 'mymeals.surprise.months';

function loadPeriod(): number {
  try {
    const stored = localStorage.getItem(PERIOD_KEY);
    const months = stored === null ? NaN : Number(stored);
    return PERIODS.some((p) => p.months === months) ? months : DEFAULT_PERIOD_MONTHS;
  } catch {
    return DEFAULT_PERIOD_MONTHS;
  }
}

function remember(key: string, value: number | string): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // le réglage vaudra pour cette session
  }
}

const BLACKLIST_TEXT_KEY = 'mymeals.blacklist.text';
const BLACKLIST_INCLUDE_KEY = 'mymeals.blacklist.include';

function loadText(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** Demande au navigateur de ne pas effacer les réglages quand il manque de place (selon le navigateur). */
function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    // pas pris en charge : sans conséquence
  }
}

/** Ce qui remplace la proposition d'un créneau : une idée « Surprise Me » ou un plat de la liste noire. */
interface Override {
  name: string;
  icon: string;
  note: string;
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
  /** Réglages partagés via l'agenda (mode Google seulement). */
  settingsSync?: SettingsSync;
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

function Planner({ store, action, banner, footer, settingsSync }: PlannerProps) {
  const { meals, setSlot, clearSlot, removeMeal } = store;
  const [view, setView] = useView();
  const today = todayIso();
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [editing, setEditing] = useState<Editing | null>(null);
  // Propositions déjà écartées avec ↻, par créneau.
  const [rejected, setRejected] = useState<Record<string, string[]>>({});
  const [randomness, setRandomness] = useState(loadRandomness);
  const [historyMonths, setHistoryMonths] = useState(loadHistoryMonths);
  const [surprisePeriod, setSurprisePeriod] = useState(loadPeriod);
  // Change à chaque ouverture de l'application, pour ne pas revoir le même tirage.
  const [seed] = useState(() => String(Math.random()));
  const [pendingOnly, setPendingOnly] = useState(loadPendingOnly);
  const [slotMode, setSlotMode] = useState(loadSlotMode);
  const activeSlots = useMemo(() => (slotMode === 'both' ? SLOTS : SLOTS.filter((slot) => slot === slotMode)), [slotMode]);
  // Idées « Surprise Me » ou plats de la liste noire affichés à la place de la proposition, par créneau.
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const surprisesShown = useRef(new Set<string>());
  const blacklistShown = useRef(new Set<string>());
  const [flash, setFlash] = useState('');
  const [blacklistText, setBlacklistText] = useState(() => loadText(BLACKLIST_TEXT_KEY));
  const [includeBlacklist, setIncludeBlacklist] = useState(() => loadText(BLACKLIST_INCLUDE_KEY) === '1');
  // Date de la dernière modification des réglages partagés : la plus récente (ici ou dans l'agenda) l'emporte.
  const [stamp, setStamp] = useState(() =>
    loadSettingsStamp(
      loadText(BLACKLIST_TEXT_KEY) !== DEFAULT_SETTINGS.blacklistText ||
        loadText(BLACKLIST_INCLUDE_KEY) === '1' ||
        loadRandomness() !== DEFAULT_SETTINGS.randomness ||
        loadHistoryMonths() !== DEFAULT_SETTINGS.historyMonths ||
        loadPeriod() !== DEFAULT_SETTINGS.surprisePeriod,
    ),
  );
  const touchSettings = () => {
    const now = Date.now();
    setStamp(now);
    saveSettingsStamp(now);
  };
  const { skipped, setSkip } = useSkippedSlots(today);

  const dishes = useMemo(() => buildIndex(meals), [meals]);
  // Réglages partagés : envoyés dans l'agenda quand ils changent ici, repris quand ils sont plus récents là-bas.
  const sharedNow: SharedSettings = { blacklistText, includeBlacklist, randomness, historyMonths, surprisePeriod };
  const sharedRef = useRef(sharedNow);
  sharedRef.current = sharedNow;
  const remoteSettings = settingsSync?.remote;
  const saveRemoteSettings = settingsSync?.save;
  useEffect(() => {
    if (!saveRemoteSettings) return;
    const decision = decideSync(stamp, remoteSettings);
    if (decision === 'adopt-remote' && remoteSettings) {
      const { settings, updatedAt } = remoteSettings;
      setBlacklistText(settings.blacklistText);
      remember(BLACKLIST_TEXT_KEY, settings.blacklistText);
      setIncludeBlacklist(settings.includeBlacklist);
      remember(BLACKLIST_INCLUDE_KEY, settings.includeBlacklist ? '1' : '0');
      setRandomness(settings.randomness);
      remember(RANDOMNESS_KEY, settings.randomness);
      setHistoryMonths(settings.historyMonths);
      remember(HISTORY_KEY, settings.historyMonths);
      setSurprisePeriod(settings.surprisePeriod);
      remember(PERIOD_KEY, settings.surprisePeriod);
      setStamp(updatedAt);
      saveSettingsStamp(updatedAt);
      setRejected({});
      setOverrides({});
      surprisesShown.current.clear();
    } else if (decision === 'push-local') {
      saveRemoteSettings({ updatedAt: stamp, settings: sharedRef.current });
    }
  }, [remoteSettings, saveRemoteSettings, stamp]);

  // Écritures exactes différentes (ce que les fusions de doublons font baisser), puis plats après regroupement automatique.
  const labelCount = useMemo(() => new Set(meals.map((m) => m.name.replace(/\s+/g, ' ').trim())).size, [meals]);
  const blacklist = useMemo(() => parseBlacklist(blacklistText), [blacklistText]);
  const blacklistKeys = useMemo(() => blacklistedKeys(dishes, blacklist), [dishes, blacklist]);
  const blacklistFilter = useMemo<BlacklistFilter>(
    () => ({ matches: blacklist.matches, keys: blacklistKeys, include: includeBlacklist }),
    [blacklist, blacklistKeys, includeBlacklist],
  );
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
      // Seuls les créneaux affichés reçoivent une proposition (les repas déjà prévus comptent partout).
      for (const slot of activeSlots) {
        const key = `${date}|${slot}`;
        if (bySlot.has(key) || skipped.has(key) || !usual.has(`${weekday(date)}-${slot}`)) continue;
        const ranked = suggest(dishes, date, slot, {
          exclude: used,
          weekWords,
          historyMonths,
          blacklist: blacklistKeys,
          includeBlacklist,
        });
        const tried = new Set(rejected[key]);
        // Chaque appui sur ↻ change le tirage : le nombre de propositions déjà écartées entre dans la graine.
        // (on compte les appuis, pas les plats distincts : un même plat peut être écarté deux fois)
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
  }, [days, today, bySlot, usual, dishes, rejected, skipped, randomness, historyMonths, seed, activeSlots, blacklistKeys, includeBlacklist]);

  const sunday = days[6];

  /** Un créneau attend une décision s'il est à venir, vide, non retiré et habituellement rempli. */
  const needsDecision = (date: string, slot: Slot) => {
    const key = `${date}|${slot}`;
    if (date < today || bySlot.has(key) || skipped.has(key)) return false;
    return usual.size === 0 || usual.has(`${weekday(date)}-${slot}`);
  };
  const visibleDays = days
    .map((date) => ({ date, slots: activeSlots.filter((slot) => !pendingOnly || needsDecision(date, slot)) }))
    .filter((day) => day.slots.length > 0);

  function surpriseSlot(key: string, date: string) {
    const ideas = surpriseIdeas(dishes, date, surprisePeriod, today, blacklistFilter);
    let pick = pickSurprise(ideas, surprisesShown.current, randomness);
    if (!pick && ideas.length > 0) {
      surprisesShown.current.clear();
      pick = pickSurprise(ideas, surprisesShown.current, randomness);
    }
    if (!pick) return;
    surprisesShown.current.add(pick.name);
    setOverrides({
      ...overrides,
      [key]: { name: pick.name, icon: '✨', note: ['Idée nouvelle', ...pick.because].join(' · ') },
    });
  }

  /** Bouton spécial : propose, exceptionnellement, un plat de la liste noire (resto, plat à emporter…). */
  function blacklistSlot(key: string, date: string, slot: Slot) {
    const plannedThisWeek = new Set<string>();
    for (const day of days) for (const s of SLOTS) for (const m of bySlot.get(`${day}|${s}`) ?? []) plannedThisWeek.add(normalize(m.name));
    const ranked = suggest(dishes, date, slot, { exclude: plannedThisWeek, blacklist: blacklistKeys, includeBlacklist: true }).filter(
      (s) => s.blacklisted,
    );
    if (ranked.length === 0) {
      setFlash("Aucun plat de la liste noire dans ton historique pour l'instant.");
      return;
    }
    let fresh = ranked.filter((s) => !blacklistShown.current.has(s.key));
    if (fresh.length === 0) {
      blacklistShown.current.clear();
      fresh = ranked;
    }
    const pick = pickProposal(fresh, randomness, `${Math.random()}|bl|${key}`);
    if (!pick) return;
    blacklistShown.current.add(pick.key);
    setFlash('');
    setOverrides({ ...overrides, [key]: { name: pick.label, icon: '🍽️', note: `Liste noire · ${pick.reason}` } });
  }

  function dropOverride(key: string) {
    const { [key]: _dropped, ...rest } = overrides;
    setOverrides(rest);
  }

  return (
    <div className="app">
      <header className="top">
        <h1>MyMeals</h1>
        <div className="top-actions">
          <ThemePicker />
          {action}
        </div>
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
        <DuplicatesPage store={store} dishes={dishes} />
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

      <div className="segmented" role="group" aria-label="Repas affichés">
        {SLOT_MODES.map((mode) => (
          <button
            key={mode.value}
            aria-pressed={slotMode === mode.value}
            onClick={() => {
              setSlotMode(mode.value);
              try {
                localStorage.setItem(SLOT_MODE_KEY, mode.value);
              } catch {
                // le réglage vaudra pour cette session
              }
            }}
          >
            {mode.label}
          </button>
        ))}
      </div>

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
      </div>

      {meals.length > 0 && (
        <details className="advanced">
          <summary>Réglages des propositions</summary>
          <label className="setting">
            Hasard
            <select
              value={randomness}
              onChange={(e) => {
                const level = Number(e.target.value);
                setRandomness(level);
                setRejected({});
                setOverrides({});
                surprisesShown.current.clear();
                remember(RANDOMNESS_KEY, level);
                touchSettings();
              }}
            >
              {RANDOMNESS_LEVELS.map((level, i) => (
                <option key={level.label} value={i}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
          <label className="setting">
            Historique pris en compte
            <select
              value={historyMonths}
              onChange={(e) => {
                const months = Number(e.target.value);
                setHistoryMonths(months);
                setRejected({});
                remember(HISTORY_KEY, months);
                touchSettings();
              }}
            >
              {HISTORY_WINDOWS.map((w) => (
                <option key={w.months} value={w.months}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <label className="setting">
            Goûts pour « Surprise Me »
            <select
              value={surprisePeriod}
              onChange={(e) => {
                const months = Number(e.target.value);
                setSurprisePeriod(months);
                setOverrides({});
                surprisesShown.current.clear();
                remember(PERIOD_KEY, months);
                touchSettings();
              }}
            >
              {PERIODS.map((p) => (
                <option key={p.months} value={p.months}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="switch advanced-switch">
            <input
              type="checkbox"
              checked={includeBlacklist}
              onChange={(e) => {
                setIncludeBlacklist(e.target.checked);
                setRejected({});
                setOverrides({});
                surprisesShown.current.clear();
                remember(BLACKLIST_INCLUDE_KEY, e.target.checked ? '1' : '0');
                touchSettings();
              }}
            />
            <span className="switch-track" aria-hidden="true" />
            Inclure la liste noire (rarement)
          </label>
          <label className="blacklist">
            Liste noire
            <textarea
              value={blacklistText}
              rows={4}
              spellCheck={false}
              autoCapitalize="off"
              placeholder={'kebab\nwafu\n/\\bpho\\b/'}
              onChange={(e) => {
                setBlacklistText(e.target.value);
                setRejected({});
                setOverrides({});
                remember(BLACKLIST_TEXT_KEY, e.target.value);
                requestPersistentStorage();
                touchSettings();
              }}
            />
          </label>
          <p className="blacklist-help">
            Un mot ou une expression par ligne : tous les plats dont le nom <em>contient</em> ce texte sont cachés
            (« kebab » cache aussi « Kebabs frites »). Entoure une ligne de barres pour une expression régulière :{' '}
            <code>/\bpho\b/</code>, <code>/^(sushi|maki)/</code>. Ils ne reviennent que si tu actives l'option ci-dessus
            (alors environ une proposition sur dix), avec le bouton 🍽️ d'une proposition, ou en cherchant leur nom.
          </p>
          {blacklist.invalid.map((entry) => (
            <p key={entry.line} className="dup-error" role="alert">
              Ligne ignorée {entry.line} : {entry.error}
            </p>
          ))}
          {blacklist.entries > 0 && (
            <p className="blacklist-help">
              {blacklistKeys.size === 0
                ? "Aucun plat de ton historique n'est concerné pour l'instant."
                : `${blacklistKeys.size} ${blacklistKeys.size > 1 ? 'plats concernés' : 'plat concerné'} : ${[...blacklistKeys]
                    .slice(0, 8)
                    .map((key) => dishes.byKey.get(key)?.label ?? key)
                    .join(', ')}${blacklistKeys.size > 8 ? '…' : ''}.`}
            </p>
          )}
        </details>
      )}

      {flash && <Notice text={flash} onClose={() => setFlash('')} />}

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
              const override = overrides[key];
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
                        {override ? `${override.icon} ${override.name}` : proposal.label}
                        <small>{override ? override.note : proposal.reason}</small>
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
                          if (override) dropOverride(key);
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
                      {blacklistKeys.size > 0 && (
                        <button
                          className="icon"
                          onClick={() => blacklistSlot(key, date, slot)}
                          aria-label={`Plat de la liste noire pour ${dayName(date)} ${SLOT_LABEL[slot]}`}
                          title="Plat de la liste noire (resto, à emporter…) : exceptionnel"
                        >
                          🍽️
                        </button>
                      )}
                      <button
                        className="icon accept"
                        onClick={() => {
                          setSlot(date, slot, override?.name ?? proposal.label);
                          if (override) dropOverride(key);
                        }}
                        aria-label={`Accepter ${override?.name ?? proposal.label}`}
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
          {meals.length} repas · {labelCount} {labelCount > 1 ? 'libellés' : 'libellé'} · {dishes.dishes.length}{' '}
          {dishes.dishes.length > 1 ? 'plats' : 'plat'} ·{' '}
          {footer}
        </footer>
      )}

      {editing && (
        <SlotSheet
          date={editing.date}
          slot={editing.slot}
          current={bySlot.get(`${editing.date}|${editing.slot}`)}
          suggestions={suggest(dishes, editing.date, editing.slot, { blacklist: blacklistKeys, includeBlacklist: true })}
          includeBlacklist={includeBlacklist}
          blacklistFilter={blacklistFilter}
          dishes={dishes}
          today={today}
          randomness={randomness}
          period={surprisePeriod}
          onPeriodChange={(months) => {
            setSurprisePeriod(months);
            setOverrides({});
            surprisesShown.current.clear();
            remember(PERIOD_KEY, months);
            touchSettings();
          }}
          onRemoveMeal={removeMeal}
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
  includeBlacklist: boolean;
  blacklistFilter: BlacklistFilter;
  onRemoveMeal: (id: string) => void;
  dishes: DishIndex;
  today: string;
  randomness: number;
  period: number;
  onPeriodChange: (months: number) => void;
  skipped: boolean;
  onSkip: (skip: boolean) => void;
  onPick: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
}

function SlotSheet({ date, slot, current, suggestions, includeBlacklist, blacklistFilter, onRemoveMeal, dishes, today, randomness, period, onPeriodChange, skipped, onSkip, onPick, onClear, onClose }: SheetProps) {
  const [query, setQuery] = useState('');
  const [revealed, setRevealed] = useState(false);
  // Chaque mot saisi doit se retrouver dans une des écritures du plat, dans n'importe quel ordre.
  const needles = fold(query).split(/[\s/]+/).filter(Boolean);
  // La liste noire n'apparaît pas d'elle-même : il faut l'option, le bouton ci-dessous, ou chercher un nom précis.
  const showListed = includeBlacklist || revealed || needles.length > 0;
  const listedCount = suggestions.filter((s) => s.blacklisted).length;
  const shown = suggestions
    .filter((s) => (showListed || !s.blacklisted) && needles.every((n) => s.search.includes(n)))
    .slice(0, 30);
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
        {current && current.length === 1 && (
          <p className="current">
            Prévu : <strong>{current[0].name}</strong>
            <button className="link danger" onClick={onClear}>
              Retirer
            </button>
          </p>
        )}
        {current && current.length > 1 && (
          <div className="current">
            <p>
              {current.length} repas sont prévus sur ce créneau. Choisir un plat ci-dessous remplace seulement le premier
              (« {current[0].name} »).
            </p>
            <ul className="current-list">
              {current.map((meal) => (
                <li key={meal.id}>
                  <strong>{meal.name}</strong>
                  <button className="link danger" onClick={() => onRemoveMeal(meal.id)}>
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
            <button className="link danger" onClick={onClear}>
              Tout retirer
            </button>
          </div>
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
        <SurpriseMe date={date} dishes={dishes} today={today} blacklist={blacklistFilter} randomness={randomness} months={period} onMonthsChange={onPeriodChange} onPick={onPick} />
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
                  {s.blacklisted && <small className="tag">liste noire</small>}
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
        {!showListed && listedCount > 0 && (
          <button className="link reveal" onClick={() => setRevealed(true)}>
            Afficher aussi les plats de la liste noire ({listedCount})
          </button>
        )}
      </div>
    </div>
  );
}

interface SurpriseProps {
  date: string;
  dishes: DishIndex;
  today: string;
  blacklist: BlacklistFilter;
  randomness: number;
  /** Période (en mois) sur laquelle sont calculés les goûts ; 0 : tout l'historique. */
  months: number;
  onMonthsChange: (months: number) => void;
  onPick: (name: string) => void;
}

/** Propose un plat absent de l'historique, choisi d'après les goûts de la période réglée. */
function SurpriseMe({ date, dishes, today, blacklist, randomness, months, onMonthsChange, onPick }: SurpriseProps) {
  const [idea, setIdea] = useState<Surprise | null>(null);
  const [opened, setOpened] = useState(false);
  const shown = useRef(new Set<string>());

  function draw(period: number) {
    const ideas = surpriseIdeas(dishes, date, period, today, blacklist);
    let pick = pickSurprise(ideas, shown.current, randomness);
    if (!pick && ideas.length > 0) {
      // Toutes les idées ont été vues : on repart du début.
      shown.current.clear();
      pick = pickSurprise(ideas, shown.current, randomness);
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
            onMonthsChange(period);
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

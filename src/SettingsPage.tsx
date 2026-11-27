import { hiddenImageCount, resetHiddenImages } from './lib/dishImages';
import { useState, type ReactNode } from 'react';
import type { Blacklist } from './lib/blacklist';
import type { CalendarInfo } from './lib/google';
import { MAX_BLACKLIST_CHARS, MAX_FAVORITES_CHARS, MAX_IDEAS_CHARS, type SharedSettings } from './lib/settings';
import { HISTORY_WINDOWS, RANDOMNESS_LEVELS, type DishIndex } from './lib/suggest';
import { PERIODS } from './lib/surprise';
import type { SlotMode, WeekLayout } from './PlanningView';
import { ThemeSettings } from './ThemePicker';

const SLOT_MODES: { value: SlotMode; label: string }[] = [
  { value: 'midi', label: 'Midi' },
  { value: 'soir', label: 'Soir' },
  { value: 'both', label: 'Les deux' },
];

/** Images écartées avec « Pas la bonne image », et de quoi les rétablir. */
function HiddenImages() {
  const [count, setCount] = useState(hiddenImageCount);
  if (count === 0) return null;
  return (
    <>
      {' '}
      {count} {count > 1 ? 'images écartées' : 'image écartée'}.{' '}
      <button
        className="link"
        onClick={() => {
          resetHiddenImages();
          setCount(0);
        }}
      >
        Les rétablir
      </button>
    </>
  );
}

interface SettingsProps {
  shared: SharedSettings;
  update: (patch: Partial<SharedSettings>) => void;
  slotMode: SlotMode;
  setSlotMode: (mode: SlotMode) => void;
  pendingOnly: boolean;
  setPendingOnly: (value: boolean) => void;
  weekLayout: WeekLayout;
  setWeekLayout: (layout: WeekLayout) => void;
  memoAlways: boolean;
  setMemoAlways: (value: boolean) => void;
  memoOnTop: boolean;
  setMemoOnTop: (value: boolean) => void;
  showImages: boolean;
  setShowImages: (value: boolean) => void;
  blacklist: Blacklist;
  blacklistKeys: ReadonlySet<string>;
  favorites: Blacklist;
  favoriteKeys: ReadonlySet<string>;
  dishes: DishIndex;
  ideas: string[];
  /** Idées déjà mangées depuis (elles ne sont plus proposées). */
  eatenIdeas: string[];
  /** Agendas Google (undefined sans Google, null pendant le chargement). */
  calendars?: CalendarInfo[] | null;
  isShown: (calendar: CalendarInfo) => boolean;
  setShown: (calendar: CalendarInfo, shown: boolean) => void;
  reloadCalendars?: () => void;
  account: ReactNode;
}

function Switch({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      {children}
    </label>
  );
}

/** Tous les réglages, regroupés sur une page. */
export function SettingsPage(props: SettingsProps) {
  const { shared, update, blacklist, blacklistKeys, dishes } = props;
  return (
    <div className="settings-page">
      <section>
        <h2>Planning</h2>
        <p className="settings-label">Repas affichés</p>
        <div className="segmented" role="group" aria-label="Repas affichés">
          {SLOT_MODES.map((mode) => (
            <button key={mode.value} aria-pressed={props.slotMode === mode.value} onClick={() => props.setSlotMode(mode.value)}>
              {mode.label}
            </button>
          ))}
        </div>
        <Switch checked={props.pendingOnly} onChange={props.setPendingOnly}>
          À décider seulement (masque les créneaux déjà décidés)
        </Switch>
        <div className="segmented" role="group" aria-label="Semaine sur ordinateur">
          {(
            [
              ['columns', 'Colonnes'],
              ['list', 'Liste'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} aria-pressed={props.weekLayout === value} onClick={() => props.setWeekLayout(value)}>
              {label}
            </button>
          ))}
        </div>
        <p className="blacklist-help">Sur ordinateur : la semaine en sept colonnes, ou en liste verticale comme sur téléphone.</p>
        <Switch checked={props.showImages} onChange={props.setShowImages}>
          Images des plats (Wikipédia)
        </Switch>
        <p className="blacklist-help">
          Une photo trouvée sur Wikipédia à côté des plats prévus et proposés, sans aucune IA : seul le nom du plat est envoyé
          à Wikipédia, une fois par plat. Réglage propre à cet appareil.
          {props.showImages && <HiddenImages />}
        </p>
      </section>

      <section>
        <h2>Fridge memo</h2>
        <Switch checked={props.memoAlways} onChange={props.setMemoAlways}>
          Toujours afficher les mémos sur le planning
        </Switch>
        <p className="blacklist-help">
          Les mémos restent sous les yeux en haut du planning (on y écrit, modifie et supprime directement), sans ouvrir la
          fenêtre. Le bouton « Fridge memo » reste disponible. Réglage propre à cet appareil.
        </p>
        <div className="segmented" role="group" aria-label="Position de la fenêtre du Fridge memo">
          <button aria-pressed={props.memoOnTop} onClick={() => props.setMemoOnTop(true)}>
            En haut de l'écran
          </button>
          <button aria-pressed={!props.memoOnTop} onClick={() => props.setMemoOnTop(false)}>
            En bas de l'écran
          </button>
        </div>
        <p className="blacklist-help">
          Où s'ouvre la fenêtre du Fridge memo (le bouton en haut de page) : collée en haut de l'écran, ou en bas (par défaut). Réglage propre à cet appareil.
        </p>
      </section>

      <section>
        <h2>Propositions</h2>
        <Switch checked={shared.useRatings} onChange={(value) => update({ useRatings: value })}>
          Tenir compte des notes des plats
        </Switch>
        <p className="blacklist-help">
          Un plat bien noté revient un peu plus souvent (jusqu'à ×1,6 pour 5/5), un plat mal noté un peu moins (×0,6 pour
          1/5) ; sans note, rien ne change. La moyenne des notes de chacun compte. Réglage partagé.
        </p>
        <label className="setting">
          Hasard
          <select value={shared.randomness} onChange={(e) => update({ randomness: Number(e.target.value) })}>
            {RANDOMNESS_LEVELS.map((level, i) => (
              <option key={level.label} value={i}>
                {level.label}
              </option>
            ))}
          </select>
        </label>
        <label className="setting">
          Historique pris en compte
          <select value={shared.historyMonths} onChange={(e) => update({ historyMonths: Number(e.target.value) })}>
            {HISTORY_WINDOWS.map((w) => (
              <option key={w.months} value={w.months}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label className="setting">
          Goûts pour « Surprise Me »
          <select value={shared.surprisePeriod} onChange={(e) => update({ surprisePeriod: Number(e.target.value) })}>
            {PERIODS.map((p) => (
              <option key={p.months} value={p.months}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <h2>Liste noire</h2>
        <Switch checked={shared.includeBlacklist} onChange={(value) => update({ includeBlacklist: value })}>
          Inclure la liste noire (rarement)
        </Switch>
        <label className="blacklist">
          Plats à ne pas proposer
          <textarea
            value={shared.blacklistText}
            rows={4}
            maxLength={MAX_BLACKLIST_CHARS}
            spellCheck={false}
            autoCapitalize="off"
            placeholder={'kebab\nwafu\n/\\bpho\\b/'}
            onChange={(e) => update({ blacklistText: e.target.value })}
          />
        </label>
        <p className="blacklist-help">
          Un mot ou une expression par ligne : tous les plats dont le nom <em>contient</em> ce texte sont cachés (« kebab » cache
          aussi « Kebabs frites »). Entoure une ligne de barres pour une expression régulière : <code>/\bpho\b/</code>,{' '}
          <code>/^(sushi|maki)/</code>. Le menu ⋯ d'une proposition permet aussi d'ajouter un plat d'un geste. Ces plats ne
          reviennent qu'avec l'option ci-dessus (environ une proposition sur dix), par le menu ⋯ (« Un plat de la liste noire »),
          ou en cherchant leur nom.
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
      </section>

      <section>
        <h2>Favoris</h2>
        <label className="blacklist">
          Plats à proposer plus souvent
          <textarea
            value={shared.favoritesText}
            rows={3}
            maxLength={MAX_FAVORITES_CHARS}
            spellCheck={false}
            autoCapitalize="off"
            placeholder={'lasagnes\nblanquette de veau'}
            onChange={(e) => update({ favoritesText: e.target.value })}
          />
        </label>
        <p className="blacklist-help">
          Même écriture que la liste noire (un mot par ligne, ou <code>/motif/</code>), mais à l'envers : ces plats comptent
          deux fois et demie plus dans les propositions. Le plus simple : l'étoile ☆ dans la fenêtre d'un repas, ou « Ajouter
          aux favoris » dans le menu ⋯ d'une proposition.
        </p>
        {props.favorites.invalid.map((entry) => (
          <p key={entry.line} className="dup-error" role="alert">
            Ligne ignorée {entry.line} : {entry.error}
          </p>
        ))}
        {props.favorites.entries > 0 && (
          <p className="blacklist-help">
            {props.favoriteKeys.size === 0
              ? "Aucun plat de ton historique n'est concerné pour l'instant."
              : `${props.favoriteKeys.size} ${props.favoriteKeys.size > 1 ? 'plats favoris' : 'plat favori'} : ${[...props.favoriteKeys]
                  .slice(0, 8)
                  .map((key) => dishes.byKey.get(key)?.label ?? key)
                  .join(', ')}${props.favoriteKeys.size > 8 ? '…' : ''}.`}
          </p>
        )}
      </section>

      <section>
        <h2>Mes idées</h2>
        <label className="blacklist">
          Plats à essayer, un par ligne
          <textarea
            value={shared.ideasText}
            rows={5}
            maxLength={MAX_IDEAS_CHARS}
            placeholder={'risotto aux asperges\npoulet yassa\nsoupe pho maison'}
            onChange={(e) => update({ ideasText: e.target.value })}
          />
        </label>
        <p className="blacklist-help">
          « Surprise Me » les propose avec les idées du catalogue, un peu plus souvent. Une idée disparaît d'elle-même dès qu'elle
          apparaît dans tes repas.
          {props.ideas.length > 0 && (
            <>
              {' '}
              {props.ideas.length} {props.ideas.length > 1 ? 'idées' : 'idée'}
              {props.eatenIdeas.length > 0 && <>, dont {props.eatenIdeas.length} déjà mangée{props.eatenIdeas.length > 1 ? 's' : ''} : {props.eatenIdeas.slice(0, 5).join(', ')}</>}.
            </>
          )}
        </p>
      </section>

      <section>
        <h2>Heures des repas</h2>
        <div className="times">
          <label className="setting">
            Midi
            <input type="time" step={900} value={shared.lunchTime} onChange={(e) => e.target.value && update({ lunchTime: e.target.value })} />
          </label>
          <label className="setting">
            Soir
            <input type="time" step={900} value={shared.dinnerTime} onChange={(e) => e.target.value && update({ dinnerTime: e.target.value })} />
          </label>
        </div>
        <p className="blacklist-help">
          Heure des repas ajoutés depuis l'application (ils durent une heure), et repère pour les événements de tes autres
          agendas : une heure avant le repas, jusqu'à deux heures après (deux heures et demie le soir).
        </p>
      </section>

      {props.calendars !== undefined && (
        <section>
          <h2>Autres agendas</h2>
          <p className="blacklist-help">
            Les événements de ces agendas qui tombent pendant un repas s'affichent à côté du créneau, à titre d'information. Rien
            n'est modifié dans ces agendas.
          </p>
          {props.calendars === null ? (
            <p className="blacklist-help">Chargement de la liste…</p>
          ) : (
            <ul className="calendar-list">
              {props.calendars.map((calendar) => (
                <li key={calendar.id}>
                  <label className="approx-candidate">
                    <input type="checkbox" checked={props.isShown(calendar)} onChange={(e) => props.setShown(calendar, e.target.checked)} />
                    <span className="dot" style={calendar.color ? { background: calendar.color } : undefined} aria-hidden="true" />
                    <span className="dup-label">{calendar.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {props.reloadCalendars && (
            <button className="link" onClick={props.reloadCalendars}>
              Recharger la liste des agendas
            </button>
          )}
        </section>
      )}

      <section>
        <h2>Couleur de fond</h2>
        <ThemeSettings />
      </section>

      <section>
        <h2>Compte</h2>
        <div className="account">{props.account}</div>
      </section>
    </div>
  );
}

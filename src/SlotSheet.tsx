import { useEffect, useRef, useState } from 'react';
import type { BlacklistFilter } from './lib/blacklist';
import { dayName, shortDate } from './lib/dates';
import { DishPicture } from './DishThumb';
import { Icon, type IconName } from './Icons';
import { MAX_NOTE_CHARS, dishKeyOf, splitLinks, type PastNote } from './lib/notes';
import { clock, type OtherEvent } from './lib/otherCalendars';
import { fold, normalize, type DishIndex, type Suggestion } from './lib/suggest';
import { PERIODS, pickSurprise, surpriseIdeas, type Surprise } from './lib/surprise';
import type { Meal, Slot } from './lib/types';

export const SLOT_LABEL: Record<Slot, string> = { midi: 'Midi', soir: 'Soir' };

/** Ce qui est proposé pour le créneau au moment d'ouvrir la fenêtre. */
export interface ShownProposal {
  name: string;
  note: string;
}

interface SheetProps {
  date: string;
  slot: Slot;
  current: Meal[] | undefined;
  proposal?: ShownProposal;
  others?: OtherEvent[];
  suggestions: Suggestion[];
  includeBlacklist: boolean;
  blacklistFilter: BlacklistFilter;
  ideas: string[];
  onRemoveMeal: (id: string) => void;
  /** Une autre proposition pour ce créneau (↻). */
  onNextProposal: () => void;
  /** Remplace ce repas prévu par un autre plat tiré au hasard (↻). */
  onRerollMeal: (meal: Meal) => void;
  /** Renomme ce repas prévu. */
  onRename: (meal: Meal, name: string) => void;
  showImages: boolean;
  isFavorite: (name: string) => boolean;
  onToggleFavorite: (name: string) => void;
  isBlacklisted: (name: string) => boolean;
  onToggleBlacklist: (name: string) => void;
  notes: Map<string, PastNote[]>;
  onSetNote: (id: string, note: string) => void;
  dishes: DishIndex;
  today: string;
  randomness: number;
  period: number;
  onPeriodChange: (months: number) => void;
  skipped: boolean;
  onSkip: (skip: boolean) => void;
  onPick: (name: string) => void;
  /** Ajoute le plat au créneau sans remplacer ceux qui y sont déjà. */
  onAdd: (name: string) => void;
  /** Ouvre le choix d'un autre créneau pour la proposition. */
  onAcceptElsewhere: (name: string) => void;
  /** Ouvre le choix d'un créneau où déplacer ce repas. */
  onMove: (meal: Meal) => void;
  onClear: () => void;
  onClose: () => void;
}

/** Les autres écritures d'un plat, sur une seule ligne. */
function variantsLine(variants: string[]): string {
  const shown = variants.slice(0, 2).join(', ');
  return variants.length > 2 ? `${shown} +${variants.length - 2}` : shown;
}

/** Fenêtre d'un créneau : ce qui est prévu, la proposition, la recherche d'un plat et « Surprise Me ». */
export function SlotSheet(sheetProps: SheetProps) {
  // Créneau déjà rempli : le plat choisi remplace le premier, ou s'ajoute (un repas de plus).
  const [adding, setAdding] = useState(false);
  const props: SheetProps = adding ? { ...sheetProps, onPick: sheetProps.onAdd } : sheetProps;
  const { date, slot, current, proposal, others, suggestions, includeBlacklist, onRemoveMeal, skipped, onSkip, onPick, onClear, onClose } = props;
  // Nom de la proposition en cours de modification (null : telle quelle) ; une autre proposition le remet à zéro.
  const [draftName, setDraftName] = useState<string | null>(null);
  useEffect(() => setDraftName(null), [proposal?.name]);
  const chosenName = (draftName ?? proposal?.name ?? '').trim();
  const [query, setQuery] = useState('');
  const [revealed, setRevealed] = useState(false);

  // Échap ferme la fenêtre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        {others && others.length > 0 && <OtherEvents events={others} />}
        {current && current.length > 1 && (
          <p className="current">
            {current.length} repas sont prévus sur ce créneau. Choisir un plat ci-dessous remplace seulement le premier
            (« {current[0].name} »).
          </p>
        )}
        {current?.map((meal) => (
          <MealCard key={meal.id} meal={meal} onRemove={() => (current.length === 1 ? onClear() : onRemoveMeal(meal.id))} {...props} />
        ))}
        {current && current.length > 1 && (
          <div className="act-row">
            <Act icon="trash" tone="danger" onClick={onClear}>
              Tout retirer
            </Act>
          </div>
        )}
        {!current && proposal && (
          <>
            <div className="sheet-proposal">
              <div className="sp-main">
                <small className="eyebrow">Proposition</small>
                {draftName === null ? (
                  <h3>{proposal.name}</h3>
                ) : (
                  <input
                    className="proposal-edit"
                    type="text"
                    value={draftName}
                    autoFocus
                    aria-label="Nom du plat"
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && chosenName) onPick(chosenName);
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setDraftName(null);
                      }
                    }}
                  />
                )}
                <small>{proposal.note}</small>
              </div>
              <FavoriteButton name={chosenName || proposal.name} {...props} />
            </div>
            <button className="ghost-btn primary choose" disabled={!chosenName} onClick={() => onPick(chosenName)}>
              <Icon name="check" />
              Choisir ce plat
            </button>
            <div className="act-row">
              <Act icon="refresh" onClick={props.onNextProposal}>
                Autre proposition
              </Act>
              <Act icon="pencil" pressed={draftName !== null} onClick={() => setDraftName(draftName === null ? proposal.name : null)}>
                {draftName === null ? 'Modifier le nom' : 'Annuler la modification'}
              </Act>
              <Act icon="calendar" onClick={() => props.onAcceptElsewhere(chosenName || proposal.name)}>
                Autre créneau
              </Act>
              <BlacklistButton
                name={proposal.name}
                isBlacklisted={props.isBlacklisted}
                onToggleBlacklist={(name) => {
                  // La proposition va changer : la fenêtre se ferme.
                  props.onToggleBlacklist(name);
                  onClose();
                }}
              />
            </div>
            <DishPicture name={proposal.name} enabled={props.showImages} />
            <PastNotes list={props.notes.get(dishKeyOf(proposal.name, props.dishes)) ?? []} />
          </>
        )}
        {!current && (
          <div className="act-row">
            <Act icon="minus" pressed={skipped} onClick={() => onSkip(!skipped)}>
              {skipped ? 'Remettre ce créneau' : `Pas de repas ce ${SLOT_LABEL[slot].toLowerCase()}`}
            </Act>
          </div>
        )}
        {current && (
          <div className="segmented pick-mode" role="group" aria-label="Le plat choisi ci-dessous">
            <button aria-pressed={!adding} onClick={() => setAdding(false)} title={`Le plat choisi remplace « ${current[0].name} »`}>
              Remplacer
            </button>
            <button aria-pressed={adding} onClick={() => setAdding(true)} title="Le plat choisi s'ajoute à ce créneau">
              + Ajouter un plat
            </button>
          </div>
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
        <SurpriseMe {...props} />
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
                  {s.favorite && <small className="tag fav">⭐</small>}
                  {s.blacklisted && <small className="tag">liste noire</small>}
                  {s.variants.length > 0 && <small className="variants">aussi écrit : {variantsLine(s.variants)}</small>}
                </span>
                <small>{s.reason}</small>
              </button>
            </li>
          ))}
          {shown.length === 0 && !query.trim() && <li className="hint">Pas encore d'historique : saisis un plat ci-dessus.</li>}
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

/** Bouton d'action en pastille : une icône et un libellé. */
function Act({ icon, children, onClick, tone, disabled, title, pressed, small }: { icon: IconName; children: React.ReactNode; onClick: () => void; tone?: 'danger'; disabled?: boolean; title?: string; pressed?: boolean; small?: boolean }) {
  return (
    <button className={`act${tone ? ` ${tone}` : ''}${small ? ' sm' : ''}`} onClick={onClick} disabled={disabled} title={title} aria-pressed={pressed}>
      <Icon name={icon} />
      {children}
    </button>
  );
}

/** Étoile qui ajoute un plat aux favoris ou l'en retire. */
function FavoriteButton({ name, isFavorite, onToggleFavorite }: { name: string } & Pick<SheetProps, 'isFavorite' | 'onToggleFavorite'>) {
  const on = isFavorite(name);
  return (
    <button
      className={`star-btn${on ? ' on' : ''}`}
      onClick={() => onToggleFavorite(name)}
      aria-pressed={on}
      aria-label={on ? `Retirer « ${name} » des favoris` : `Ajouter « ${name} » aux favoris`}
      title={on ? 'Favori (proposé plus souvent)' : 'Ajouter aux favoris'}
    >
      <Icon name="star" filled={on} />
    </button>
  );
}

/** Ajoute le plat à la liste noire, ou l'en retire. */
function BlacklistButton({ name, isBlacklisted, onToggleBlacklist }: { name: string } & Pick<SheetProps, 'isBlacklisted' | 'onToggleBlacklist'>) {
  const on = isBlacklisted(name);
  return (
    <Act
      icon="ban"
      tone={on ? undefined : 'danger'}
      pressed={on}
      onClick={() => onToggleBlacklist(name)}
      title={on ? 'Ce plat est sur la liste noire : touche pour le retirer' : 'Ne plus jamais proposer ce plat'}
    >
      {on ? 'Sur la liste noire' : 'Liste noire'}
    </Act>
  );
}

/** Texte d'une note, avec ses liens cliquables. */
export function NoteText({ note }: { note: string }) {
  return (
    <span className="note-text">
      {splitLinks(note).map((part, i) =>
        part.href ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}

/** Un repas prévu : son nom, l'étoile des favoris, sa note (modifiable) et celles des fois précédentes. */
function MealCard(props: SheetProps & { meal: Meal; onRemove: () => void }) {
  const { meal, onRemove, onSetNote, notes, dishes } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meal.note ?? '');
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(meal.name);
  const pending = meal.id.startsWith('tmp-');
  const past = (notes.get(dishKeyOf(meal.name, dishes)) ?? []).filter((n) => n.id !== meal.id);

  function saveName() {
    props.onRename(meal, nameDraft);
    setRenaming(false);
  }

  function startEditing() {
    setDraft(meal.note ?? '');
    setEditing(true);
  }

  function save() {
    onSetNote(meal.id, draft);
    setEditing(false);
  }

  return (
    <div className="meal-card">
      <div className="meal-head">
        <div className="sp-main">
          <small className="eyebrow">Prévu</small>
          <h3>{meal.name}</h3>
        </div>
        <FavoriteButton name={meal.name} {...props} />
      </div>
      <DishPicture name={meal.name} enabled={props.showImages} />
      <div className="act-row">
        <Act icon="refresh" disabled={pending} onClick={() => props.onRerollMeal(meal)} title="Remplacer par un autre plat tiré au hasard">
          Autre plat
        </Act>
        <Act icon="calendar" disabled={pending} onClick={() => props.onMove(meal)} title="Déplacer ce repas vers un autre jour ou créneau">
          Déplacer
        </Act>
        <Act
          icon="pencil"
          disabled={pending}
          pressed={renaming}
          onClick={() => {
            setNameDraft(meal.name);
            setRenaming(!renaming);
          }}
        >
          Renommer
        </Act>
        <Act icon="note" disabled={pending} pressed={editing} onClick={editing ? () => setEditing(false) : startEditing} title={pending ? "En cours d'enregistrement dans l'agenda" : undefined}>
          {meal.note ? 'Modifier la note' : 'Ajouter une note'}
        </Act>
        <BlacklistButton name={meal.name} {...props} />
        <Act icon="trash" tone="danger" onClick={onRemove}>
          Retirer
        </Act>
      </div>
      {renaming && (
        <div className="note-edit">
          <input
            className="proposal-edit"
            type="text"
            value={nameDraft}
            autoFocus
            aria-label={`Nouveau nom pour ${meal.name}`}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setRenaming(false);
              }
            }}
          />
          <div className="note-actions">
            <button className="ghost-btn primary" onClick={saveName} disabled={!nameDraft.trim()}>
              Enregistrer
            </button>
            <button className="ghost-btn" onClick={() => setRenaming(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
      {editing ? (
        <div className="note-edit">
          <textarea
            value={draft}
            rows={3}
            maxLength={MAX_NOTE_CHARS}
            autoFocus
            placeholder="Lien de la recette, « trop salé », « les enfants ont adoré »…"
            aria-label={`Note pour ${meal.name}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            }}
          />
          <div className="note-actions">
            <button className="ghost-btn primary" onClick={save}>
              Enregistrer
            </button>
            <button
              className="ghost-btn"
              onClick={() => {
                setDraft(meal.note ?? '');
                setEditing(false);
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : (
        meal.note && (
          <div className="note">
            <Icon name="note" />
            <NoteText note={meal.note} />
          </div>
        )
      )}
      <PastNotes list={past} />
    </div>
  );
}

/** Notes laissées les fois précédentes sur le même plat. */
function PastNotes({ list }: { list: PastNote[] }) {
  if (list.length === 0) return null;
  return (
    <details className="past-notes" open={list.length <= 2}>
      <summary>
        {list.length === 1 ? 'Note de la fois précédente' : `Notes des fois précédentes (${list.length})`}
      </summary>
      <ul>
        {list.slice(0, 10).map((n) => (
          <li key={n.id}>
            <small>
              {shortDate(n.date)} {n.date.slice(0, 4)}
              {n.name !== list[0].name ? ` · ${n.name}` : ''}
            </small>
            <NoteText note={n.note} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Événements des autres agendas au même moment, à titre d'information. */
export function OtherEvents({ events, compact }: { events: OtherEvent[]; compact?: boolean }) {
  return (
    <ul className={`others${compact ? ' compact' : ''}`} aria-label="Dans tes autres agendas">
      {events.map((event) => (
        <li key={`${event.calendarName}|${event.id}`} title={`${event.title} · ${event.calendarName}`}>
          <span className="dot" style={event.color ? { background: event.color } : undefined} aria-hidden="true" />
          <span className="others-text">
            {clock(event.start)} {event.title}
            {!compact && <small> · {event.calendarName}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Propose un plat absent de l'historique (catalogue ou « Mes idées »), d'après les goûts de la période réglée. */
function SurpriseMe({ date, dishes, today, blacklistFilter, ideas, randomness, period, onPeriodChange, onPick }: SheetProps) {
  const [idea, setIdea] = useState<Surprise | null>(null);
  const [opened, setOpened] = useState(false);
  const shown = useRef(new Set<string>());

  function draw(months: number) {
    const list = surpriseIdeas(dishes, date, months, today, blacklistFilter, ideas);
    let pick = pickSurprise(list, shown.current, randomness);
    if (!pick && list.length > 0) {
      // Toutes les idées ont été vues : on repart du début.
      shown.current.clear();
      pick = pickSurprise(list, shown.current, randomness);
    }
    if (pick) shown.current.add(pick.name);
    setIdea(pick);
    setOpened(true);
  }

  if (!opened) {
    return (
      <button className="surprise-btn" onClick={() => draw(period)}>
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
            {idea.own ? 'Dans « Mes idées », jamais noté dans tes repas. ' : 'Jamais noté dans tes repas. '}
            {idea.because.length > 0
              ? `Proche de tes goûts récents : ${idea.because.join(' et ')}.`
              : 'Pas assez de repas sur cette période pour cerner tes goûts.'}
          </p>
          <div className="surprise-actions">
            <button className="ghost-btn primary" onClick={() => onPick(idea.name)}>
              Choisir
            </button>
            <button className="ghost-btn" onClick={() => draw(period)}>
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
        <p className="surprise-why">Tu connais déjà tous les plats de mon catalogue et de tes idées.</p>
      )}
      <label className="surprise-period">
        D'après mes repas des
        <select
          value={period}
          onChange={(e) => {
            const months = Number(e.target.value);
            onPeriodChange(months);
            shown.current.clear();
            draw(months);
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

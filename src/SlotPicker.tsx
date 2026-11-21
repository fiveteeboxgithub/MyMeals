import { useEffect, useState } from 'react';
import { addDays, dayName, shortDate, tinyDate } from './lib/dates';
import { SLOTS, type Meal, type Slot } from './lib/types';
import { SLOT_LABEL } from './SlotSheet';
import { useScrollLock } from './useScrollLock';

/** Nombre de jours proposés d'emblée (à partir d'aujourd'hui) ; « Autre date » pour aller plus loin. */
const DAYS_SHOWN = 14;

interface PickerProps {
  title: string;
  /** Ce qu'on place (affiché sous le titre). */
  name: string;
  today: string;
  bySlot: Map<string, Meal[]>;
  skipped: ReadonlySet<string>;
  /** Créneau d'origine, qu'on ne propose pas. */
  from?: string;
  onPick: (date: string, slot: Slot) => void;
  onClose: () => void;
}

/**
 * Choix d'un créneau : les deux semaines qui viennent, jour par jour, avec Midi et Soir et ce qui y est déjà
 * prévu. Jamais avant aujourd'hui ; « Autre date » ouvre un calendrier pour une date plus lointaine.
 */
export function SlotPicker({ title, name, today, bySlot, skipped, from, onPick, onClose }: PickerProps) {
  useScrollLock();
  const [extra, setExtra] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(today, i));
  if (extra && extra >= today && !days.includes(extra)) days.push(extra);

  return (
    <div className="backdrop picker-backdrop" onClick={onClose}>
      <div className="sheet picker" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>
            {title}
            <small>{name}</small>
          </h2>
          <button className="icon" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <p className="picker-help">Un créneau déjà pris garde son plat : celui-ci s'y ajoute.</p>
        <ul className="picker-days">
          {days.map((date) => (
            <li key={date} className={date === extra ? 'picked-extra' : undefined}>
              <span className="picker-day">
                {date === today ? "Aujourd'hui" : date === addDays(today, 1) ? 'Demain' : dayName(date)}
                <small>{date === extra ? `${shortDate(date)} ${date.slice(0, 4)}` : tinyDate(date)}</small>
              </span>
              {SLOTS.map((slot) => {
                const key = `${date}|${slot}`;
                const planned = bySlot.get(key);
                const isFrom = key === from;
                return (
                  <button
                    key={slot}
                    className={`picker-slot${planned ? ' taken' : ''}`}
                    disabled={isFrom}
                    onClick={() => onPick(date, slot)}
                    aria-label={`${dayName(date)} ${shortDate(date)}, ${SLOT_LABEL[slot]}${planned ? `, déjà : ${planned.map((m) => m.name).join(', ')}` : ''}`}
                  >
                    <span>{SLOT_LABEL[slot]}</span>
                    <small>
                      {isFrom ? 'ici' : planned ? planned.map((m) => m.name).join(' + ') : skipped.has(key) ? 'pas de repas' : 'libre'}
                    </small>
                  </button>
                );
              })}
            </li>
          ))}
        </ul>
        <label className="picker-other">
          Autre date
          <input type="date" min={today} value={extra} onChange={(e) => setExtra(e.target.value >= today ? e.target.value : '')} />
        </label>
      </div>
    </div>
  );
}

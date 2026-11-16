import { describe, expect, it } from 'vitest';
import { addDays, mondayOf, weekday } from './dates';
import { parseIcs } from './ics';
import { buildIndex, normalize, suggest, usualSlots } from './suggest';
import type { Meal, Slot } from './types';

function meal(date: string, slot: Slot, name: string): Meal {
  return { id: `${date}-${slot}-${name}`, date, slot, name, source: 'import' };
}

describe('dates', () => {
  it('compte les jours de la semaine à partir du lundi', () => {
    expect(weekday('2026-11-16')).toBe(0); // lundi
    expect(weekday('2026-11-22')).toBe(6); // dimanche
    expect(mondayOf('2026-11-19')).toBe('2026-11-16');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('parseIcs', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'X-WR-CALNAME:Repas',
    'X-WR-TIMEZONE:Europe/Paris',
    'BEGIN:VEVENT',
    'DTSTART:20150101T120000Z',
    'UID:a@google.com',
    'SUMMARY:soupe nouilles',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART:20260718T183000Z',
    'UID:b@google.com',
    'SUMMARY:saucisses\\, purée et un très long titre replié sur deux li',
    ' gnes',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;TZID=Europe/Paris:20261108T130000',
    'UID:c@google.com',
    'SUMMARY:tartiflette',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART:20261231T230000Z',
    'UID:d@google.com',
    'SUMMARY:réveillon',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261225',
    'UID:e@google.com',
    'SUMMARY:noël',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART:20261109T190000Z',
    'UID:f@google.com',
    'STATUS:CANCELLED',
    'SUMMARY:annulé',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const meals = parseIcs(ics);

  it('convertit les heures UTC dans le fuseau de l’agenda', () => {
    expect(meals[0]).toMatchObject({ id: 'a@google.com', date: '2015-01-01', slot: 'midi', name: 'soupe nouilles' });
    // 18h30 UTC en été = 20h30 à Paris
    expect(meals[1]).toMatchObject({ date: '2026-07-18', slot: 'soir' });
    // 23h UTC le 31 décembre = minuit le 1er janvier à Paris
    expect(meals[3]).toMatchObject({ date: '2027-01-01', slot: 'midi' });
  });

  it('déplie les lignes et retire les échappements', () => {
    expect(meals[1].name).toBe('saucisses, purée et un très long titre replié sur deux lignes');
  });

  it('gère les heures locales, les journées entières et les annulations', () => {
    expect(meals[2]).toMatchObject({ date: '2026-11-08', slot: 'midi' });
    expect(meals[4]).toMatchObject({ date: '2026-12-25', slot: 'soir' });
    expect(meals).toHaveLength(5);
  });
});

describe('suggest', () => {
  it('regroupe les variantes d’écriture', () => {
    expect(normalize(' Poisson / Purée ')).toBe('poisson/puree');
    const dishes = buildIndex([
      meal('2026-01-01', 'soir', 'poisson/purée'),
      meal('2026-02-01', 'soir', 'poisson/purée'),
      meal('2026-03-01', 'soir', 'Poisson / puree'),
    ]);
    expect(dishes.size).toBe(1);
    expect(dishes.get('poisson/puree')!.label).toBe('poisson/purée');
  });

  it('préfère les plats de saison et écarte ceux mangés récemment', () => {
    const history: Meal[] = [];
    for (const year of [2023, 2024, 2025]) {
      history.push(meal(`${year}-11-10`, 'soir', 'tartiflette'));
      history.push(meal(`${year}-12-05`, 'soir', 'tartiflette'));
      history.push(meal(`${year}-07-10`, 'soir', 'salade niçoise'));
      history.push(meal(`${year}-07-25`, 'soir', 'salade niçoise'));
    }
    const dishes = buildIndex(history);
    expect(suggest(dishes, '2026-11-18', 'soir')[0].label).toBe('tartiflette');
    expect(suggest(dishes, '2026-07-15', 'soir')[0].label).toBe('salade niçoise');

    const withRecent = buildIndex([...history, meal('2026-11-15', 'soir', 'tartiflette')]);
    const ranked = suggest(withRecent, '2026-11-18', 'soir');
    expect(ranked[0].label).toBe('salade niçoise');
    expect(ranked[0].reason).toContain('6 fois');
  });

  it('tient compte du créneau et ignore les plats exclus', () => {
    const dishes = buildIndex([
      meal('2026-10-03', 'midi', 'poke bowl'),
      meal('2026-10-10', 'midi', 'poke bowl'),
      meal('2026-10-04', 'soir', 'soupe'),
      meal('2026-10-11', 'soir', 'soupe'),
    ]);
    expect(suggest(dishes, '2026-11-21', 'midi')[0].label).toBe('poke bowl');
    expect(suggest(dishes, '2026-11-21', 'soir')[0].label).toBe('soupe');
    expect(suggest(dishes, '2026-11-21', 'soir', new Set(['soupe']))[0].label).toBe('poke bowl');
  });

  it('ne propose les restes que le jour où ils reviennent', () => {
    const history: Meal[] = [];
    for (let week = 0; week < 8; week++) {
      history.push(meal(addDays('2026-09-06', week * 7), 'soir', 'restes')); // dimanches
      history.push(meal(addDays('2026-09-01', week * 7), 'soir', 'pizzas')); // mardis
    }
    const dishes = buildIndex(history);
    expect(suggest(dishes, '2026-11-22', 'soir', new Set(), '2026-11-16')[0].label).toBe('restes');
    const wednesday = suggest(dishes, '2026-11-18', 'soir', new Set(), '2026-11-16');
    expect(wednesday.map((s) => s.label)).toEqual(['pizzas']);
    expect(wednesday[0].reason).toBe('8 fois · il y a 4 semaines');
  });

  it('repère les créneaux habituellement remplis', () => {
    const history: Meal[] = [];
    for (let week = 0; week < 20; week++) {
      const monday = addDays('2026-06-01', week * 7);
      for (let d = 0; d < 7; d++) history.push(meal(addDays(monday, d), 'soir', 'plat'));
      history.push(meal(addDays(monday, 5), 'midi', 'plat'));
    }
    const usual = usualSlots(history, '2026-11-16');
    expect(usual.has('0-soir')).toBe(true);
    expect(usual.has('5-midi')).toBe(true);
    expect(usual.has('0-midi')).toBe(false);
  });
});

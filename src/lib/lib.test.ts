import { describe, expect, it } from 'vitest';
import { addDays, mondayOf, weekday } from './dates';
import { parseIcs } from './ics';
import { buildIndex, isTypoOf, normalize, suggest, usualSlots } from './suggest';
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
    expect(dishes.dishes).toHaveLength(1);
    expect(dishes.byKey.get('poisson/puree')!.label).toBe('poisson/purée');
  });

  it('ignore l’ordre, les pluriels et les fautes de frappe', () => {
    expect(normalize('Pâtes et saumon')).toBe(normalize('saumon/pates'));
    expect(normalize('poissons panés / purée')).toBe(normalize('poisson pané/purée'));
    expect(isTypoOf('macdo', 'mcdo')).toBe(true);
    expect(isTypoOf('kebbab', 'kebab')).toBe(true);
    expect(isTypoOf('steack', 'staeck')).toBe(true);
    expect(isTypoOf('oeuf/epinard', 'boeuf/epinard')).toBe(false);
    expect(isTypoOf('pate/thon', 'pate/thym')).toBe(false);
    expect(isTypoOf('riz', 'ris')).toBe(false);

    const index = buildIndex([
      meal('2026-01-03', 'midi', 'mac do'),
      meal('2026-02-07', 'midi', 'mac do'),
      meal('2026-03-07', 'midi', 'mc do'),
      meal('2026-04-04', 'midi', 'Mac Do'),
      meal('2026-01-10', 'soir', 'saumon/pates'),
      meal('2026-02-10', 'soir', 'pates/saumon'),
      meal('2026-03-10', 'soir', 'pizza'),
      meal('2026-04-10', 'soir', 'pizzas'),
    ]);
    expect(index.dishes.map((d) => d.label).sort()).toEqual(['mac do', 'pizza', 'saumon/pates']);
    const macdo = index.byKey.get(normalize('mc do'))!;
    expect(macdo.occurrences).toHaveLength(4);
    expect(macdo.variants).toEqual(['mc do']);
  });

  it('attend plus longtemps pour un plat qui revient rarement', () => {
    const history: Meal[] = [];
    // « raclette » tous les 2 mois, « poisson » toutes les semaines, même jour.
    for (let i = 0; i < 12; i++) history.push(meal(addDays('2024-10-01', i * 60), 'soir', 'raclette'));
    for (let i = 0; i < 100; i++) history.push(meal(addDays('2024-12-10', i * 7), 'soir', 'poisson'));
    history.push(meal('2026-11-03', 'soir', 'raclette'));
    history.push(meal('2026-11-03', 'midi', 'poisson'));
    const index = buildIndex(history);
    expect(index.byKey.get('raclette')!.interval).toBe(60);
    const ranked = suggest(index, '2026-11-24', 'soir', { today: '2026-11-16' });
    const raclette = ranked.find((s) => s.label === 'raclette')!;
    const withoutRecent = suggest(buildIndex(history.slice(0, -2)), '2026-11-24', 'soir', { today: '2026-11-16' });
    // Trois semaines après, la raclette est encore nettement pénalisée…
    expect(raclette.score).toBeLessThan(0.3 * withoutRecent.find((s) => s.label === 'raclette')!.score);
    // …alors que le poisson hebdomadaire ne l'est plus.
    expect(ranked[0].label).toBe('poisson');
  });

  it('laisse s’effacer les plats abandonnés', () => {
    const history: Meal[] = [];
    for (let i = 0; i < 40; i++) history.push(meal(addDays('2019-01-08', i * 14), 'soir', 'hachis'));
    for (let i = 0; i < 6; i++) history.push(meal(addDays('2026-05-05', i * 28), 'soir', 'curry'));
    const ranked = suggest(buildIndex(history), '2026-11-24', 'soir', { today: '2026-11-16' });
    expect(ranked.map((s) => s.label)).toEqual(['curry', 'hachis']);
  });

  it('évite de répéter le même ingrédient dans la semaine', () => {
    const history: Meal[] = [];
    for (let i = 0; i < 10; i++) {
      history.push(meal(addDays('2026-06-02', i * 14), 'soir', 'pates carbonara'));
      history.push(meal(addDays('2026-06-03', i * 14), 'soir', 'pates/saumon'));
    }
    for (let i = 0; i < 9; i++) history.push(meal(addDays('2026-06-10', i * 14), 'soir', 'omelette'));
    const index = buildIndex(history);
    const options = { today: '2026-11-16', exclude: new Set([normalize('pates carbonara')]) };
    expect(suggest(index, '2026-11-25', 'soir', options)[0].label).toBe('pates/saumon');
    const weekWords = new Map([['pate', 1]]);
    expect(suggest(index, '2026-11-25', 'soir', { ...options, weekWords })[0].label).toBe('omelette');
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
    expect(suggest(dishes, '2026-11-21', 'soir', { exclude: new Set(['soupe']) })[0].label).toBe('poke bowl');
  });

  it('ne propose les restes que le jour où ils reviennent', () => {
    const history: Meal[] = [];
    for (let week = 0; week < 8; week++) {
      history.push(meal(addDays('2026-09-06', week * 7), 'soir', 'restes')); // dimanches
      history.push(meal(addDays('2026-09-01', week * 7), 'soir', 'pizzas')); // mardis
    }
    const dishes = buildIndex(history);
    expect(suggest(dishes, '2026-11-22', 'soir', { today: '2026-11-16' })[0].label).toBe('restes');
    const wednesday = suggest(dishes, '2026-11-18', 'soir', { today: '2026-11-16' });
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

describe('surprise', async () => {
  const { catalogProblems, conceptsOf, pickSurprise, surpriseIdeas, tasteProfile } = await import('./surprise');
  const { CATALOG } = await import('./catalog');

  it('a un catalogue cohérent', () => {
    expect(catalogProblems()).toEqual([]);
    expect(CATALOG.length).toBeGreaterThan(120);
  });

  it('reconnaît les familles dans les plats de l’historique', () => {
    expect(conceptsOf(normalize('poisson/purée'))).toEqual(['pdt', 'poisson']);
    expect(conceptsOf(normalize('crevettes curry/riz'))).toEqual(['riz', 'mer', 'asie', 'epices']);
    expect(conceptsOf(normalize('epinards/oeufs durs'))).toEqual(['oeuf', 'legumes']);
    expect(conceptsOf(normalize('pates/coquilles st jacques'))).toEqual(['pates', 'mer']);
    expect(conceptsOf(normalize('boeuf carottes'))).not.toContain('oeuf');
  });

  const history: Meal[] = [];
  // Il y a 4 ans : beaucoup de viande. Depuis un an : poisson et riz.
  for (let i = 0; i < 60; i++) history.push(meal(addDays('2022-01-04', i * 7), 'soir', 'steak/frites'));
  for (let i = 0; i < 40; i++) history.push(meal(addDays('2026-01-06', i * 7), 'soir', i % 2 ? 'poisson/riz' : 'saumon/riz'));
  history.push(meal('2026-03-01', 'soir', 'risotto'));
  history.push(meal('2026-03-08', 'midi', 'restes'));
  const index = buildIndex(history);

  it('calcule les préférences sur la période choisie', () => {
    const recent = tasteProfile(index, 12, '2026-11-16');
    expect(recent.get('poisson')).toBeCloseTo(40 / 41);
    expect(recent.has('boeuf')).toBe(false);
    const long = tasteProfile(index, 60, '2026-11-16');
    expect(long.get('boeuf')).toBeCloseTo(60 / 101);
  });

  it('propose des plats inconnus proches des goûts récents', () => {
    const ideas = surpriseIdeas(index, '2026-11-20', 12, '2026-11-16');
    const names = ideas.map((i) => i.name);
    expect(names).not.toContain('Risotto aux champignons'); // déjà connu
    expect(names).toContain('Bœuf bourguignon');
    expect(ideas[0].because).toEqual(['le riz', 'le poisson']);
    expect(names.indexOf('Saumon teriyaki, riz et brocolis')).toBeLessThan(names.indexOf('Bœuf bourguignon'));
    // Avec 5 ans de recul, la viande remonte.
    const long = surpriseIdeas(index, '2026-11-20', 60, '2026-11-16').map((i) => i.name);
    expect(long.indexOf('Burgers maison')).toBeLessThan(names.indexOf('Burgers maison'));
    // Hors saison, un plat d'été descend.
    const summer = surpriseIdeas(index, '2026-07-20', 12, '2026-11-16').map((i) => i.name);
    expect(summer.indexOf('Ceviche de dorade')).toBeLessThan(names.indexOf('Ceviche de dorade'));
  });

  it('ne répète pas une idée déjà montrée', () => {
    const ideas = surpriseIdeas(index, '2026-11-20', 12, '2026-11-16');
    const shown = new Set<string>();
    for (let i = 0; i < ideas.length; i++) {
      const pick = pickSurprise(ideas, shown, () => 0.5)!;
      expect(shown.has(pick.name)).toBe(false);
      shown.add(pick.name);
    }
    expect(pickSurprise(ideas, shown)).toBeNull();
  });
});

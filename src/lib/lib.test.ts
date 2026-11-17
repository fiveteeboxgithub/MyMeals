import { describe, expect, it } from 'vitest';
import { addDays, mondayOf, weekday } from './dates';
import { parseIcs } from './ics';
import { buildIndex, isTypoOf, normalize, pickProposal, suggest, usualSlots, type Suggestion } from './suggest';
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
    expect(normalize(' Poisson / Purée ')).toBe('poisson puree');
    const dishes = buildIndex([
      meal('2026-01-01', 'soir', 'poisson/purée'),
      meal('2026-02-01', 'soir', 'poisson/purée'),
      meal('2026-03-01', 'soir', 'Poisson / puree'),
    ]);
    expect(dishes.dishes).toHaveLength(1);
    expect(dishes.byKey.get('poisson puree')!.label).toBe('poisson/purée');
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

  it('regroupe les plats identiques écrits différemment', () => {
    const same = (...names: string[]) => new Set(names.map(normalize)).size === 1;
    expect(
      same(
        'pates/coquilles st jacques',
        'coquilles/pates',
        'Pâtes aux St-Jacques',
        'pates st jacques',
        'saint jacques et pâtes',
        'pâtes / noix de Saint-Jacques',
        'spaghettis aux coquilles saint jacques',
      ),
    ).toBe(true);
    expect(same('curry de crevettes, riz', 'crevettes curry/riz', 'riz basmati + crevettes au curry')).toBe(true);
    expect(same('poisson/purée', 'poisson et purée maison', 'purée de pommes de terre / poisson')).toBe(true);
    expect(same('steack haché/frites', 'steaks hachés, frites maison')).toBe(true);
    expect(same('mac do', 'mc do', 'McDo', "McDonald's", 'macdo')).toBe(true);
    expect(same('blanc de poulet/haricots verts', 'poulet haricot vert')).toBe(true);
    expect(same('hachis parmentier', 'parmentier')).toBe(true);
    // Des plats différents restent distincts.
    expect(same('pates/saumon', 'pates/thon')).toBe(false);
    expect(same('poisson/riz', 'poisson/purée')).toBe(false);
    expect(same('patates douces', 'pommes de terre')).toBe(false);
    expect(same('coquillettes jambon', 'coquilles jambon')).toBe(false);
    expect(same('filet mignon', 'mignon')).toBe(false);

    const index = buildIndex([
      meal('2026-01-03', 'soir', 'pates/coquilles st jacques'),
      meal('2026-02-03', 'soir', 'pates/coquilles st jacques'),
      meal('2026-03-03', 'soir', 'coquilles/pates'),
      meal('2026-04-03', 'soir', 'pates aux st jaques'),
      meal('2026-05-03', 'soir', 'croquemonsieur salade'),
      meal('2026-06-03', 'soir', 'croque monsieur/salade'),
      meal('2026-06-10', 'soir', 'croque monsieur/salade'),
    ]);
    expect(index.dishes.map((d) => d.label).sort()).toEqual(['croque monsieur/salade', 'pates/coquilles st jacques']);
    expect(index.dishes.find((d) => d.label.startsWith('pates'))!.occurrences).toHaveLength(4);
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

  it('ignore les repas plus vieux que la période choisie, et donne plus de poids aux anciens quand elle s’allonge', () => {
    const history: Meal[] = [];
    // « hachis » : un soir sur deux semaines pendant 3 ans, fini il y a 18 mois.
    for (let i = 0; i < 80; i++) history.push(meal(addDays('2023-05-02', i * 14), 'soir', 'hachis'));
    // « curry » : mangé récemment, mais moins souvent.
    for (let i = 0; i < 8; i++) history.push(meal(addDays('2026-05-05', i * 14), 'soir', 'curry'));
    const index = buildIndex(history);
    const rank = (historyMonths?: number) =>
      suggest(index, '2026-11-24', 'soir', { today: '2026-11-16', historyMonths }).map((s) => s.label);
    // 6 mois : le hachis, plus mangé depuis des mois, n'est même pas candidat.
    expect(rank(6)).toEqual(['curry']);
    // 12 mois : le hachis a été mangé jusqu'en mai, il est donc de nouveau candidat.
    expect(rank(12)).toHaveLength(2);
    expect(rank(60)).toHaveLength(2);
    expect(rank(0)).toHaveLength(2);
    // Sans option, comportement historique : aucun plat écarté.
    expect(rank(undefined)).toContain('hachis');
    const scoreOf = (months: number | undefined) =>
      suggest(index, '2026-11-24', 'soir', { today: '2026-11-16', historyMonths: months }).find((s) => s.label === 'hachis')!.score;
    expect(scoreOf(0)).toBeGreaterThan(scoreOf(60));
    expect(scoreOf(60)).toBeGreaterThan(scoreOf(24));
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
    expect(CATALOG.length).toBeGreaterThan(500);
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

  it('élargit le tirage de Surprise Me avec le niveau de hasard', () => {
    const ideas = surpriseIdeas(index, '2026-11-20', 12, '2026-11-16');
    expect(ideas.length).toBeGreaterThan(400);
    const distinct = (level: number) => {
      const seen = new Set<string>();
      for (let i = 0; i < 800; i++) seen.add(pickSurprise(ideas, new Set(), level)!.name);
      return seen.size;
    };
    expect(distinct(0)).toBe(1);
    expect(distinct(1)).toBeLessThanOrEqual(10);
    expect(distinct(2)).toBeGreaterThan(distinct(1));
    expect(distinct(3)).toBeGreaterThan(distinct(2));
    expect(distinct(4)).toBeGreaterThan(distinct(3));
    expect(distinct(5)).toBeGreaterThan(distinct(4));
    expect(distinct(5)).toBeGreaterThan(300);
    // Sans hasard, c'est toujours la première idée du classement.
    expect(pickSurprise(ideas, new Set(), 0)!.name).toBe(ideas[0].name);
  });

  it('calcule les goûts sur tout l’historique quand la période est 0', () => {
    expect(tasteProfile(index, 0, '2026-11-16').get('boeuf')).toBeCloseTo(60 / 101);
    expect(tasteProfile(index, 0, '2026-11-16').get('poisson')).toBeCloseTo(40 / 101);
  });

  it('ne répète pas une idée déjà montrée', () => {
    const ideas = surpriseIdeas(index, '2026-11-20', 12, '2026-11-16');
    const shown = new Set<string>();
    for (let i = 0; i < ideas.length; i++) {
      const pick = pickSurprise(ideas, shown, 2, () => 0.5)!;
      expect(shown.has(pick.name)).toBe(false);
      shown.add(pick.name);
    }
    expect(pickSurprise(ideas, shown)).toBeNull();
  });
});

describe('pickProposal', () => {
  const ranked: Suggestion[] = Array.from({ length: 40 }, (_, i) => ({
    key: `plat${i}`,
    label: `plat ${i}`,
    variants: [],
    search: `plat ${i}`,
    score: 40 - i,
    count: 1,
    reason: '',
  }));
  const draws = (level: number) => Array.from({ length: 400 }, (_, i) => pickProposal(ranked, level, `seed${i}`)!);

  it('prend toujours le premier sans hasard', () => {
    expect(new Set(draws(0).map((s) => s.key))).toEqual(new Set(['plat0']));
  });

  it('donne le même choix pour le même tirage', () => {
    expect(pickProposal(ranked, 2, 'a|lundi')).toBe(pickProposal(ranked, 2, 'a|lundi'));
  });

  it('varie davantage quand le hasard augmente, en favorisant les mieux classés', () => {
    const distinct = (level: number) => new Set(draws(level).map((s) => s.key)).size;
    expect(distinct(1)).toBeGreaterThan(3);
    expect(distinct(1)).toBeLessThanOrEqual(10);
    expect(distinct(2)).toBeGreaterThan(distinct(1));
    expect(distinct(3)).toBeGreaterThan(distinct(2));
    const medium = draws(2);
    const topHalf = medium.filter((s) => s.score > 25).length;
    expect(topHalf).toBeGreaterThan(medium.length / 2);
  });

  it('élargit le choix aux niveaux très fort et total', () => {
    const big: Suggestion[] = Array.from({ length: 300 }, (_, i) => ({ ...ranked[0], key: `g${i}`, label: `g ${i}`, score: 300 - i }));
    const distinct = (level: number) => new Set(Array.from({ length: 3000 }, (_, i) => pickProposal(big, level, `s${i}`)!.key)).size;
    const [d2, d3, d4, d5] = [distinct(2), distinct(3), distinct(4), distinct(5)];
    expect(d2).toBeLessThanOrEqual(30);
    expect(d3).toBeGreaterThan(d2);
    expect(d3).toBeLessThanOrEqual(80);
    expect(d4).toBeGreaterThan(d3);
    expect(d4).toBeLessThanOrEqual(200);
    expect(d5).toBeGreaterThan(d4);
    expect(d5).toBe(300);
    // Au niveau total, les 300 plats ont à peu près la même chance.
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const key = pickProposal(big, 5, `t${i}`)!.key;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(300);
    expect(Math.max(...counts.values())).toBeLessThan(60);
    expect(Math.min(...counts.values())).toBeGreaterThan(2);
  });

  it('évite un plat mangé la semaine dernière tant qu’il reste autre chose', () => {
    const withRecent = ranked.map((s, i) => (i < 5 ? { ...s, recent: true } : s));
    for (let i = 0; i < 200; i++) expect(pickProposal(withRecent, 5, `r${i}`)!.recent).not.toBe(true);
    const onlyRecent = ranked.slice(0, 3).map((s) => ({ ...s, recent: true }));
    expect(pickProposal(onlyRecent, 5, 'x')).toBeDefined();
  });

  it('gère les listes vides ou sans score', () => {
    expect(pickProposal([], 2, 'x')).toBeUndefined();
    expect(pickProposal([{ ...ranked[0], score: 0 }, { ...ranked[1], score: 0 }], 3, 'x')!.key).toBe('plat0');
  });
});

describe('doublons', async () => {
  const {
    applyInitialStyle,
    approximateGroups,
    compileRegex,
    findOccurrences,
    groupByLabel,
    hasQuery,
    parseKeywords,
    prefersLowercase,
    proposeLabel,
    reasonFor,
    suspectedGroups,
  } = await import('./duplicates');

  const history: Meal[] = [
    meal('2026-01-03', 'soir', 'pates/coquilles st jacques'),
    meal('2026-02-03', 'soir', 'pates/coquilles st jacques'),
    meal('2026-03-03', 'soir', 'Coquilles / pâtes'),
    meal('2026-04-03', 'midi', 'pates st jacques'),
    meal('2026-05-03', 'soir', 'pates carbonara'),
    meal('2026-06-03', 'soir', 'poisson/purée'),
    meal('2026-07-03', 'soir', 'pommes de terre sautées'),
    meal('2026-08-03', 'soir', 'pdt rissolées'),
  ];

  it('découpe les mots-clés sans accents ni mots trop courts', () => {
    expect(parseKeywords(' Pâtes, st/Jacques  a ')).toEqual(['pates', 'st', 'jacques']);
    expect(parseKeywords('   ')).toEqual([]);
  });

  it('regroupe les repas par libellé exact, du plus fréquent au plus rare', () => {
    const groups = groupByLabel(history);
    expect(groups[0]).toMatchObject({ label: 'pates/coquilles st jacques', count: 2, lastDate: '2026-02-03' });
    expect(groups[0].ids).toHaveLength(2);
    expect(groups).toHaveLength(7);
  });

  it('trouve les libellés qui contiennent tous les mots-clés, même coupés', () => {
    const labels = (query: string) => findOccurrences(history, query).map((o) => o.label).sort();
    const found = findOccurrences(
      [
        meal('2026-01-01', 'soir', 'st jacques aux pâtes'),
        meal('2026-01-02', 'soir', 'pâte a la saint jacques'),
        meal('2026-01-03', 'soir', 'pâtes au pesto'),
        meal('2026-01-04', 'soir', 'pat carbo'),
        meal('2026-01-05', 'soir', 'pates carbonara'),
        meal('2026-01-06', 'soir', 'jacques le fataliste'),
      ],
      'pat jacqu',
    ).map((o) => o.label);
    expect(found.sort()).toEqual(['pâte a la saint jacques', 'st jacques aux pâtes']);
    // Tous les mots sont obligatoires, dans n'importe quel ordre.
    expect(labels('jacqu pat')).toEqual(['pates st jacques', 'pates/coquilles st jacques']);
    expect(labels('carbonara purée')).toEqual([]);
    expect(labels('jacques')).toEqual(['pates st jacques', 'pates/coquilles st jacques']);
    // Un mot-clé est un début de mot, pas un bout de mot.
    expect(findOccurrences([meal('2026-01-01', 'soir', 'boeuf carottes')], 'oeuf')).toEqual([]);
    expect(findOccurrences([meal('2026-01-01', 'soir', 'oeufs durs')], 'oeuf')).toHaveLength(1);
    expect(labels('')).toEqual([]);
    expect(labels('zzz')).toEqual([]);
  });

  it('retrouve aussi les autres noms d’un même ingrédient', () => {
    const labels = (query: string) => findOccurrences(history, query).map((o) => o.label);
    expect(labels('coquille')).toContain('pates st jacques');
    expect(labels('pdt').sort()).toEqual(['pdt rissolées', 'pommes de terre sautées']);
    expect(labels('saint jacques pat').sort()).toEqual(['Coquilles / pâtes', 'pates st jacques', 'pates/coquilles st jacques']);
  });

  it('accepte une expression régulière, sans accents ni casse', () => {
    const regexHistory: Meal[] = [
      meal('2026-01-01', 'soir', 'Pâtes au pesto'),
      meal('2026-01-02', 'soir', 'pates carbonara'),
      meal('2026-01-03', 'soir', 'riz sauce tomate'),
      meal('2026-01-04', 'soir', 'saumon/riz'),
      meal('2026-01-05', 'soir', 'thon/pâtes'),
      meal('2026-01-06', 'soir', 'restes'),
      meal('2026-01-07', 'soir', 'pâté lorrain'),
      meal('2026-01-08', 'soir', 'menu 2 pizzas'),
    ];
    const rx = (pattern: string) => findOccurrences(regexHistory, pattern, { regex: true }).map((o) => o.label).sort();
    expect(rx('^pates')).toEqual(['Pâtes au pesto', 'pates carbonara']);
    expect(rx('^pâtes')).toEqual(['Pâtes au pesto', 'pates carbonara']);
    expect(rx('RIZ|pesto')).toEqual(['Pâtes au pesto', 'riz sauce tomate', 'saumon/riz']);
    expect(rx('(saumon|thon).*(riz|pates)')).toEqual(['saumon/riz', 'thon/pâtes']);
    expect(rx('^(?!.*sauce).*riz')).toEqual(['saumon/riz']);
    expect(rx('restes?$')).toEqual(['restes']);
    // Les accents sont ignorés : « pâté » est vu comme « pate ».
    expect(rx('\\bpate\\b')).toEqual(['pâté lorrain']);
    expect(rx('\\bpates\\b')).toEqual(['Pâtes au pesto', 'pates carbonara', 'thon/pâtes']);
    expect(rx('\\briz\\b')).toEqual(['riz sauce tomate', 'saumon/riz']);
    expect(rx('\\d')).toEqual(['menu 2 pizzas']);
    // Un motif répété sur plusieurs libellés donne toujours le même résultat (pas d'état entre deux tests).
    expect(rx('pates')).toHaveLength(3);
    expect(rx('pates')).toHaveLength(3);
    // Le mode mots ne change pas, et un motif vide ne trouve rien.
    expect(findOccurrences(regexHistory, 'pates au', {}).map((o) => o.label)).toEqual(['Pâtes au pesto']);
    expect(rx('')).toEqual([]);
    expect(rx('(riz')).toEqual([]);
  });

  it('signale une expression régulière invalide', () => {
    expect(compileRegex('(riz').error).toBeTruthy();
    expect(compileRegex('(riz').error).not.toMatch(/\/iu/);
    expect(compileRegex('[a-').error).toBeTruthy();
    expect(compileRegex('').error).toBeUndefined();
    expect(compileRegex('pat.*jacqu').regex).toBeInstanceOf(RegExp);
    expect(hasQuery('  ', { regex: true })).toBe(false);
    expect(hasQuery('.*', { regex: true })).toBe(true);
    expect(hasQuery('de', {})).toBe(true);
  });

  it('repère les doublons probables : majuscules, accents, pluriels, ordre, fautes', () => {
    const meals: Meal[] = [];
    let n = 0;
    const add = (name: string, times = 1) => {
      for (let i = 0; i < times; i++) meals.push(meal(addDays('2026-01-01', n++), 'soir', name));
    };
    add('poisson/purée', 9);
    add('Poisson/purée', 2); // majuscule
    add('poisson/puree', 1); // accent
    add('pizza', 5);
    add('Pizzas', 2); // pluriel et majuscule
    add('crevettes curry/riz', 4);
    add('crevette curry/riz', 1); // singulier
    add('riz/crevettes curry', 1); // ordre
    add('kebab', 3);
    add('kebbab', 1); // faute de frappe
    add('pates carbonara', 6); // pas de doublon
    add('pates saumon', 3); // différent de pates carbonara
    add('Restes', 2);
    add('restes', 7);
    const groups = suspectedGroups(meals, buildIndex(meals));
    const byProposal = new Map(groups.map((g) => [g.proposal, g]));
    expect([...byProposal.keys()].sort()).toEqual(['crevettes curry/riz', 'kebab', 'pizza', 'poisson/purée', 'restes']);
    // Les plus gros groupes d'abord.
    expect(groups.map((g) => g.proposal)).toEqual(['poisson/purée', 'restes', 'pizza', 'crevettes curry/riz', 'kebab']);
    const fish = byProposal.get('poisson/purée')!;
    expect(fish.mealCount).toBe(12);
    expect(fish.occurrences.map((o) => o.label).sort()).toEqual(['Poisson/purée', 'poisson/puree', 'poisson/purée']);
    expect(fish.reasons).toEqual(['majuscules ou accents']);
    expect(byProposal.get('crevettes curry/riz')!.reasons.sort()).toEqual(['ordre des mots', 'singulier ou pluriel']);
    expect(byProposal.get('pizza')!.reasons).toEqual(['singulier ou pluriel']);
    expect(byProposal.get('kebab')!.reasons).toEqual(['faute de frappe probable']);
    // Ni « pates carbonara » ni « pates saumon » ne sont des doublons.
    expect(groups.some((g) => g.occurrences.some((o) => o.label.startsWith('pates')))).toBe(false);
    // Un groupe écarté ne revient pas.
    const ignored = new Set([fish.signature]);
    expect(suspectedGroups(meals, buildIndex(meals), ignored).map((g) => g.proposal)).not.toContain('poisson/purée');
  });

  it('propose des plats approchants : mêmes mots, plus un ou deux', () => {
    const meals: Meal[] = [];
    let n = 0;
    const add = (name: string, times = 1) => {
      for (let i = 0; i < times; i++) meals.push(meal(addDays('2026-01-01', n++), 'soir', name));
    };
    add('pates saumon', 5);
    add('pates saumon fumé', 2); // habillage seulement
    add('Pâtes au saumon fumé frais', 1); // plus détaillé que « pates saumon fumé »
    add('pates saumon fumé maison', 1); // « maison » est un petit mot ignoré : c'est déjà le même plat
    add('pates saumon crème', 2); // autre mot : moins sûr
    add('poisson riz', 4);
    add('poisson riz haricots verts', 3);
    add('quiche', 6);
    add('quiche lorraine', 2); // base d'un seul mot : ignorée
    add('restes', 3);
    add('restes pates saumon', 1); // les restes sont écartés
    add('curry poulet', 3);
    add('curry poulet lait coco épinards', 2); // trois mots en plus : trop loin
    const groups = approximateGroups(meals, buildIndex(meals));
    const byLabel = new Map(groups.map((g) => [g.label, g]));
    expect([...byLabel.keys()].sort()).toEqual(['pates saumon', 'pates saumon fumé', 'poisson riz']);
    // Le plat « Pâtes au saumon fumé frais » est rangé sous le plat le plus proche, « pates saumon fumé ».
    const fumeGroup = byLabel.get('pates saumon fumé')!;
    expect(fumeGroup.candidates.map((c) => c.label)).toEqual(['Pâtes au saumon fumé frais']);
    expect(fumeGroup.candidates[0].extra).toEqual(['frai']);
    expect(fumeGroup.candidates[0].shown).toEqual(['frais']);
    expect(fumeGroup.candidates[0].likely).toBe(true);
    const salmon = byLabel.get('pates saumon')!;
    expect(salmon.baseCount).toBe(5);
    expect(salmon.candidates.map((c) => c.label)).toEqual(['pates saumon fumé', 'pates saumon crème']);
    expect(salmon.candidates.map((c) => c.likely)).toEqual([true, false]);
    expect(salmon.candidates[0].extra).toEqual(['fume']);
    expect(salmon.candidates[0].shown).toEqual(['fumé']);
    expect(salmon.mealCount).toBe(5 + (2 + 1) + 2); // « fumé » compte aussi « fumé maison »
    const fish = byLabel.get('poisson riz')!;
    expect(fish.candidates[0].extra).toEqual(['haricotvert']);
    expect(fish.candidates[0].shown).toEqual(['haricotvert']); // mot unifié : pas d'écriture d'origine
    expect(fish.likely).toBe(false);
    // Les groupes qui ont un candidat « probable » passent avant les autres.
    expect(groups.map((g) => g.likely)).toEqual([true, true, false]);
    // Écarter un groupe le fait disparaître.
    const without = approximateGroups(meals, buildIndex(meals), new Set([fish.signature]));
    expect(without.map((g) => g.label)).not.toContain('poisson riz');
    // Une fois fusionnés, les plats ne sont plus approchants.
    const merged = meals.map((m) => (m.name.startsWith('poisson riz') ? { ...m, name: 'poisson riz' } : m));
    expect(approximateGroups(merged, buildIndex(merged)).map((g) => g.label)).not.toContain('poisson riz');
  });

  it('propose le style d’écriture majoritaire pour la première lettre', () => {
    const lowerStyle: Meal[] = [meal('2026-01-01', 'soir', 'pizza'), meal('2026-01-02', 'soir', 'quiche'), meal('2026-01-03', 'soir', 'Soupe')];
    expect(prefersLowercase(lowerStyle)).toBe(true);
    expect(prefersLowercase([meal('2026-01-01', 'soir', 'Pizza'), meal('2026-01-02', 'soir', 'Quiche'), meal('2026-01-03', 'soir', 'soupe')])).toBe(false);
    expect(applyInitialStyle('Pâtes au pesto', true)).toBe('pâtes au pesto');
    expect(applyInitialStyle('pâtes au pesto', false)).toBe('Pâtes au pesto');
    expect(applyInitialStyle('PDT rissolées', true)).toBe('PDT rissolées');
    expect(applyInitialStyle('« Riz »', true)).toBe('« riz »');
    // À égalité de repas, on garde l'écriture du reste du calendrier ; si tout est en majuscule, on la met en minuscule.
    const tie = groupByLabel([meal('2026-02-01', 'soir', 'Pizza'), meal('2026-02-02', 'soir', 'pizza')]);
    expect(proposeLabel(tie, true)).toBe('pizza');
    expect(proposeLabel(tie, false)).toBe('Pizza');
    const allUpper = ['Pizza', 'Pizzas', 'quiche', 'soupe', 'tarte'].map((name, i) => meal(addDays('2026-02-01', i), 'soir', name));
    expect(suspectedGroups(allUpper, buildIndex(allUpper))[0].proposal).toBe('pizza');
    expect(reasonFor('Pizzas', 'pizza')).toBe('singulier ou pluriel');
    expect(reasonFor('poisson / purée', 'poisson/purée')).toBe('ponctuation ou espaces');
  });

  it('propose le libellé le plus utilisé, puis le plus court', () => {
    const found = findOccurrences(history, 'jacques');
    expect(proposeLabel(found)).toBe('pates/coquilles st jacques');
    const tie = groupByLabel([meal('2026-01-01', 'soir', 'pates saumon grillé'), meal('2026-01-02', 'soir', 'pates saumon')]);
    expect(proposeLabel(tie)).toBe('pates saumon');
    expect(proposeLabel([])).toBe('');
  });
});

describe('thème', async () => {
  const { THEMES, contrast, themeFromColor, resolveTheme } = await import('./theme');

  it('garde le texte lisible sur chaque thème prédéfini', () => {
    for (const theme of THEMES) {
      if (!theme.vars) continue;
      const { bg, card, text, muted, accent, onAccent, danger } = theme.vars;
      const problems: string[] = [];
      for (const [name, a, b] of [
        ['texte/fond', text, bg],
        ['texte/carte', text, card],
        ['discret/fond', muted, bg],
        ['discret/carte', muted, card],
        ['bouton (texte sur accent)', onAccent, accent],
        ['accent/fond', accent, bg],
        ['danger/carte', danger, card],
      ] as const) {
        if (contrast(a, b) < 4.5) problems.push(`${name} ${contrast(a, b).toFixed(2)}`);
      }
      expect(problems, theme.id).toEqual([]);
    }
  });

  it('choisit un texte lisible pour n’importe quelle couleur libre', () => {
    for (const color of ['#ffffff', '#000000', '#808080', '#777777', '#999999', '#2f6f4f', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#7b3fa0', '#ffd1dc', '#e9efe9', '#123456']) {
      const vars = themeFromColor(color);
      expect(vars.bg).toBe(color);
      expect(contrast(vars.text, vars.bg), `texte sur ${color}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars.text, vars.card), `texte sur carte ${color}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars.muted, vars.bg), `discret sur ${color}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars.onAccent, vars.accent), `bouton sur ${color}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars.accent, vars.bg), `accent sur ${color}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars.accent, vars.card), `accent sur carte ${color}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(themeFromColor('#101820').dark).toBe(true);
    expect(themeFromColor('#fff5cc').dark).toBe(false);
  });

  it('résout les choix enregistrés', () => {
    expect(resolveTheme({ id: 'auto' })).toBeNull();
    expect(resolveTheme({ id: 'inconnu' })).toBeNull();
    expect(resolveTheme({ id: 'menthe' })!.bg).toBe('#e3f1ea');
    expect(resolveTheme({ id: 'custom', custom: '#102030' })!.dark).toBe(true);
  });
});

describe('liste noire', async () => {
  const { addToBlacklist, blacklistedKeys, parseBlacklist } = await import('./blacklist');
  const { BLACKLIST_PENALTY } = await import('./suggest');
  const { surpriseIdeas, tasteProfile } = await import('./surprise');

  it('cache les plats dont le nom contient un mot, sans accents ni majuscules', () => {
    const list = parseBlacklist('kebab\n  Wafu  \n\n# un commentaire\nChez Paul');
    expect(list.entries).toBe(3);
    expect(list.matches('Kebabs frites')).toBe(true);
    expect(list.matches('menu KEBAB')).toBe(true);
    expect(list.matches('wafu/riz')).toBe(true);
    expect(list.matches('chez paul : pizzas')).toBe(true);
    expect(list.matches('pâtes carbonara')).toBe(false);
    expect(list.matches('# un commentaire')).toBe(false);
    expect(parseBlacklist('café').matches('Cafe gourmand')).toBe(true);
    expect(parseBlacklist('').matches('kebab')).toBe(false);
  });

  it('ajoute une ligne à la liste noire sans doublon', () => {
    expect(addToBlacklist('', 'kebab')).toBe('kebab');
    expect(addToBlacklist('kebab', 'wafu')).toBe('kebab\nwafu');
    expect(addToBlacklist('kebab\n\n', 'wafu')).toBe('kebab\nwafu');
    expect(addToBlacklist('kebab\nwafu', '  Wafu ')).toBe('kebab\nwafu'); // déjà là, à la casse près
    expect(addToBlacklist('Pâtes au pesto', 'pates au pesto')).toBe('Pâtes au pesto'); // à l'accent près
    expect(addToBlacklist('kebab', '   ')).toBe('kebab');
    expect(addToBlacklist('kebab', 'poisson   /  riz')).toBe('kebab\npoisson / riz');
    // Le plat ajouté est bien masqué ensuite.
    expect(parseBlacklist(addToBlacklist('kebab', 'chez paul : pizza')).matches('Chez Paul : pizza')).toBe(true);
  });

  it('accepte des expressions régulières entre barres obliques', () => {
    const list = parseBlacklist('/\\bpho\\b/\n/^(sushi|maki)/\n/café|THÉ/');
    expect(list.entries).toBe(3);
    expect(list.matches('pho')).toBe(true);
    expect(list.matches('Pho bo')).toBe(true);
    expect(list.matches('photo de famille')).toBe(false);
    expect(list.matches('Sushis maison')).toBe(true);
    expect(list.matches('poke sushi')).toBe(false);
    expect(list.matches('cafe et the')).toBe(true);
    // Sans barres, c'est du texte : les caractères spéciaux ne sont pas interprétés.
    expect(parseBlacklist('pho.*bo').matches('pho bo')).toBe(false);
    expect(parseBlacklist('pho.*bo').matches('pho.*bo à emporter')).toBe(true);
  });

  it('signale les motifs mal formés sans planter', () => {
    const list = parseBlacklist('kebab\n/(pho/\n/[a-/');
    expect(list.entries).toBe(1);
    expect(list.invalid.map((i) => i.line)).toEqual(['/(pho/', '/[a-/']);
    expect(list.invalid[0].error).toBeTruthy();
    expect(list.matches('kebab')).toBe(true);
  });

  const history: Meal[] = [];
  for (let i = 0; i < 12; i++) history.push(meal(addDays('2026-01-05', i * 14), 'soir', 'poisson/riz'));
  for (let i = 0; i < 12; i++) history.push(meal(addDays('2026-01-06', i * 14), 'soir', i === 3 ? 'kebbab' : 'kebab'));
  for (let i = 0; i < 6; i++) history.push(meal(addDays('2026-01-07', i * 28), 'soir', 'wafu'));
  const index = buildIndex(history);

  it('repère les plats de l’historique, quelle que soit leur écriture', () => {
    expect(index.dishes.map((d) => d.label).sort()).toEqual(['kebab', 'poisson/riz', 'wafu']);
    // « kebbab » est une variante de « kebab » : l'une ou l'autre suffit.
    expect([...blacklistedKeys(index, parseBlacklist('kebbab'))]).toEqual(['kebab']);
    expect([...blacklistedKeys(index, parseBlacklist('keba\nwa'))].sort()).toEqual(['kebab', 'wafu']);
    expect(blacklistedKeys(index, parseBlacklist('')).size).toBe(0);
    expect(blacklistedKeys(index, parseBlacklist('/^w/')).size).toBe(1);
  });

  it('ne propose pas la liste noire, sauf si on l’inclut, et alors rarement', () => {
    const keys = blacklistedKeys(index, parseBlacklist('kebab\nwafu'));
    const options = { today: '2026-11-16', blacklist: keys };
    expect(suggest(index, '2026-11-24', 'soir', options).map((s) => s.label)).toEqual(['poisson/riz']);
    const included = suggest(index, '2026-11-24', 'soir', { ...options, includeBlacklist: true });
    expect(included.map((s) => s.label).sort()).toEqual(['kebab', 'poisson/riz', 'wafu']);
    expect(included.filter((s) => s.blacklisted).map((s) => s.label).sort()).toEqual(['kebab', 'wafu']);
    expect(included[0].label).toBe('poisson/riz');
    // Leur score est réduit au dixième : à poids égal, un plat normal passe toujours devant.
    const plain = suggest(index, '2026-11-24', 'soir', { today: '2026-11-16' });
    const scoreOf = (list: typeof plain, label: string) => list.find((s) => s.label === label)!.score;
    expect(scoreOf(included, 'kebab')).toBeCloseTo(scoreOf(plain, 'kebab') * BLACKLIST_PENALTY, 6);
    // Sans liste noire, rien ne change.
    expect(plain.some((s) => s.blacklisted)).toBe(false);
  });

  it('retire les idées « Surprise Me » de la liste noire, et ses plats des goûts', () => {
    const baseline = surpriseIdeas(buildIndex([]), '2026-11-20', 24, '2026-11-16').map((i) => i.name);
    expect(baseline).toContain('Ramen');
    expect(baseline).toContain('Soupe miso et gyozas');
    const list = parseBlacklist('ramen\n/gyoza/');
    const hidden = surpriseIdeas(buildIndex([]), '2026-11-20', 24, '2026-11-16', { matches: list.matches, keys: new Set(), include: false }).map((i) => i.name);
    expect(hidden).not.toContain('Ramen');
    expect(hidden).not.toContain('Soupe miso et gyozas');
    expect(hidden.length).toBe(baseline.length - 2);
    const included = surpriseIdeas(buildIndex([]), '2026-11-20', 24, '2026-11-16', { matches: list.matches, keys: new Set(), include: true });
    expect(included.map((i) => i.name)).toContain('Ramen');
    expect(included.findIndex((i) => i.name === 'Ramen')).toBeGreaterThan(baseline.indexOf('Ramen'));
    // Les repas de la liste noire ne dessinent pas les goûts (un kebab ne dit pas ce qu'on aime cuisiner).
    const profile = tasteProfile(index, 24, '2026-11-16');
    expect(profile.get('snack') ?? 0).toBeGreaterThan(0);
    const without = tasteProfile(index, 24, '2026-11-16', blacklistedKeys(index, parseBlacklist('kebab\nwafu')));
    expect(without.get('snack') ?? 0).toBe(0);
    expect(without.get('boeuf') ?? 0).toBe(0);
    expect(without.get('poisson')).toBeCloseTo(1);
  });
});

describe('réglages partagés et connexion', async () => {
  const { DEFAULT_SETTINGS, decideSync, parseSettingsRecord } = await import('./settings');
  const google = await import('./google');

  const record = (updatedAt: number, patch: Record<string, unknown> = {}) => ({
    updatedAt,
    settings: { ...DEFAULT_SETTINGS, ...patch },
  });

  it('décide qui l’emporte : le plus récent', () => {
    expect(decideSync(0, undefined)).toBe('none'); // pas encore lus
    expect(decideSync(0, null)).toBe('none'); // rien nulle part
    expect(decideSync(5, null)).toBe('push-local'); // réglé ici, pas encore dans l'agenda
    expect(decideSync(1, null)).toBe('push-local'); // anciens réglages d'avant la synchronisation
    expect(decideSync(0, record(10))).toBe('adopt-remote'); // appareil neuf
    expect(decideSync(1, record(10))).toBe('adopt-remote');
    expect(decideSync(10, record(10))).toBe('none');
    expect(decideSync(20, record(10))).toBe('push-local');
    expect(decideSync(5, record(10))).toBe('adopt-remote');
  });

  it('valide les réglages venus de l’agenda', () => {
    const full = { blacklistText: 'kebab\nwafu', includeBlacklist: true, favoritesText: '', randomness: 4, historyMonths: 120, surprisePeriod: 0, ideasText: 'poulet yassa', lunchTime: '12:30', dinnerTime: '19:45' };
    expect(parseSettingsRecord({ updatedAt: 12, settings: full })).toEqual({ updatedAt: 12, settings: full });
    // Réglages enregistrés par une version plus ancienne : les nouveaux champs prennent leur valeur par défaut.
    const old = parseSettingsRecord({ updatedAt: 12, settings: { blacklistText: 'kebab', includeBlacklist: false, randomness: 3, historyMonths: 60, surprisePeriod: 60 } })!;
    expect(old.settings.ideasText).toBe('');
    expect(old.settings.lunchTime).toBe('13:00');
    expect(old.settings.dinnerTime).toBe('20:00');
    // Valeurs absurdes : retour au défaut, champ par champ.
    const bad = parseSettingsRecord({ updatedAt: 3, settings: { blacklistText: 42, includeBlacklist: 'oui', randomness: 99, historyMonths: 7, surprisePeriod: -1, ideasText: 3, lunchTime: '25:00', dinnerTime: '8h' } });
    expect(bad).toEqual({ updatedAt: 3, settings: DEFAULT_SETTINGS });
    expect(parseSettingsRecord(null)).toBeNull();
    expect(parseSettingsRecord({ settings: {} })).toBeNull();
    expect(parseSettingsRecord({ updatedAt: 'x', settings: {} })).toBeNull();
    expect(parseSettingsRecord({ updatedAt: 1, settings: { blacklistText: 'x'.repeat(10000) } })!.settings.blacklistText).toHaveLength(2500);
    expect(parseSettingsRecord({ updatedAt: 1, settings: { ideasText: 'x'.repeat(10000) } })!.settings.ideasText).toHaveLength(3500);
    // Des listes pleines, avec des lignes de taille réaliste, tiennent dans le texte d'un événement Google.
    const { encodeSettings, MAX_EVENT_TEXT } = google;
    const line = 'pâtes à la crème\n'; // 17 caractères
    const full2 = {
      updatedAt: Date.now(),
      settings: { ...DEFAULT_SETTINGS, blacklistText: line.repeat(147).slice(0, 2500), ideasText: line.repeat(206).slice(0, 3500) },
    };
    expect(encodeSettings(full2).length).toBeLessThan(MAX_EVENT_TEXT);
  });

  it('écrit et relit les réglages dans le texte de l’événement', () => {
    const payload = record(99, { blacklistText: 'kebab\n/\\bpho\\b/\n« été » & co', includeBlacklist: true });
    const text = google.encodeSettings(payload);
    expect(text).toContain('Ne pas supprimer');
    expect(text.split('\n')).toHaveLength(2); // le JSON tient sur une seule ligne
    expect(google.decodeSettings(text)).toEqual(payload);
    // Même si Google (ou quelqu'un) a reformaté le texte en HTML.
    const html = `<p>${text.replace('\n', '<br>')}</p>`.replace(/"/g, '&quot;');
    expect(google.decodeSettings(html)).toEqual(payload);
    expect(google.decodeSettings('texte sans réglages')).toBeNull();
    expect(google.decodeSettings(undefined)).toBeNull();
    expect(google.decodeSettings('MYMEALS-REGLAGES {pas du json')).toBeNull();
  });

  it('ne prend pas l’événement des réglages pour un repas', () => {
    const settingsEvent = { id: google.SETTINGS_EVENT_ID, status: 'confirmed', summary: '⚙ MyMeals : réglages', start: { date: '2100-01-01' } };
    expect(google.eventToMeal(settingsEvent)).toBeNull();
    expect(google.eventToMeal({ id: 'abc', status: 'confirmed', summary: 'pizza', start: { date: '2100-01-01' } })).not.toBeNull();
    // L'identifiant n'utilise que les caractères permis par Google : a-v et 0-9.
    expect(google.SETTINGS_EVENT_ID).toMatch(/^[a-v0-9]{5,}$/);
  });

  it('garde le jeton en mémoire même si le navigateur refuse de le stocker', () => {
    google.forgetToken();
    expect(google.storedToken()).toBeNull();
    // Ici localStorage n'existe pas (comme dans un navigateur qui bloque le stockage).
    google.rememberToken('abc', 3600);
    expect(google.storedToken()).toBe('abc');
    expect(google.tokenRemainingMs()).toBeGreaterThan(3_000_000);
    google.forgetToken();
    expect(google.storedToken()).toBeNull();
    expect(google.tokenRemainingMs()).toBe(0);
    google.rememberToken('périmé', 30); // moins d'une minute : déjà jugé périmé
    expect(google.storedToken()).toBeNull();
  });
});

describe('planification', async () => {
  const { forgottenDishes, leftoverHabits, leftoverOf } = await import('./suggest');
  const { overlapsBySlot, shownByDefault, slotWindow, clock } = await import('./otherCalendars');
  const { weekText } = await import('./weekText');
  const { shiftTime } = await import('./google');
  const { parseIdeas, surpriseIdeas } = await import('./surprise');
  const { mealsToRename, approximateGroups, groupByLabel } = await import('./duplicates');

  it('reconnaît un repas de restes', () => {
    expect(leftoverOf('restes tartiflette')).toBe('tartiflette');
    expect(leftoverOf('Restes de la tartiflette')).toBe('la tartiflette');
    expect(leftoverOf("reste d'hachis parmentier")).toBe('hachis parmentier');
    expect(leftoverOf('restes')).toBeNull();
    expect(leftoverOf('tartiflette')).toBeNull();
  });

  it('apprend quels plats laissent des restes', () => {
    const meals: Meal[] = [];
    for (const [a, b] of [['2026-01-10', '2026-01-11'], ['2026-02-07', '2026-02-09'], ['2026-03-07', '2026-03-08']]) {
      meals.push(meal(a, 'soir', 'tartiflette'), meal(b, 'soir', 'restes tartiflette'));
    }
    meals.push(meal('2026-04-01', 'soir', 'lasagnes'), meal('2026-04-02', 'soir', 'restes lasagnes')); // une seule fois
    meals.push(meal('2026-05-01', 'soir', 'restes curry')); // sans curry avant
    const habits = leftoverHabits(meals, buildIndex(meals));
    expect([...habits.entries()]).toEqual([[normalize('tartiflette'), 3]]);
  });

  it('retrouve les plats oubliés', () => {
    const meals: Meal[] = [];
    for (let i = 0; i < 10; i++) meals.push(meal(addDays('2022-01-04', i * 30), 'soir', 'hachis parmentier')); // il y a des années
    for (let i = 0; i < 2; i++) meals.push(meal(addDays('2022-01-05', i * 30), 'soir', 'osso buco')); // trop rare
    for (let i = 0; i < 10; i++) meals.push(meal(addDays('2026-06-01', i * 14), 'soir', 'curry')); // récent
    const list = forgottenDishes(buildIndex(meals), '2026-11-24', 'soir', { today: '2026-11-16' });
    expect(list.map((s) => s.label)).toEqual(['hachis parmentier']);
    expect(list[0].daysSince).toBeGreaterThan(3 * 365);
  });

  it('rapproche les événements des autres agendas des créneaux de repas', () => {
    const at = (date: string, h: number, m = 0) => new Date(...(date.split('-').map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number], h, m).getTime();
    const ev = (title: string, date: string, h1: number, m1: number, h2: number, m2: number) => ({ id: title, title, start: at(date, h1, m1), end: at(date, h2, m2), calendarName: 'x' });
    const events = [
      ev('Match', '2026-11-25', 21, 0, 22, 50), // pendant le dîner
      ev('Dîner chez Paul', '2026-11-28', 19, 30, 23, 0),
      ev('Réunion', '2026-11-26', 15, 0, 16, 0), // ni midi ni soir
      ev('Rendez-vous', '2026-11-26', 11, 30, 12, 15), // midi
      ev('Cours', '2026-11-27', 18, 0, 18, 55), // juste avant la fenêtre du soir (19 h)
    ];
    const days = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
    const map = overlapsBySlot(events, days, { midi: '13:00', soir: '20:00' });
    expect([...map.entries()].map(([k, v]) => `${k}:${v.map((e) => e.title).join(',')}`)).toEqual([
      '2026-11-25|soir:Match',
      '2026-11-26|midi:Rendez-vous',
      '2026-11-28|soir:Dîner chez Paul',
    ]);
    // Avec un dîner à 19 h, le cours de 18 h tombe dans la fenêtre.
    expect(overlapsBySlot(events, days, { midi: '13:00', soir: '19:00' }).get('2026-11-27|soir')?.[0].title).toBe('Cours');
    const [from, to] = slotWindow('2026-11-25', 'soir', '20:00');
    expect((to - from) / 60_000).toBe(210);
    expect(clock(at('2026-11-25', 21, 0))).toBe('21 h');
    expect(clock(at('2026-11-25', 19, 5))).toBe('19 h 05');
  });

  it('choisit les agendas affichés par défaut', () => {
    const cal = (id: string, selected = true) => ({ id, name: id, primary: false, selected });
    expect(shownByDefault(cal('me@gmail.com'), 'repas@group')).toBe(true);
    expect(shownByDefault(cal('repas@group'), 'repas@group')).toBe(false);
    expect(shownByDefault(cal('p#weeknum@group.v.calendar.google.com'), 'r')).toBe(false);
    expect(shownByDefault(cal('i_88#sunrise@group.v.calendar.google.com'), 'r')).toBe(false);
    expect(shownByDefault(cal('travail@group', false), 'r')).toBe(false);
  });

  it('met la semaine en texte', () => {
    const days = ['2026-11-23', '2026-11-24', '2026-11-25'];
    const bySlot = new Map([
      ['2026-11-23|soir', [meal('2026-11-23', 'soir', 'pizza')]],
      ['2026-11-24|midi', [meal('2026-11-24', 'midi', 'salade'), meal('2026-11-24', 'midi', 'soupe')]],
    ]);
    expect(weekText(days, ['soir'], bySlot, new Set(['2026-11-25|soir']))).toBe(
      ['Repas du 23 novembre au 25 novembre 2026', 'Lundi 23 novembre — soir : pizza', 'Mardi 24 novembre — midi : salade + soupe ; soir : à décider', 'Mercredi 25 novembre — soir : pas de repas'].join('\n'),
    );
  });

  it('calcule l’heure de début et de fin des repas créés', () => {
    expect(shiftTime('2026-11-23', '20:00', 0)).toBe('2026-11-23T20:00:00');
    expect(shiftTime('2026-11-23', '12:45', 60)).toBe('2026-11-23T13:45:00');
    expect(shiftTime('2026-11-23', '23:30', 60)).toBe('2026-11-24T00:30:00');
  });

  it('lit « Mes idées » et les propose avec le catalogue', () => {
    expect(parseIdeas('  poulet yassa \n\n# commentaire\nPoulet Yassa\nrisotto aux asperges')).toEqual(['poulet yassa', 'risotto aux asperges']);
    const ideas = surpriseIdeas(buildIndex([]), '2026-11-20', 24, '2026-11-16', undefined, ['gâteau de crêpes au saumon']);
    const own = ideas.find((i) => i.name === 'gâteau de crêpes au saumon')!;
    expect(own.own).toBe(true);
    // Une idée déjà mangée n'est plus proposée.
    const eaten = [meal('2026-10-01', 'soir', 'gâteau de crêpes au saumon')];
    expect(surpriseIdeas(buildIndex(eaten), '2026-11-20', 24, '2026-11-16', undefined, ['gâteau de crêpes au saumon']).some((i) => i.own)).toBe(false);
  });

  it('compte seulement les repas qui changent vraiment de nom', () => {
    const occ = groupByLabel([meal('2026-01-01', 'soir', 'chili'), meal('2026-01-02', 'soir', 'chili'), meal('2026-01-03', 'soir', 'Chili')]);
    expect(mealsToRename(occ, 'chili')).toBe(1);
    expect(mealsToRename(occ, 'Chili')).toBe(2);
    expect(mealsToRename(occ, 'chili con carne')).toBe(3);
  });

  it('repère les plats approchants souvent mangés tels quels', () => {
    const meals: Meal[] = [];
    for (let i = 0; i < 8; i++) meals.push(meal(addDays('2026-01-01', i), 'soir', 'poisson/purée'));
    for (let i = 0; i < 6; i++) meals.push(meal(addDays('2026-02-01', i), 'soir', 'poisson pané/purée'));
    meals.push(meal('2026-03-01', 'soir', 'poisson/purée/fromage'));
    const group = approximateGroups(meals, buildIndex(meals))[0];
    const byLabel = new Map(group.candidates.map((c) => [c.label, c]));
    expect(byLabel.get('poisson pané/purée')!.frequent).toBe(true);
    expect(byLabel.get('poisson/purée/fromage')!.frequent).toBe(false);
  });
});

describe('statistiques', async () => {
  const { newDishesByYear, onThisDay, seasonTop, topDishes, yearSummary } = await import('./stats');
  const meals: Meal[] = [
    meal('2024-11-18', 'soir', 'raclette'),
    meal('2025-11-18', 'midi', 'pizza'),
    meal('2025-11-18', 'soir', 'Raclette'),
    meal('2025-07-10', 'soir', 'salade niçoise'),
    meal('2026-01-05', 'soir', 'curry'),
    meal('2026-02-05', 'soir', 'curry'),
    meal('2026-03-05', 'soir', 'kebab'),
    meal('2026-11-10', 'soir', 'restes'),
    meal('2026-11-12', 'soir', 'raclette'),
    meal('2026-11-25', 'soir', 'raclette'), // prévu, pas encore mangé
  ];
  const index = buildIndex(meals);

  it('retrouve les repas du même jour les années passées', () => {
    expect(onThisDay(meals, '2026-11-18').map((y) => `${y.year}:${y.meals.map((m) => m.name).join('+')}`)).toEqual(['2025:pizza+Raclette', '2024:raclette']);
  });

  it('classe les plats les plus mangés, sans les restes ni les repas à venir', () => {
    // Douze mois glissants : le 18 novembre 2025 en est exclu, le repas prévu le 25 aussi.
    expect(topDishes(index, meals, '2026-11-18')).toEqual([
      { label: 'curry', count: 2 },
      { label: 'kebab', count: 1 },
      { label: 'raclette', count: 1 },
    ]);
    expect(seasonTop(index, meals, '2026-11-18').map((d) => d.label)).toEqual([index.byKey.get('raclette')!.label, 'pizza']);
  });

  it('compte les nouveaux plats par année et résume l’année', () => {
    expect(newDishesByYear(index, '2026-11-18')).toEqual([
      { year: 2024, count: 1 },
      { year: 2025, count: 2 },
      { year: 2026, count: 2 },
    ]);
    expect(yearSummary(index, meals, '2026-11-18', new Set(['kebab']))).toEqual({ year: '2026', meals: 5, dishes: 3, newDishes: 2, listed: 1 });
  });
});

describe('notes et favoris', () => {
  it('convertit une description HTML de Google en texte simple', async () => {
    const { noteFromDescription } = await import('./notes');
    expect(noteFromDescription('Trop salé<br>Recette : <a href="https://ex.fr/r">https://ex.fr/r</a>')).toBe('Trop salé\nRecette : https://ex.fr/r');
    expect(noteFromDescription('<ul><li>sel</li><li>poivre</li></ul>')).toBe('• sel\n• poivre');
    expect(noteFromDescription('<a href="https://ex.fr">la recette</a> &amp; plus')).toBe('la recette (https://ex.fr) & plus');
    expect(noteFromDescription('Les enfants ont adoré <3')).toBe('Les enfants ont adoré <3');
    expect(noteFromDescription(undefined)).toBe('');
  });

  it('repère les liens d’une note sans la ponctuation qui suit', async () => {
    const { splitLinks } = await import('./notes');
    expect(splitLinks('voir https://ex.fr/r. Bon')).toEqual([
      { text: 'voir ' },
      { text: 'https://ex.fr/r', href: 'https://ex.fr/r' },
      { text: '. Bon' },
    ]);
  });

  it('regroupe les notes par plat, les plus récentes d’abord', async () => {
    const { notesByDish } = await import('./notes');
    const meals: Meal[] = [
      { id: '1', date: '2025-01-01', slot: 'soir', name: 'Lasagnes', source: 'google', note: 'trop salé' },
      { id: '2', date: '2026-01-01', slot: 'soir', name: 'lasagne', source: 'google', note: 'parfait' },
      { id: '3', date: '2026-02-01', slot: 'soir', name: 'pizza', source: 'google' },
    ];
    const index = buildIndex(meals);
    const notes = notesByDish(meals, index);
    expect(notes.size).toBe(1);
    expect([...notes.values()][0].map((n) => n.note)).toEqual(['parfait', 'trop salé']);
  });

  it('les favoris montent dans le classement, la liste noire l’emporte', () => {
    const meals: Meal[] = [];
    for (let i = 0; i < 6; i++) meals.push({ id: `p${i}`, date: addDays('2026-01-05', i * 30), slot: 'soir', name: 'pizza', source: 'google' });
    for (let i = 0; i < 4; i++) meals.push({ id: `c${i}`, date: addDays('2026-01-06', i * 40), slot: 'soir', name: 'curry', source: 'google' });
    const index = buildIndex(meals);
    const plain = suggest(index, '2026-11-20', 'soir', { today: '2026-11-17' });
    const fav = suggest(index, '2026-11-20', 'soir', { today: '2026-11-17', favorites: new Set(['curry']) });
    const score = (list: Suggestion[], key: string) => list.find((s) => s.key === key)!.score;
    expect(score(fav, 'curry')).toBeCloseTo(score(plain, 'curry') * 2.5);
    expect(fav.find((s) => s.key === 'curry')!.reason.startsWith('⭐ favori')).toBe(true);
    const both = suggest(index, '2026-11-20', 'soir', { today: '2026-11-17', favorites: new Set(['curry']), blacklist: new Set(['curry']), includeBlacklist: true });
    expect(both.find((s) => s.key === 'curry')!.favorite).toBe(false);
  });

  it('retire une ligne de la liste sans toucher aux règles plus larges', async () => {
    const { removeFromList } = await import('./blacklist');
    expect(removeFromList('pâtes\nLasagnes\n/curry/', 'lasagnes')).toBe('pâtes\n/curry/');
  });

  it('garde les favoris enregistrés dans l’agenda', async () => {
    const { parseSettingsRecord } = await import('./settings');
    expect(parseSettingsRecord({ updatedAt: 1, settings: { favoritesText: 'curry' } })!.settings.favoritesText).toBe('curry');
    expect(parseSettingsRecord({ updatedAt: 1, settings: {} })!.settings.favoritesText).toBe('');
  });
});

describe('images des plats', () => {
  it('cherche la première partie du plat, sans les restes', async () => {
    const { imageQuery } = await import('./dishImages');
    expect(imageQuery('agneau/pates')).toBe('agneau');
    expect(imageQuery('restes de lasagnes')).toBe('lasagnes');
    expect(imageQuery('restes')).toBe('');
    expect(imageQuery('Poulet (four) + riz')).toBe('Poulet');
  });

  it('écarte les homonymies, les pages sans image et les résultats sans rapport', async () => {
    const { pickImage } = await import('./dishImages');
    const pages = [
      { title: 'Boursin', index: 1, thumbnail: { source: 'https://upload.wikimedia.org/b.jpg' } },
      { title: 'Escalope', index: 2, thumbnail: { source: 'https://upload.wikimedia.org/e.jpg' } },
    ];
    expect(pickImage(pages, 'escalopes', false)?.title).toBe('Escalope');
    expect(pickImage([{ title: 'Potée', pageprops: { disambiguation: '' }, thumbnail: { source: 'x' } }], 'potée', true)).toBeNull();
    expect(pickImage([{ title: 'Potée', missing: true }], 'potée', true)).toBeNull();
    expect(pickImage([{ title: 'Croque-monsieur', thumbnail: { source: 'c.jpg' } }], 'croque monsieur', true)?.url).toBe('c.jpg');
  });
});

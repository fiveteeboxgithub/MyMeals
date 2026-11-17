import { useMemo } from 'react';
import { longDate } from './lib/dates';
import { newDishesByYear, onThisDay, seasonTop, topDishes, yearSummary, type DishCount } from './lib/stats';
import type { DishIndex } from './lib/suggest';
import type { Meal } from './lib/types';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Barres horizontales : un plat par ligne, la valeur au bout (c'est un classement, lisible comme un tableau). */
function RankedBars({ items, label }: { items: DishCount[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (items.length === 0) return <p className="stats-empty">Pas encore assez de repas.</p>;
  return (
    <ol className="bars" aria-label={label}>
      {items.map((item) => (
        <li key={item.label} title={`${item.label} : ${item.count} fois`}>
          <span className="bar-label">{item.label}</span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar" style={{ width: `${(item.count / max) * 100}%` }} />
          </span>
          <span className="bar-value">{item.count}</span>
        </li>
      ))}
    </ol>
  );
}

/** Colonnes par année : valeurs au survol, seules la plus haute et l'année en cours sont écrites. */
function YearColumns({ items, current }: { items: { year: number; count: number }[]; current: number }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  const top = items.reduce((best, i) => (i.count > best.count ? i : best), items[0]);
  return (
    <>
      <div className="columns" role="img" aria-label={items.map((i) => `${i.year} : ${i.count}`).join(', ')}>
        {items.map((item) => (
          <div key={item.year} className="column" title={`${item.year} : ${item.count} nouveaux plats`}>
            <span className="column-value">{item === top || item.year === current ? item.count : ''}</span>
            <span className="column-bar" style={{ height: `${(item.count / max) * 100}%` }} />
            <span className="column-year">{String(item.year).slice(2)}</span>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>Nouveaux plats par année</caption>
        <tbody>
          {items.map((item) => (
            <tr key={item.year}>
              <th scope="row">{item.year}</th>
              <td>{item.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function StatsPage({ meals, dishes, today, blacklistKeys }: { meals: Meal[]; dishes: DishIndex; today: string; blacklistKeys: ReadonlySet<string> }) {
  const summary = useMemo(() => yearSummary(dishes, meals, today, blacklistKeys), [dishes, meals, today, blacklistKeys]);
  const past = useMemo(() => onThisDay(meals, today), [meals, today]);
  const top = useMemo(() => topDishes(dishes, meals, today), [dishes, meals, today]);
  const season = useMemo(() => seasonTop(dishes, meals, today), [dishes, meals, today]);
  const years = useMemo(() => newDishesByYear(dishes, today), [dishes, today]);
  const month = MONTHS[Number(today.slice(5, 7)) - 1];

  if (meals.length === 0) return <p className="stats-empty">Pas encore de repas : les statistiques apparaîtront avec ton historique.</p>;

  return (
    <div className="stats">
      <section>
        <h2>{summary.year}, jusqu'à aujourd'hui</h2>
        <div className="tiles">
          <p className="tile">
            <strong>{summary.meals}</strong> repas notés
          </p>
          <p className="tile">
            <strong>{summary.dishes}</strong> plats différents
          </p>
          <p className="tile">
            <strong>{summary.newDishes}</strong> nouveaux plats
          </p>
          {blacklistKeys.size > 0 && (
            <p className="tile">
              <strong>{summary.listed}</strong> repas de la liste noire
            </p>
          )}
        </div>
      </section>

      <section>
        <h2>Il y a un an ce jour-là</h2>
        {past.length === 0 ? (
          <p className="stats-empty">Rien de noté un {longDate(today).replace(/ \d{4}$/, '')} les années passées.</p>
        ) : (
          <ul className="on-this-day">
            {past.slice(0, 6).map(({ year, meals: list }) => (
              <li key={year}>
                <strong>{year}</strong> {list.map((m) => `${m.slot} : ${m.name}`).join(' · ')}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Les plus mangés ces 12 derniers mois</h2>
        <RankedBars items={top} label="Plats les plus mangés ces douze derniers mois" />
      </section>

      <section>
        <h2>De saison (autour de {month}, toutes années)</h2>
        <RankedBars items={season} label={`Plats les plus mangés autour de ${month}`} />
      </section>

      {years.length > 1 && (
        <section>
          <h2>Nouveaux plats goûtés par année</h2>
          <YearColumns items={years} current={Number(summary.year)} />
        </section>
      )}
    </div>
  );
}

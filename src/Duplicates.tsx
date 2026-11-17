import { useMemo, useState } from 'react';
import { longDate } from './lib/dates';
import { compileRegex, findOccurrences, hasQuery, mealsToRename, proposeLabel } from './lib/duplicates';
import type { DishIndex } from './lib/suggest';
import type { MealStore } from './lib/types';
import { ApproximateDuplicates } from './ApproximateDuplicates';
import { SuspectedDuplicates } from './SuspectedDuplicates';

const REGEX_KEY = 'mymeals.duplicates.regex';

function loadRegexMode(): boolean {
  try {
    return localStorage.getItem(REGEX_KEY) === '1';
  } catch {
    return false;
  }
}

/** Exemples affichés dans l'infobulle : [expression, ce qu'elle trouve]. */
const REGEX_EXAMPLES: [string, string][] = [
  ['^pates', 'commence par « pates » (ou « pâtes »)'],
  ['riz|quinoa', 'contient « riz » ou « quinoa »'],
  ['pat.*jacqu', '« pat… » puis « jacqu… », dans cet ordre'],
  ['(saumon|thon).*riz', 'saumon ou thon, puis riz'],
  ['^(?!.*sauce).*pates', 'contient « pates » mais pas « sauce »'],
  ['restes?$', 'finit par « reste » ou « restes »'],
  ['\\briz\\b', 'le mot « riz » entier (pas « rizotto »)'],
  ['[0-9]', 'contient un chiffre'],
];

/** Au-delà, la liste devient illisible : on demande de préciser la recherche. */
const MAX_ROWS = 300;

type Mode = 'suspects' | 'approx' | 'search';

/** Page des doublons : propositions toutes prêtes à confirmer, ou recherche à la main. */
export function DuplicatesPage({ store, dishes }: { store: MealStore; dishes: DishIndex }) {
  const [mode, setMode] = useState<Mode>('suspects');
  return (
    <>
      <div className="segmented" role="group" aria-label="Façon de trouver les doublons">
        <button aria-pressed={mode === 'suspects'} onClick={() => setMode('suspects')}>
          Suspectés
        </button>
        <button aria-pressed={mode === 'approx'} onClick={() => setMode('approx')}>
          Approchants
        </button>
        <button aria-pressed={mode === 'search'} onClick={() => setMode('search')}>
          Recherche
        </button>
      </div>
      {mode === 'suspects' && <SuspectedDuplicates store={store} dishes={dishes} />}
      {mode === 'approx' && <ApproximateDuplicates store={store} dishes={dishes} />}
      {mode === 'search' && <ManualSearch store={store} />}
    </>
  );
}

/** Recherche des libellés proches dans le calendrier, pour les fusionner en un seul. */
function ManualSearch({ store }: { store: MealStore }) {
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(loadRegexMode);
  const [tipOpen, setTipOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const regexError = regex ? compileRegex(query).error : undefined;
  const results = useMemo(() => findOccurrences(store.meals, query, { regex }), [store.meals, query, regex]);
  const shown = results.slice(0, MAX_ROWS);
  // Seuls comptent les libellés cochés qui figurent encore dans la liste.
  const checked = results.filter((r) => selected.has(r.label));
  const mealCount = checked.reduce((sum, r) => sum + r.count, 0);
  const searching = hasQuery(query, { regex }) && !regexError;

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setSelected(next);
    setMerging(false);
  }

  function selectAll(all: boolean) {
    setSelected(all ? new Set(shown.map((r) => r.label)) : new Set());
    setMerging(false);
  }

  async function confirm() {
    const name = label.trim();
    if (!name || busy) return;
    setBusy(true);
    const { renamed, failed } = await store.renameMeals(
      checked.flatMap((r) => r.ids),
      name,
    );
    setBusy(false);
    setMerging(false);
    setSelected(new Set());
    setResult(
      failed > 0
        ? `${renamed} ${renamed > 1 ? 'repas renommés' : 'repas renommé'} en « ${name} », ${failed} en échec : ils ont gardé leur nom.`
        : `${renamed} ${renamed > 1 ? 'repas renommés' : 'repas renommé'} en « ${name} ».`,
    );
  }

  return (
    <section className="duplicates" aria-label="Chercher les doublons">
      <p className="dup-intro">
        Cherche des mots ou des débuts de mots (par exemple « pat jacqu ») : seuls les libellés qui contiennent tous ces
        mots s'affichent. Avec l'option « Expression régulière », le texte saisi est un motif. Coche les libellés qui
        désignent le même plat, puis fusionne-les sous un seul nom.
      </p>
      <input
        type="search"
        className="dup-search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setResult('');
          setMerging(false);
        }}
        placeholder={regex ? 'Expression régulière, par exemple pat.*jacqu' : 'Mots ou débuts de mots, séparés par des espaces'}
        aria-label={regex ? 'Expression régulière' : 'Mots-clés'}
        aria-invalid={regexError ? true : undefined}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <div className="dup-options">
        <label className="switch">
          <input
            type="checkbox"
            checked={regex}
            onChange={(e) => {
              setRegex(e.target.checked);
              setResult('');
              setMerging(false);
              try {
                localStorage.setItem(REGEX_KEY, e.target.checked ? '1' : '0');
              } catch {
                // le réglage vaudra pour cette session
              }
            }}
          />
          <span className="switch-track" aria-hidden="true" />
          Expression régulière
        </label>
        <span className="tip">
          <button
            type="button"
            className="tip-btn"
            aria-label="Exemples d'expressions régulières"
            aria-describedby="regex-tip"
            aria-expanded={tipOpen}
            onClick={() => setTipOpen(!tipOpen)}
            onBlur={() => setTipOpen(false)}
          >
            ?
          </button>
          <span id="regex-tip" role="tooltip" className={`tip-panel${tipOpen ? ' open' : ''}`}>
            <strong>Exemples</strong> (sans tenir compte des majuscules ni des accents)
            <ul>
              {REGEX_EXAMPLES.map(([pattern, meaning]) => (
                <li key={pattern}>
                  <code>{pattern}</code> {meaning}
                </li>
              ))}
            </ul>
          </span>
        </span>
      </div>
      {regexError && (
        <p className="dup-error" role="alert">
          Expression régulière invalide : {regexError}
        </p>
      )}

      {result && (
        <p className="notice" role="status">
          {result}
          <button className="link" onClick={() => setResult('')} aria-label="Fermer le message">
            ✕
          </button>
        </p>
      )}

      {searching && (
        <>
          <div className="dup-toolbar">
            <span>
              {results.length === 0
                ? 'Aucun repas trouvé.'
                : `${results.length} libellé${results.length > 1 ? 's' : ''} · ${results.reduce((s, r) => s + r.count, 0)} repas`}
            </span>
            {results.length > 0 && (
              <>
                <button className="link" onClick={() => selectAll(true)}>
                  Tout cocher
                </button>
                <button className="link" onClick={() => selectAll(false)}>
                  Tout décocher
                </button>
              </>
            )}
          </div>

          <ul className="dup-list">
            {shown.map((r) => (
              <li key={r.label}>
                <label>
                  <input type="checkbox" checked={selected.has(r.label)} onChange={() => toggle(r.label)} />
                  <span className="dup-label">
                    {r.label}
                    <small>
                      {r.count} repas · dernier le {longDate(r.lastDate)}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {results.length > shown.length && (
            <p className="dup-more">
              {results.length - shown.length} autres libellés non affichés : précise ta recherche.
            </p>
          )}
        </>
      )}

      {searching && results.length > 0 && !merging && (
        <div className="dup-actions">
          <button
            className="ghost-btn primary"
            disabled={checked.length < 2}
            onClick={() => {
              setLabel(proposeLabel(checked));
              setMerging(true);
              setResult('');
            }}
          >
            Fusionner
          </button>
          <span className="dup-hint">
            {checked.length < 2
              ? 'Coche au moins deux libellés.'
              : `${checked.length} libellés cochés (${mealCount} repas).`}
          </span>
        </div>
      )}

      {merging && (
        <form
          className="dup-merge"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <label>
            Nom commun proposé
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </label>
          <p>
            Fusionner {checked.length} libellés ? {mealsToRename(checked, label)} repas seront renommés en{' '}
            <strong>« {label.trim() || '…'} »</strong>. Cela modifie les événements du calendrier.
          </p>
          <div className="dup-actions">
            <button type="submit" className="ghost-btn primary" disabled={!label.trim() || busy}>
              {busy ? 'Fusion en cours…' : 'Oui, fusionner'}
            </button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={() => setMerging(false)}>
              Non
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

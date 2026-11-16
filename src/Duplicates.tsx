import { useMemo, useState } from 'react';
import { longDate } from './lib/dates';
import { findOccurrences, parseKeywords, proposeLabel } from './lib/duplicates';
import type { MealStore } from './lib/types';

/** Au-delà, la liste devient illisible : on demande de préciser la recherche. */
const MAX_ROWS = 300;

/** Page de recherche des libellés proches dans le calendrier, pour les fusionner en un seul. */
export function DuplicatesPage({ store }: { store: MealStore }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const results = useMemo(() => findOccurrences(store.meals, query), [store.meals, query]);
  const shown = results.slice(0, MAX_ROWS);
  // Seuls comptent les libellés cochés qui figurent encore dans la liste.
  const checked = results.filter((r) => selected.has(r.label));
  const mealCount = checked.reduce((sum, r) => sum + r.count, 0);
  const searching = parseKeywords(query).length > 0;

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
        ? `${renamed} repas renommés en « ${name} », ${failed} en échec : ils ont gardé leur nom.`
        : `${renamed} repas renommés en « ${name} ».`,
    );
  }

  return (
    <section className="duplicates" aria-label="Chercher les doublons">
      <p className="dup-intro">
        Cherche des mots ou des débuts de mots (par exemple « pat jacqu ») : seuls les libellés qui contiennent tous ces
        mots s'affichent. Coche ceux qui désignent le même plat, puis fusionne-les sous un seul nom.
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
        placeholder="Mots ou débuts de mots, séparés par des espaces"
        aria-label="Mots-clés"
      />

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
            Fusionner {checked.length} libellés ? Les {mealCount} repas cochés seront renommés en{' '}
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

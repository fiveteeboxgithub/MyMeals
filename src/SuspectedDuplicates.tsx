import { useMemo, useState } from 'react';
import { longDate } from './lib/dates';
import { suspectedGroups, type SuspectedGroup } from './lib/duplicates';
import type { DishIndex } from './lib/suggest';
import type { MealStore } from './lib/types';

const IGNORED_KEY = 'mymeals.duplicates.ignored';
const PAGE_SIZE = 20;

function loadIgnored(): ReadonlySet<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(IGNORED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveIgnored(ignored: ReadonlySet<string>): void {
  try {
    localStorage.setItem(IGNORED_KEY, JSON.stringify([...ignored]));
  } catch {
    // le choix vaudra pour cette session
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Doublons que l'on soupçonne déjà : il ne reste qu'à confirmer (ou à écarter) chaque groupe. */
export function SuspectedDuplicates({ store, dishes }: { store: MealStore; dishes: DishIndex }) {
  const [ignored, setIgnored] = useState(loadIgnored);
  const [names, setNames] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [result, setResult] = useState('');

  const groups = useMemo(() => suspectedGroups(store.meals, dishes, ignored), [store.meals, dishes, ignored]);
  const total = groups.reduce((sum, g) => sum + g.mealCount, 0);
  const nameOf = (group: SuspectedGroup) => (names[group.signature] ?? group.proposal).trim();

  async function merge(group: SuspectedGroup) {
    const name = nameOf(group);
    if (!name || busy) return;
    setBusy(group.signature);
    setResult('');
    const { renamed, failed } = await store.renameMeals(
      group.occurrences.flatMap((o) => o.ids),
      name,
    );
    setBusy(null);
    setResult(
      failed > 0
        ? `${renamed} ${renamed > 1 ? 'repas renommés' : 'repas renommé'} en « ${name} », ${failed} en échec : ils ont gardé leur nom.`
        : `${renamed} ${renamed > 1 ? 'repas renommés' : 'repas renommé'} en « ${name} ».`,
    );
  }

  async function mergeAll() {
    if (busy) return;
    setConfirmAll(false);
    setResult('');
    const todo = [...groups];
    let renamed = 0;
    let failed = 0;
    let merged = 0;
    for (const group of todo) {
      const name = nameOf(group);
      if (!name) continue;
      setBusy(`all:${merged + 1}/${todo.length}`);
      const outcome = await store.renameMeals(
        group.occurrences.flatMap((o) => o.ids),
        name,
      );
      renamed += outcome.renamed;
      failed += outcome.failed;
      // Rien n'a pu être renommé (connexion expirée, refus de Google) : inutile d'insister.
      if (outcome.failed > 0 && outcome.renamed === 0) break;
      merged++;
    }
    setBusy(null);
    setResult(
      failed > 0
        ? `${plural(merged, 'groupe fusionné', 'groupes fusionnés')} (${renamed} ${renamed > 1 ? 'repas renommés' : 'repas renommé'}), puis arrêt : ${failed} ${failed > 1 ? "repas n'ont" : "repas n'a"} pas pu être renommé${failed > 1 ? 's' : ''}.`
        : `${plural(merged, 'groupe fusionné', 'groupes fusionnés')} : ${renamed} ${renamed > 1 ? 'repas renommés' : 'repas renommé'}.`,
    );
  }

  function ignore(group: SuspectedGroup) {
    const next = new Set(ignored).add(group.signature);
    setIgnored(next);
    saveIgnored(next);
  }

  function restoreIgnored() {
    setIgnored(new Set());
    saveIgnored(new Set());
  }

  return (
    <section className="duplicates" aria-label="Doublons suspectés">
      <p className="dup-intro">
        Ces libellés ont les mêmes mots, à une majuscule, un accent, un pluriel, l'ordre des mots ou une faute de frappe près.
        Vérifie le nom retenu, puis confirme la fusion, ou écarte le groupe si ce ne sont pas les mêmes plats.
      </p>

      {result && (
        <p className="notice" role="status">
          {result}
          <button className="link" onClick={() => setResult('')} aria-label="Fermer le message">
            ✕
          </button>
        </p>
      )}

      {groups.length === 0 ? (
        <p className="dup-empty">
          {store.meals.length === 0 ? "Aucun repas pour l'instant." : 'Aucun doublon évident trouvé.'}
          {ignored.size > 0 && (
            <>
              {' '}
              <button className="link" onClick={restoreIgnored}>
                Réafficher les {ignored.size} groupes écartés
              </button>
            </>
          )}
        </p>
      ) : (
        <>
          <div className="dup-toolbar">
            <span>
              {plural(groups.length, 'groupe suspect', 'groupes suspects')} · {total} repas
            </span>
            {ignored.size > 0 && (
              <button className="link" onClick={restoreIgnored}>
                Réafficher les écartés ({ignored.size})
              </button>
            )}
          </div>

          {confirmAll ? (
            <div className="dup-merge">
              <p>
                Fusionner les <strong>{groups.length} groupes</strong> ({total} repas) sous le nom retenu pour chacun ? Cela
                modifie les événements du calendrier.
              </p>
              <div className="dup-actions">
                <button className="ghost-btn primary" onClick={() => void mergeAll()}>
                  Oui, tout fusionner
                </button>
                <button className="ghost-btn" onClick={() => setConfirmAll(false)}>
                  Non
                </button>
              </div>
            </div>
          ) : (
            groups.length > 1 && (
              <div className="dup-actions">
                <button className="ghost-btn" disabled={busy !== null} onClick={() => setConfirmAll(true)}>
                  Tout confirmer ({groups.length})
                </button>
                {busy?.startsWith('all:') && <span className="dup-hint">Fusion {busy.slice(4)}…</span>}
              </div>
            )
          )}

          <ul className="suspect-list">
            {groups.slice(0, visible).map((group) => (
              <li key={group.signature} className="suspect">
                <ul className="suspect-labels">
                  {group.occurrences.map((o) => (
                    <li key={o.label}>
                      <span className="dup-label">
                        {o.label}
                        <small>
                          {o.count} repas · dernier le {longDate(o.lastDate)}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="suspect-reason">Différence : {group.reasons.join(', ')}.</p>
                <label className="suspect-name">
                  Nom retenu
                  <input
                    type="text"
                    value={names[group.signature] ?? group.proposal}
                    onChange={(e) => setNames({ ...names, [group.signature]: e.target.value })}
                    disabled={busy !== null}
                  />
                </label>
                <div className="dup-actions">
                  <button
                    className="ghost-btn primary"
                    disabled={busy !== null || !nameOf(group)}
                    onClick={() => void merge(group)}
                  >
                    {busy === group.signature ? 'Fusion en cours…' : `Confirmer (${group.mealCount} repas)`}
                  </button>
                  <button className="ghost-btn" disabled={busy !== null} onClick={() => ignore(group)}>
                    Pas des doublons
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {groups.length > visible && (
            <div className="dup-actions">
              <button className="ghost-btn" onClick={() => setVisible(visible + PAGE_SIZE)}>
                Afficher {Math.min(PAGE_SIZE, groups.length - visible)} de plus ({groups.length - visible} restants)
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

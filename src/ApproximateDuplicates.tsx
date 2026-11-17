import { useMemo, useState } from 'react';
import { approximateGroups, prefersLowercase, applyInitialStyle, proposeLabel, type ApproxGroup } from './lib/duplicates';
import type { DishIndex } from './lib/suggest';
import type { MealStore } from './lib/types';

const IGNORED_KEY = 'mymeals.duplicates.ignoredApprox';
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

/**
 * Plats dont les mots sont inclus dans ceux d'un plat plus détaillé (« pâtes saumon », « pâtes saumon fumé »).
 * Moins sûr que les variantes d'écriture : rien n'est coché d'avance, on coche ce qui est bien le même plat.
 */
export function ApproximateDuplicates({ store, dishes }: { store: MealStore; dishes: DishIndex }) {
  const [ignored, setIgnored] = useState(loadIgnored);
  const [checked, setChecked] = useState<Record<string, ReadonlySet<string>>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState('');

  const groups = useMemo(() => approximateGroups(store.meals, dishes, ignored), [store.meals, dishes, ignored]);
  const lowercase = useMemo(() => prefersLowercase(store.meals), [store.meals]);

  const picked = (group: ApproxGroup) => group.candidates.filter((c) => checked[group.signature]?.has(c.label));
  const proposal = (group: ApproxGroup) => {
    const chosen = proposeLabel([...group.base, ...picked(group).flatMap((c) => c.occurrences)], lowercase);
    return applyInitialStyle(chosen, lowercase);
  };
  const nameOf = (group: ApproxGroup) => (edited[group.signature] ?? proposal(group)).trim();

  function toggle(group: ApproxGroup, label: string) {
    const next = new Set(checked[group.signature] ?? []);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setChecked({ ...checked, [group.signature]: next });
  }

  async function merge(group: ApproxGroup) {
    const name = nameOf(group);
    const chosen = picked(group);
    if (!name || chosen.length === 0 || busy) return;
    setBusy(group.signature);
    setResult('');
    const ids = [...group.base, ...chosen.flatMap((c) => c.occurrences)].flatMap((o) => o.ids);
    const { renamed, failed } = await store.renameMeals(ids, name);
    setBusy(null);
    setChecked({ ...checked, [group.signature]: new Set() });
    setResult(
      failed > 0
        ? `${renamed} ${renamed > 1 ? 'repas renommés' : 'repas renommé'} en « ${name} », ${failed} en échec : ils ont gardé leur nom.`
        : `${renamed} ${renamed > 1 ? 'repas renommés' : 'repas renommé'} en « ${name} ».`,
    );
  }

  function ignore(group: ApproxGroup) {
    const next = new Set(ignored).add(group.signature);
    setIgnored(next);
    saveIgnored(next);
  }

  function restoreIgnored() {
    setIgnored(new Set());
    saveIgnored(new Set());
  }

  return (
    <section className="duplicates" aria-label="Doublons approchants">
      <p className="dup-intro">
        Ici, un plat est contenu dans un autre plus détaillé : « pâtes saumon » et « pâtes saumon fumé » par exemple.
        C'est moins sûr que de simples variantes d'écriture, donc rien n'est coché : coche les plats qui sont bien le
        même, puis fusionne. Les plats qui ne diffèrent que par un mot d'habillage (« fumé », « maison »…) viennent
        en premier.
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
          {store.meals.length === 0 ? "Aucun repas pour l'instant." : 'Aucun plat approchant trouvé.'}
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
              {groups.length} {groups.length > 1 ? 'plats de base' : 'plat de base'} · {groups.reduce((n, g) => n + g.candidates.length, 0)} plats plus détaillés
            </span>
            {ignored.size > 0 && (
              <button className="link" onClick={restoreIgnored}>
                Réafficher les écartés ({ignored.size})
              </button>
            )}
          </div>

          <ul className="suspect-list">
            {groups.slice(0, visible).map((group) => {
              const chosen = picked(group);
              const mealCount = group.baseCount + chosen.reduce((n, c) => n + c.mealCount, 0);
              return (
                <li key={group.signature} className="suspect">
                  <p className="approx-base">
                    <strong>{group.label}</strong>
                    <small>
                      {group.baseCount} {group.baseCount > 1 ? 'repas' : 'repas'}
                    </small>
                  </p>
                  <p className="suspect-reason">Plus détaillés, avec les mêmes mots :</p>
                  <ul className="suspect-labels">
                    {group.candidates.map((candidate) => (
                      <li key={candidate.label}>
                        <label className="approx-candidate">
                          <input
                            type="checkbox"
                            checked={checked[group.signature]?.has(candidate.label) ?? false}
                            onChange={() => toggle(group, candidate.label)}
                            disabled={busy !== null}
                          />
                          <span className="dup-label">
                            {candidate.label}
                            <small>
                              {candidate.mealCount} repas · en plus : {candidate.shown.join(', ')}
                              {candidate.likely ? ' · probable' : ''}
                            </small>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {chosen.length > 0 && (
                    <label className="suspect-name">
                      Nom retenu
                      <input
                        type="text"
                        value={edited[group.signature] ?? proposal(group)}
                        onChange={(e) => setEdited({ ...edited, [group.signature]: e.target.value })}
                        disabled={busy !== null}
                      />
                    </label>
                  )}
                  <div className="dup-actions">
                    <button
                      className="ghost-btn primary"
                      disabled={busy !== null || chosen.length === 0 || !nameOf(group)}
                      onClick={() => void merge(group)}
                    >
                      {busy === group.signature
                        ? 'Fusion en cours…'
                        : chosen.length === 0
                          ? 'Coche au moins un plat'
                          : `Fusionner (${mealCount} repas)`}
                    </button>
                    <button className="ghost-btn" disabled={busy !== null} onClick={() => ignore(group)}>
                      Pas des doublons
                    </button>
                  </div>
                </li>
              );
            })}
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

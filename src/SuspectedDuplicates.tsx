import { useMemo, useState } from 'react';
import { longDate } from './lib/dates';
import { applyInitialStyle, mealsToRename, prefersLowercase, proposeLabel, suspectedGroups, type Occurrence, type SuspectedGroup } from './lib/duplicates';
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
const renamedText = (n: number) => `${n} ${n > 1 ? 'repas renommés' : 'repas renommé'}`;

/**
 * Doublons que l'on soupçonne déjà. Tous les libellés d'un groupe sont cochés d'avance : on décoche ceux
 * qui n'en font pas partie, puis on confirme. Seuls les libellés cochés sont renommés.
 */
export function SuspectedDuplicates({ store, dishes }: { store: MealStore; dishes: DishIndex }) {
  const [ignored, setIgnored] = useState(loadIgnored);
  // Libellés décochés, par groupe : tout est coché tant qu'on n'a rien décoché.
  const [unchecked, setUnchecked] = useState<Record<string, ReadonlySet<string>>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [result, setResult] = useState('');

  const groups = useMemo(() => suspectedGroups(store.meals, dishes, ignored), [store.meals, dishes, ignored]);
  const lowercase = useMemo(() => prefersLowercase(store.meals), [store.meals]);

  const pickedOf = (group: SuspectedGroup): Occurrence[] =>
    group.occurrences.filter((o) => !unchecked[group.signature]?.has(o.label));
  /** Nom proposé d'après les libellés cochés : le plus utilisé, écrit comme le reste du calendrier. */
  const proposalOf = (group: SuspectedGroup) => {
    const picked = pickedOf(group);
    return picked.length === 0 ? group.proposal : applyInitialStyle(proposeLabel(picked, lowercase), lowercase);
  };
  const nameOf = (group: SuspectedGroup) => (names[group.signature] ?? proposalOf(group)).trim();
  /** Y a-t-il quelque chose à renommer ? (un seul libellé coché, déjà au bon nom : non) */
  const changes = (group: SuspectedGroup) => pickedOf(group).some((o) => o.label !== nameOf(group));

  const total = groups.reduce((sum, g) => sum + g.mealCount, 0);
  const active = groups.filter((g) => pickedOf(g).length > 0 && nameOf(g) && changes(g));
  // Seuls les repas qui ne portent pas déjà le nom retenu changent vraiment.
  const activeMeals = active.reduce((sum, g) => sum + mealsToRename(pickedOf(g), nameOf(g)), 0);

  function toggle(group: SuspectedGroup, label: string) {
    const next = new Set(unchecked[group.signature] ?? []);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setUnchecked({ ...unchecked, [group.signature]: next });
  }

  function selectAll(group: SuspectedGroup, all: boolean) {
    setUnchecked({ ...unchecked, [group.signature]: all ? new Set() : new Set(group.occurrences.map((o) => o.label)) });
  }

  async function merge(group: SuspectedGroup) {
    const name = nameOf(group);
    const picked = pickedOf(group);
    if (!name || picked.length === 0 || busy) return;
    setBusy(group.signature);
    setResult('');
    const { renamed, failed } = await store.renameMeals(
      picked.flatMap((o) => o.ids),
      name,
    );
    setBusy(null);
    setResult(
      failed > 0
        ? `${renamedText(renamed)} en « ${name} », ${failed} en échec : ils ont gardé leur nom.`
        : `${renamedText(renamed)} en « ${name} ».`,
    );
  }

  async function mergeAll() {
    if (busy) return;
    setConfirmAll(false);
    setResult('');
    const todo = [...active];
    let renamed = 0;
    let failed = 0;
    let merged = 0;
    for (const group of todo) {
      setBusy(`all:${merged + 1}/${todo.length}`);
      const outcome = await store.renameMeals(
        pickedOf(group).flatMap((o) => o.ids),
        nameOf(group),
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
        ? `${plural(merged, 'groupe fusionné', 'groupes fusionnés')} (${renamedText(renamed)}), puis arrêt : ${failed} ${failed > 1 ? "repas n'ont" : "repas n'a"} pas pu être renommé${failed > 1 ? 's' : ''}.`
        : `${plural(merged, 'groupe fusionné', 'groupes fusionnés')} : ${renamedText(renamed)}.`,
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
        Tout est coché d'avance : décoche ce qui n'est pas le même plat, vérifie le nom retenu, puis confirme. Seuls les
        libellés cochés sont renommés.
      </p>

      {result && (
        <p className="notice" role="status">
          <span>{result}</span>
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
                Fusionner <strong>{plural(active.length, 'groupe', 'groupes')}</strong> ({activeMeals} repas à renommer) sous le nom
                retenu pour chacun ? Seuls les libellés cochés sont renommés. Cela modifie les événements du calendrier.
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
                <button className="ghost-btn" disabled={busy !== null || active.length === 0} onClick={() => setConfirmAll(true)}>
                  Tout confirmer ({active.length})
                </button>
                {busy?.startsWith('all:') && <span className="dup-hint">Fusion {busy.slice(4)}…</span>}
              </div>
            )
          )}

          <ul className="suspect-list">
            {groups.slice(0, visible).map((group) => {
              const picked = pickedOf(group);
              return (
                <li key={group.signature} className="suspect">
                  <div className="suspect-tools">
                    <button className="link" disabled={busy !== null || picked.length === group.occurrences.length} onClick={() => selectAll(group, true)}>
                      Tout cocher
                    </button>
                    <button className="link" disabled={busy !== null || picked.length === 0} onClick={() => selectAll(group, false)}>
                      Tout décocher
                    </button>
                  </div>
                  <ul className="suspect-labels">
                    {group.occurrences.map((o) => (
                      <li key={o.label}>
                        <label className="approx-candidate">
                          <input
                            type="checkbox"
                            checked={!unchecked[group.signature]?.has(o.label)}
                            onChange={() => toggle(group, o.label)}
                            disabled={busy !== null}
                          />
                          <span className="dup-label">
                            {o.label}
                            <small>
                              {o.count} repas · dernier le {longDate(o.lastDate)}
                            </small>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="suspect-reason">Différence : {group.reasons.join(', ')}.</p>
                  <label className="suspect-name">
                    Nom retenu
                    <input
                      type="text"
                      value={names[group.signature] ?? proposalOf(group)}
                      onChange={(e) => setNames({ ...names, [group.signature]: e.target.value })}
                      disabled={busy !== null}
                    />
                  </label>
                  <div className="dup-actions">
                    <button
                      className="ghost-btn primary"
                      disabled={busy !== null || picked.length === 0 || !nameOf(group) || !changes(group)}
                      onClick={() => void merge(group)}
                    >
                      {busy === group.signature
                        ? 'Fusion en cours…'
                        : picked.length === 0
                          ? 'Coche au moins un libellé'
                          : !changes(group)
                            ? 'Rien à changer'
                            : `Renommer ${mealsToRename(picked, nameOf(group))} repas`}
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

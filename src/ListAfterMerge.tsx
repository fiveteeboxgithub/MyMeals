import type { BlacklistOutcome } from './lib/types';

/** Case « après la fusion, mettre le nom retenu en liste noire ». */
export function ListAfterMerge({ name, checked, onChange, disabled }: { name: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className="list-after">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Ensuite, mettre « {name || '…'} » en liste noire
        <small>La liste noire cache tout plat dont le nom contient ce texte (les repas déjà mangés ne changent pas).</small>
      </span>
    </label>
  );
}

/** Phrase ajoutée au message de fin de fusion. */
export function listedMessage(name: string, outcome: BlacklistOutcome | null): string {
  if (outcome === null) return '';
  if (outcome === 'added') return ` « ${name} » est sur la liste noire.`;
  if (outcome === 'already') return ` « ${name} » était déjà sur la liste noire.`;
  return ` La liste noire est pleine : « ${name} » n'y a pas été ajouté.`;
}

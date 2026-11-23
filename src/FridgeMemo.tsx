import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { displayName } from './lib/people';
import { MAX_MEMO_CHARS, type Memo } from './lib/memos';
import type { MemoOutcome } from './lib/types';
import { useScrollLock } from './useScrollLock';

const shortDay = (at: number) => (at > 0 ? new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');

interface BoardProps {
  memos: Memo[];
  me?: string;
  /** Mémos en une rangée qui défile de côté (panneau du planning), sinon en grille (fenêtre). */
  row?: boolean;
  onAdd: (text: string) => Promise<MemoOutcome>;
  onEdit: (id: string, text: string) => Promise<MemoOutcome>;
  onRemove: (memo: Memo) => void;
}

/** Champ d'écriture et post-it (modifier, supprimer) : partagé par la fenêtre et le panneau du planning. */
export function MemoBoard({ memos, me, row, onAdd, onEdit, onRemove }: BoardProps) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  // Une écriture est en cours : on attend la confirmation de l'agenda avant de vider le champ.
  const [busy, setBusy] = useState(false);
  // Mémo en cours de modification.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const FAILED = "Pas enregistré : vérifie la connexion Google (reconnecte-toi si besoin). Ton texte est gardé.";

  async function submit() {
    if (busy) return;
    setBusy(true);
    const outcome = await onAdd(text);
    setBusy(false);
    if (outcome === 'full') setMessage('Le pense-bête est plein : supprime quelques mémos pour en ajouter.');
    else if (outcome === 'failed') setMessage(FAILED);
    else if (outcome === 'ok') {
      setText('');
      setMessage('');
    }
  }

  async function saveEdit() {
    if (!editing || busy) return;
    setBusy(true);
    const outcome = await onEdit(editing.id, editing.text);
    setBusy(false);
    if (outcome === 'full') setMessage('Pas assez de place pour ce texte : raccourcis-le ou supprime des mémos.');
    else if (outcome === 'failed') setMessage(FAILED);
    else if (outcome === 'ok') {
      setEditing(null);
      setMessage('');
    }
  }

  const form = (
    <form
      className="memo-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        type="text"
        value={text}
        maxLength={MAX_MEMO_CHARS}
        placeholder="Écrire un mémo…"
        aria-label="Nouveau mémo"
        enterKeyHint="send"
        onChange={(e) => {
          setText(e.target.value);
          setMessage('');
        }}
      />
      <button className="ghost-btn primary" type="submit" disabled={!text.trim() || busy}>
        <Icon name="plus" />
        Ajouter
      </button>
    </form>
  );

  const list =
    memos.length === 0 ? (
      <p className="memo-empty">Rien d'écrit pour l'instant.</p>
    ) : (
      <ul className={`memo-list${row ? ' row' : ''}`} aria-label="Mémos">
        {memos.map((memo) => (
          <li key={memo.id} className="postit">
            {editing?.id === memo.id ? (
              <div className="postit-edit">
                <textarea
                  value={editing.text}
                  rows={3}
                  maxLength={MAX_MEMO_CHARS}
                  autoFocus
                  aria-label="Modifier le mémo"
                  onChange={(e) => setEditing({ id: memo.id, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void saveEdit();
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                />
                <div className="postit-foot">
                  <button className="postit-btn" onClick={() => setEditing(null)}>
                    Annuler
                  </button>
                  <button className="postit-btn strong" onClick={() => void saveEdit()} disabled={!editing.text.trim() || busy}>
                    Enregistrer
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="postit-text">{memo.text}</p>
                <div className="postit-foot">
                  <small>
                    {[memo.by ? (memo.by === me ? 'toi' : displayName(memo.by)) : '', shortDay(memo.at)].filter(Boolean).join(' · ')}
                  </small>
                  <span className="postit-actions">
                    <button className="postit-del" onClick={() => setEditing({ id: memo.id, text: memo.text })} aria-label={`Modifier le mémo « ${memo.text} »`} title="Modifier ce mémo">
                      <Icon name="pencil" />
                    </button>
                    <button className="postit-del" onClick={() => onRemove(memo)} aria-label={`Supprimer le mémo « ${memo.text} »`} title="Supprimer ce mémo">
                      <Icon name="trash" />
                    </button>
                  </span>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    );

  return (
    <>
      {form}
      {message && (
        <p className="dup-error" role="alert">
          {message}
        </p>
      )}
      {list}
    </>
  );
}

/**
 * « Fridge memo » : un pense-bête partagé, comme les post-it sur un frigo. Texte libre (envies de plats, restes à
 * finir…). Chacun peut supprimer n'importe quel mémo. Ces mémos ne servent jamais à proposer un plat.
 */
export function FridgeMemo({ atTop, pinned, onTogglePin, onClose, syncedAt, onRefresh, ...board }: BoardProps & { atTop?: boolean; pinned: boolean; onTogglePin: () => void; onClose: () => void; syncedAt?: number; onRefresh?: () => void }) {
  useScrollLock();
  // À l'ouverture, on relit l'agenda : on voit tout de suite ce qu'un autre appareil vient d'écrire.
  useEffect(() => onRefresh?.(), [onRefresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`backdrop${atTop ? ' top' : ''}`} onClick={onClose}>
      <div className={`sheet memo-sheet${atTop ? ' at-top' : ''}`} role="dialog" aria-modal="true" aria-label="Fridge memo" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Fridge memo</h2>
          <span className="sheet-head-actions">
            <button
              className="act sm"
              onClick={onTogglePin}
              aria-pressed={pinned}
              title={pinned ? 'Les mémos sont affichés en tête du planning : touche pour les détacher' : 'Afficher toujours les mémos en tête du planning'}
            >
              <Icon name="pin" filled={pinned} />
              {pinned ? 'Épinglé' : 'Épingler'}
            </button>
            <button className="icon" onClick={onClose} aria-label="Fermer">
              ✕
            </button>
          </span>
        </div>
        <p className="memo-help">
          Un pense-bête pour tous : une envie de plat, un reste à finir… Chacun peut effacer les mémos des autres. Ils ne
          servent jamais à proposer un plat.
        </p>
        <MemoBoard {...board} />
        {onRefresh && (
          <p className="memo-sync">
            {syncedAt ? `Mis à jour à ${new Date(syncedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Pas encore synchronisé'}
            {' · '}
            <button className="link" onClick={onRefresh}>
              Actualiser
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

/** Les mémos toujours sous les yeux, en tête du planning (réglage « Toujours afficher les mémos »). */
export function MemoPanel(board: BoardProps) {
  return (
    <section className="memo-panel" aria-label="Fridge memo">
      <h2>
        Fridge memo
        {board.memos.length > 0 && <span className="memo-count">{board.memos.length}</span>}
      </h2>
      <MemoBoard {...board} row />
    </section>
  );
}

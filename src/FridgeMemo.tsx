import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { displayName } from './lib/people';
import { MAX_MEMO_CHARS, type Memo } from './lib/memos';
import { useScrollLock } from './useScrollLock';

const shortDay = (at: number) => (at > 0 ? new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');

interface BoardProps {
  memos: Memo[];
  me?: string;
  /** Mémos en une rangée qui défile de côté (panneau du planning), sinon en grille (fenêtre). */
  row?: boolean;
  onAdd: (text: string) => 'ok' | 'full' | 'empty';
  onEdit: (id: string, text: string) => 'ok' | 'full' | 'empty';
  onRemove: (memo: Memo) => void;
}

/** Champ d'écriture et post-it (modifier, supprimer) : partagé par la fenêtre et le panneau du planning. */
export function MemoBoard({ memos, me, row, onAdd, onEdit, onRemove }: BoardProps) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  // Mémo en cours de modification.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  function submit() {
    const outcome = onAdd(text);
    if (outcome === 'full') setMessage('Le pense-bête est plein : supprime quelques mémos pour en ajouter.');
    else if (outcome === 'ok') {
      setText('');
      setMessage('');
    }
  }

  function saveEdit() {
    if (!editing) return;
    const outcome = onEdit(editing.id, editing.text);
    if (outcome === 'full') setMessage('Pas assez de place pour ce texte : raccourcis-le ou supprime des mémos.');
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
        submit();
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
      <button className="ghost-btn primary" type="submit" disabled={!text.trim()}>
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
                      saveEdit();
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
                  <button className="postit-btn strong" onClick={saveEdit} disabled={!editing.text.trim()}>
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
export function FridgeMemo({ atTop, onClose, ...board }: BoardProps & { atTop?: boolean; onClose: () => void }) {
  useScrollLock();

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
          <button className="icon" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <p className="memo-help">
          Un pense-bête pour tous : une envie de plat, un reste à finir… Chacun peut effacer les mémos des autres. Ils ne
          servent jamais à proposer un plat.
        </p>
        <MemoBoard {...board} />
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

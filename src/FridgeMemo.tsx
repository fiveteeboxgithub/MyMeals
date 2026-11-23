import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { displayName } from './lib/people';
import { MAX_MEMO_CHARS, type Memo } from './lib/memos';
import { useScrollLock } from './useScrollLock';

interface MemoProps {
  memos: Memo[];
  me?: string;
  onAdd: (text: string) => 'ok' | 'full' | 'empty';
  onRemove: (memo: Memo) => void;
  onClose: () => void;
}

const shortDay = (at: number) => (at > 0 ? new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');

/**
 * « Fridge memo » : un pense-bête partagé, comme les post-it sur un frigo. Texte libre (envies de plats, restes à
 * finir…). Chacun peut supprimer n'importe quel mémo. Ces mémos ne servent jamais à proposer un plat.
 */
export function FridgeMemo({ memos, me, onAdd, onRemove, onClose }: MemoProps) {
  useScrollLock();
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit() {
    const outcome = onAdd(text);
    if (outcome === 'full') setMessage('Le pense-bête est plein : supprime quelques mémos pour en ajouter.');
    else if (outcome === 'ok') {
      setText('');
      setMessage('');
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet memo-sheet" role="dialog" aria-modal="true" aria-label="Fridge memo" onClick={(e) => e.stopPropagation()}>
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
        {message && (
          <p className="dup-error" role="alert">
            {message}
          </p>
        )}
        {memos.length === 0 ? (
          <p className="memo-empty">Rien d'écrit pour l'instant.</p>
        ) : (
          <ul className="memo-list" aria-label="Mémos">
            {memos.map((memo) => (
              <li key={memo.id} className="postit">
                <p className="postit-text">{memo.text}</p>
                <div className="postit-foot">
                  <small>
                    {[memo.by ? (memo.by === me ? 'toi' : displayName(memo.by)) : '', shortDay(memo.at)].filter(Boolean).join(' · ')}
                  </small>
                  <button className="postit-del" onClick={() => onRemove(memo)} aria-label={`Supprimer le mémo « ${memo.text} »`} title="Supprimer ce mémo">
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

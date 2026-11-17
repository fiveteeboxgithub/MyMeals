/** Message en haut de page, avec éventuellement une action (« Annuler »). */
export function Notice({ text, onClose, action }: { text: string; onClose: () => void; action?: { label: string; onClick: () => void } }) {
  return (
    <p className="notice" role="status">
      <span>
        {text}
        {action && (
          <>
            {' '}
            <button className="link" onClick={action.onClick}>
              {action.label}
            </button>
          </>
        )}
      </span>
      <button className="link" onClick={onClose} aria-label="Fermer le message">
        ✕
      </button>
    </p>
  );
}

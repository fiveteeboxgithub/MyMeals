/** Message en haut de page, avec éventuellement une action (« Annuler »). `floating` : bandeau fixe, au-dessus des fenêtres. */
export function Notice({ text, onClose, action, floating }: { text: string; onClose: () => void; action?: { label: string; onClick: () => void }; floating?: boolean }) {
  return (
    <p className={`notice${floating ? ' toast' : ''}`} role="status">
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

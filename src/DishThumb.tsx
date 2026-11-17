import { useState } from 'react';
import { useCustomImagesContext, validImageUrl } from './lib/customImages';
import { articleUrl, hideDishImage, imageKey, useDishImage } from './lib/dishImages';

/** Petite image d'un plat (image choisie, Wikipédia ou Openverse), ou rien s'il n'y en a pas. */
export function DishThumb({ name, enabled }: { name: string; enabled: boolean }) {
  const { images } = useCustomImagesContext();
  const image = useDishImage(name, enabled, images[imageKey(name)]);
  if (!image) return null;
  return <img className="dish-thumb" src={image.url} alt="" loading="lazy" referrerPolicy="no-referrer" />;
}

/** Image plus grande pour la fenêtre d'un créneau : sa source, « Pas la bonne image » et « Choisir une image ». */
export function DishPicture({ name, enabled }: { name: string; enabled: boolean }) {
  const { images, setImage } = useCustomImagesContext();
  const key = imageKey(name);
  const custom = images[key];
  const image = useDishImage(name, enabled, custom);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [broken, setBroken] = useState(false);
  if (!enabled || !key) return null;

  const valid = validImageUrl(draft);
  const save = () => {
    if (!valid) return;
    setImage(key, valid);
    setBroken(false);
    setEditing(false);
  };

  return (
    <figure className="dish-picture">
      {image && !broken && (
        <img src={image.url} alt={image.title} loading="lazy" referrerPolicy="no-referrer" onError={() => image.source === 'perso' && setBroken(true)} />
      )}
      <figcaption>
        {image?.source === 'perso' ? (
          <span>{broken ? "Ton image ne s'affiche pas : vérifie l'adresse." : 'Ton image'}</span>
        ) : (
          image && (
            <a href={articleUrl(image)} target="_blank" rel="noopener noreferrer">
              {image.source === 'openverse' ? `Openverse · ${image.credit || image.title}` : `Wikipédia · ${image.title}`}
            </a>
          )
        )}
        {image && image.source !== 'perso' && (
          <button className="link" onClick={() => hideDishImage(name)}>
            Pas la bonne image
          </button>
        )}
        {!editing && (
          <button
            className="link"
            onClick={() => {
              setDraft(custom ?? '');
              setEditing(true);
            }}
          >
            {custom ? 'Changer mon image' : '🖼️ Choisir une image'}
          </button>
        )}
        {custom && !editing && (
          <button className="link danger" onClick={() => setImage(key, null)}>
            Retirer mon image
          </button>
        )}
      </figcaption>
      {editing && (
        <div className="image-edit">
          <input
            type="url"
            value={draft}
            autoFocus
            inputMode="url"
            placeholder="https://… (adresse de l'image)"
            aria-label={`Adresse de l'image pour ${name}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <small>
            Sur la photo (site de recette, Google Images…), fais un clic droit ou un appui long, puis « Copier l'adresse de
            l'image ». L'adresse doit commencer par https://.
          </small>
          {draft.trim() && !valid && <small className="dup-error">Adresse non valable (https:// seulement).</small>}
          <div className="note-actions">
            <button className="ghost-btn primary" onClick={save} disabled={!valid}>
              Enregistrer
            </button>
            <button className="ghost-btn" onClick={() => setEditing(false)}>
              Annuler
            </button>
          </div>
        </div>
      )}
    </figure>
  );
}

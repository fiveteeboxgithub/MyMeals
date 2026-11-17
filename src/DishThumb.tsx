import { articleUrl, hideDishImage, useDishImage } from './lib/dishImages';

/** Petite image d'un plat (Wikipédia), ou rien s'il n'y en a pas. */
export function DishThumb({ name, enabled }: { name: string; enabled: boolean }) {
  const image = useDishImage(name, enabled);
  if (!image) return null;
  return <img className="dish-thumb" src={image.url} alt="" loading="lazy" referrerPolicy="no-referrer" />;
}

/** Image plus grande pour la fenêtre d'un créneau, avec sa source et « Pas la bonne image ». */
export function DishPicture({ name, enabled }: { name: string; enabled: boolean }) {
  const image = useDishImage(name, enabled);
  if (!image) return null;
  return (
    <figure className="dish-picture">
      <img src={image.url} alt={image.title} loading="lazy" referrerPolicy="no-referrer" />
      <figcaption>
        <a href={articleUrl(image)} target="_blank" rel="noopener noreferrer">
          Wikipédia · {image.title}
        </a>
        <button className="link" onClick={() => hideDishImage(name)}>
          Pas la bonne image
        </button>
      </figcaption>
    </figure>
  );
}

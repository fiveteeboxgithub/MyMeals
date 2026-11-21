import { Icon } from './Icons';
import { canLike, likeSummary, likeVisible, likedBy } from './lib/people';
import type { Meal } from './lib/types';

/**
 * Petit cœur discret sur la ligne d'un créneau. Cliquable pour ceux qui n'ont pas choisi le plat (J'aime / je
 * n'aime plus) ; pour celui qui l'a choisi, il montre seulement que quelqu'un l'aime.
 */
export function LikeMark({ meals, me, onToggle }: { meals: Meal[]; me: string | undefined; onToggle: (id: string) => void }) {
  if (!likeVisible(meals, me)) return null;
  const meal = meals[0];
  const liked = meals.some((m) => (m.likes?.length ?? 0) > 0);
  const summary = meals.map((m) => likeSummary(m, me)).filter(Boolean).join(' — ');
  if (meals.length === 1 && canLike(meal, me)) {
    const mine = likedBy(meal, me);
    return (
      <button
        className={`like-mark${liked ? ' on' : ''}`}
        onClick={() => onToggle(meal.id)}
        aria-pressed={mine}
        aria-label={mine ? "Je n'aime plus ce plat" : "J'aime ce plat"}
        title={`${summary}${summary ? ' — ' : ''}${mine ? "touche pour ne plus l'aimer" : "touche pour dire que tu l'aimes"}`}
      >
        <Icon name="heart" filled={liked} />
      </button>
    );
  }
  return (
    <span className="like-mark on static" role="img" aria-label={summary} title={summary}>
      <Icon name="heart" filled />
    </span>
  );
}

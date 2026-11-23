/**
 * Fridge memo : pense-bête partagé en texte libre. Chaque mémo est une propriété partagée de l'événement
 * spécial « fridge memo » de l'agenda (une propriété par mémo) : ajouter ou supprimer un mémo ne touche que
 * sa propre propriété, donc deux personnes qui écrivent en même temps ne s'écrasent jamais.
 */
export interface Memo {
  id: string;
  text: string;
  /** Adresse Google de l'auteur, si on la connaît. */
  by?: string;
  /** Date d'écriture (ms). */
  at: number;
}

export const MEMO_PREFIX = 'mmmemo_';
export const MAX_MEMO_CHARS = 200;
export const MAX_MEMOS = 40;
/** Total des textes stockés : l'ensemble doit tenir dans un événement Google (environ 8 000 caractères). */
export const MAX_MEMO_TOTAL = 6500;
/** Au-delà, un nouveau mémo réutilise la propriété d'un mémo supprimé (Google limite le nombre de propriétés). */
export const REUSE_FREE_AFTER = 100;

export const memoKey = (id: string): string => `${MEMO_PREFIX}${id}`;

export function encodeMemo(memo: Pick<Memo, 'text' | 'by' | 'at'>): string {
  return JSON.stringify({ t: memo.text, ...(memo.by ? { b: memo.by } : {}), a: memo.at });
}

/** Lit les mémos dans les propriétés partagées de l'événement ; `free` : propriétés vidées (mémos supprimés). */
export function parseMemos(shared: Record<string, string> | undefined): { memos: Memo[]; free: string[] } {
  const memos: Memo[] = [];
  const free: string[] = [];
  for (const [key, value] of Object.entries(shared ?? {})) {
    if (!key.startsWith(MEMO_PREFIX)) continue;
    const id = key.slice(MEMO_PREFIX.length);
    if (!value) {
      free.push(id);
      continue;
    }
    try {
      const parsed = JSON.parse(value) as { t?: unknown; b?: unknown; a?: unknown };
      const text = typeof parsed.t === 'string' ? parsed.t.trim().slice(0, MAX_MEMO_CHARS) : '';
      if (!text) continue;
      memos.push({
        id,
        text,
        ...(typeof parsed.b === 'string' && parsed.b ? { by: parsed.b.toLowerCase() } : {}),
        at: typeof parsed.a === 'number' && Number.isFinite(parsed.a) ? parsed.a : 0,
      });
    } catch {
      // propriété illisible (modifiée à la main) : ignorée
    }
  }
  // Les plus récents d'abord.
  return { memos: memos.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)), free: free.sort() };
}

export function newMemoId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Reste-t-il de la place pour ce mémo ? */
export function memoRoom(memos: Memo[], text: string): 'ok' | 'full' {
  if (memos.length >= MAX_MEMOS) return 'full';
  const total = memos.reduce((sum, m) => sum + encodeMemo(m).length, 0);
  return total + encodeMemo({ text, at: Date.now() }).length > MAX_MEMO_TOTAL ? 'full' : 'ok';
}

/** Identifiant à utiliser pour un nouveau mémo : celui d'un mémo supprimé s'il y en a beaucoup, sinon un neuf. */
export function pickMemoId(free: string[]): { id: string; reused: boolean } {
  if (free.length > REUSE_FREE_AFTER) return { id: free[Math.floor(Math.random() * free.length)], reused: true };
  return { id: newMemoId(), reused: false };
}

/** Couleurs de l'application. Chaque thème fixe toutes les teintes pour que le texte reste lisible. */
export interface ThemeVars {
  bg: string;
  card: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  accentSoft: string;
  /** Couleur du texte posé sur l'accent (boutons pleins). */
  onAccent: string;
  danger: string;
  dark: boolean;
}

export interface Theme {
  id: string;
  label: string;
  /** null : l'apparence suit celle de l'appareil (clair ou sombre). */
  vars: ThemeVars | null;
}

const LIGHT_TEXT = { text: '#1f2a24', muted: '#56615b', onAccent: '#ffffff', danger: '#b3402e', dark: false };

export const THEMES: Theme[] = [
  { id: 'auto', label: 'Auto', vars: null },
  { id: 'creme', label: 'Crème', vars: { bg: '#f6f5f1', card: '#ffffff', line: '#e2e0d8', accent: '#2f6f4f', accentSoft: '#e4f0e9', ...LIGHT_TEXT } },
  { id: 'blanc', label: 'Blanc', vars: { bg: '#ffffff', card: '#f7f7f5', line: '#e4e4e0', accent: '#2f6f4f', accentSoft: '#e4f0e9', ...LIGHT_TEXT } },
  { id: 'menthe', label: 'Menthe', vars: { bg: '#e3f1ea', card: '#ffffff', line: '#c7dccf', accent: '#2f6f4f', accentSoft: '#cfe6d9', ...LIGHT_TEXT } },
  { id: 'ciel', label: 'Ciel', vars: { bg: '#e4eef9', card: '#ffffff', line: '#c9d9ea', accent: '#2b5f93', accentSoft: '#d0e1f3', ...LIGHT_TEXT } },
  { id: 'rose', label: 'Rose', vars: { bg: '#fbe9ed', card: '#ffffff', line: '#ecd0d7', accent: '#a23552', accentSoft: '#f5d6de', ...LIGHT_TEXT } },
  { id: 'sable', label: 'Sable', vars: { bg: '#f0e6d6', card: '#fffdf8', line: '#dfd0b8', accent: '#865519', accentSoft: '#ead9bb', ...LIGHT_TEXT } },
  { id: 'ardoise', label: 'Ardoise', vars: { bg: '#e6e9ed', card: '#ffffff', line: '#cdd3da', accent: '#3b5778', accentSoft: '#d3dbe5', ...LIGHT_TEXT } },
  {
    id: 'nuit',
    label: 'Nuit',
    vars: { bg: '#151a17', card: '#1f2622', text: '#e8ece9', muted: '#a3aea7', line: '#323b36', accent: '#7cc49d', accentSoft: '#24352c', onAccent: '#1f2622', danger: '#ef8a78', dark: true },
  },
  {
    id: 'minuit',
    label: 'Minuit',
    vars: { bg: '#0f1724', card: '#17212f', text: '#e6ebf2', muted: '#9fabbb', line: '#27344a', accent: '#8ab4f8', accentSoft: '#1d2d45', onAccent: '#17212f', danger: '#f0907f', dark: true },
  },
];

export interface ThemeChoice {
  id: string;
  /** Couleur libre (#rrggbb), quand `id` vaut « custom ». */
  custom?: string;
}

export const DEFAULT_THEME: ThemeChoice = { id: 'auto' };

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xf6f5f1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Mélange deux couleurs : 0 donne `a`, 1 donne `b`. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [parseHex(a), parseHex(b)];
  return toHex([0, 1, 2].map((i) => x[i] * (1 - t) + y[i] * t) as [number, number, number]);
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste entre deux couleurs (de 1 à 21 ; 4,5 est le minimum conseillé pour du texte). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Premier candidat assez contrasté avec le fond et avec les cartes, sinon le plus contrasté des deux. */
function readable(candidates: string[], backgrounds: string[], minimum = 4.5): string {
  const worst = (c: string) => Math.min(...backgrounds.map((bg) => contrast(c, bg)));
  return candidates.find((c) => worst(c) >= minimum) ?? [...candidates].sort((a, b) => worst(b) - worst(a))[0];
}

/**
 * Thème construit autour d'une couleur de fond libre. Le texte est clair ou foncé selon ce
 * qui contraste le mieux ; le noir ou le blanc purs ne servent qu'en dernier recours (gris moyens).
 */
export function themeFromColor(color: string): ThemeVars {
  const bg = toHex(parseHex(color));
  const dark = contrast('#ffffff', bg) > contrast('#000000', bg);
  if (dark) {
    const card = mix(bg, '#ffffff', 0.08);
    const accent = readable(['#8fd1ab', '#b5e3c9', '#e0f5e9', '#ffffff'], [bg, card]);
    return {
      bg,
      card,
      text: readable(['#eef1f4', '#ffffff'], [bg, card]),
      muted: readable(['#b4bcc4', '#d5dadf', '#ffffff'], [bg, card]),
      line: mix(bg, '#ffffff', 0.16),
      accent,
      accentSoft: mix(accent, bg, 0.82),
      onAccent: readable(['#0b1a12', '#000000'], [accent]),
      danger: '#f29a8a',
      dark: true,
    };
  }
  const card = mix(bg, '#ffffff', 0.75);
  const accent = readable(['#2a6646', '#1d4a31', '#0f2e1d', '#000000'], [bg, card]);
  return {
    bg,
    card,
    text: readable(['#1b1f23', '#000000'], [bg, card]),
    muted: readable(['#46505a', '#2a3138', '#000000'], [bg, card]),
    line: mix(bg, '#000000', 0.12),
    accent,
    accentSoft: mix(accent, bg, 0.86),
    onAccent: readable(['#ffffff', '#000000'], [accent]),
    danger: '#a53a29',
    dark: false,
  };
}

export function resolveTheme(choice: ThemeChoice): ThemeVars | null {
  if (choice.id === 'custom' && choice.custom) return themeFromColor(choice.custom);
  return THEMES.find((t) => t.id === choice.id)?.vars ?? null;
}

const STORAGE_KEY = 'mymeals.theme';

export function loadTheme(): ThemeChoice {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as ThemeChoice | null;
    if (parsed?.id === 'custom' && typeof parsed.custom === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.custom)) return parsed;
    if (parsed && THEMES.some((t) => t.id === parsed.id)) return { id: parsed.id };
  } catch {
    // réglage illisible : on garde le thème par défaut
  }
  return DEFAULT_THEME;
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // le choix vaudra pour cette session
  }
}

const CSS_NAMES: Record<Exclude<keyof ThemeVars, 'dark'>, string> = {
  bg: '--bg',
  card: '--card',
  text: '--text',
  muted: '--muted',
  line: '--line',
  accent: '--accent',
  accentSoft: '--accent-soft',
  onAccent: '--on-accent',
  danger: '--danger',
};

/** Applique un thème à la page. « Auto » retire les couleurs imposées : la feuille de style reprend la main. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  const vars = resolveTheme(choice);
  for (const [key, name] of Object.entries(CSS_NAMES)) {
    if (vars) root.style.setProperty(name, vars[key as keyof typeof CSS_NAMES]);
    else root.style.removeProperty(name);
  }
  if (vars) root.style.setProperty('color-scheme', vars.dark ? 'dark' : 'light');
  else root.style.removeProperty('color-scheme');
  const background = vars?.bg ?? getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background || '#2f6f4f');
}

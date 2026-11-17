import { useEffect, useRef, useState } from 'react';
import { THEMES, applyTheme, loadTheme, resolveTheme, saveTheme, themeFromColor, type ThemeChoice } from './lib/theme';

const CUSTOM_DEFAULT = '#e9efe9';

function swatchBackground(id: string): string {
  const vars = THEMES.find((t) => t.id === id)?.vars;
  return vars ? vars.bg : 'linear-gradient(135deg, #f6f5f1 50%, #151a17 50%)';
}

/** Bouton « palette » qui ouvre le choix de la couleur de fond. */
export function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice>(loadTheme);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  function choose(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
    saveTheme(next);
  }

  // Le panneau se ferme quand on touche ailleurs ou qu'on appuie sur Échap.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const customColor = choice.id === 'custom' && choice.custom ? choice.custom : CUSTOM_DEFAULT;
  const customBackground = resolveTheme({ id: 'custom', custom: customColor })?.bg ?? customColor;

  return (
    <div className="palette" ref={root}>
      <button
        className="icon-btn"
        aria-label="Couleur de fond"
        aria-expanded={open}
        aria-haspopup="true"
        title="Couleur de fond"
        onClick={() => setOpen(!open)}
      >
        🎨
      </button>
      {open && (
        <div className="palette-panel" role="group" aria-label="Couleur de fond">
          <ul>
            {THEMES.map((theme) => (
              <li key={theme.id}>
                <button
                  className="swatch"
                  style={{ background: swatchBackground(theme.id) }}
                  aria-pressed={choice.id === theme.id}
                  aria-label={theme.label}
                  onClick={() => choose({ id: theme.id })}
                />
                <span>{theme.label}</span>
              </li>
            ))}
            <li>
              <label
                className="swatch custom"
                style={{ background: customBackground }}
                data-selected={choice.id === 'custom' ? 'true' : undefined}
              >
                <input
                  type="color"
                  value={customColor}
                  aria-label="Couleur libre"
                  onChange={(e) => choose({ id: 'custom', custom: e.target.value })}
                />
                <span aria-hidden="true">+</span>
              </label>
              <span>Libre</span>
            </li>
          </ul>
          {choice.id === 'custom' && (
            <p className="palette-note">
              Texte {themeFromColor(customColor).dark ? 'clair' : 'foncé'}, choisi pour rester lisible sur cette couleur.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

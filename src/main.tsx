import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, loadTheme } from './lib/theme';
import './styles.css';

// Avant le premier affichage, pour ne pas voir flasher l'ancienne couleur.
applyTheme(loadTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Application installable et utilisable hors connexion (seulement dans la version publiée).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // sans service worker, l'application marche normalement en ligne
    });
  });
}

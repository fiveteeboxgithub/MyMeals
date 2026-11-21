import { useEffect } from 'react';

let locks = 0;
let savedScroll = 0;

/**
 * Fige la page derrière une fenêtre ouverte : glisser le doigt (ou la molette) dans la fenêtre ne fait plus
 * défiler la semaine qui est dessous. La position est restaurée à la fermeture.
 */
export function useScrollLock(): void {
  useEffect(() => {
    const body = document.body;
    if (locks++ === 0) {
      savedScroll = window.scrollY;
      body.style.position = 'fixed';
      body.style.top = `-${savedScroll}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
    }
    return () => {
      if (--locks > 0) return;
      body.style.position = '';
      body.style.top = '';
      body.style.left = '';
      body.style.right = '';
      body.style.width = '';
      window.scrollTo(0, savedScroll);
    };
  }, []);
}

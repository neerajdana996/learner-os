import { useEffect, useRef } from 'react';

/**
 * Reveals a section as it scrolls into view.
 *
 * The element rests **visible** and JS opts into the animation, rather than the
 * other way round. A page that parks its content at `opacity: 0` waiting for an
 * observer shows nothing at all if the observer never runs — no JS, an old
 * browser, a crawler, or a print stylesheet — and this is the one page whose
 * whole job is being read by a stranger.
 *
 * `prefers-reduced-motion` is honoured here rather than left to the global rule
 * in `@learnos/ui/styles/animations`: that rule shortens durations, which would
 * still flash the element from hidden to shown. Here we simply never hide it.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') return;

    node.classList.add('is-pending');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.remove('is-pending');
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      },
      // Fires a little before the section reaches the fold, so the movement has
      // finished by the time it is being read rather than during.
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return ref;
}

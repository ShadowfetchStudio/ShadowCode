/** Motion the reader asked the system to reduce. */

export const prefersReducedMotion = () =>
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

/** How a script should scroll: "smooth", or "auto" (a jump) when the system
 * asks for reduced motion. The stylesheet's reduced-motion rule only sets
 * `scroll-behavior`, which a script's own `behavior: "smooth"` overrides,
 * so every smooth scroll in script asks here. */
export const scrollBehavior = (): ScrollBehavior =>
  prefersReducedMotion() ? "auto" : "smooth";

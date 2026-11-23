// Hover menus/popovers open on hover only when the user is really using a
// mouse; a finger (phones, tablets, touchscreen laptops) opens them on tap.
// Media queries alone get hybrid devices wrong, so also check the last input.
let lastPointer = 'mouse';
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);
  document.addEventListener('touchstart', () => { lastPointer = 'touch'; }, { capture: true, passive: true });
}

export const canHover = () => (
  typeof window !== 'undefined'
  && lastPointer === 'mouse'
  && !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
);

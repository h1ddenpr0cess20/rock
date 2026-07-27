/**
 * Keep the HUD above the on-screen keyboard.
 *
 * A `position: fixed` element sits at the bottom of the *layout* viewport,
 * which an on-screen keyboard does not shrink on iOS — so the composer ends up
 * underneath the keys the moment someone taps the text field. The gap between
 * the layout and visual viewports is exactly how far it needs to lift.
 *
 * Chrome handles this from the viewport meta (`interactive-widget`), in which
 * case the two viewports agree and this measures zero. Doing both is safe.
 */

export function trackKeyboardInset(root = document.documentElement) {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();

  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  };
}

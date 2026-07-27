/**
 * Strip the starter component's own chrome.
 *
 * <three-d-stage> ships an export toolbar (OBJ + GLB) and an orbit hint for
 * prototyping. Both live in its shadow root, which page CSS can't reach, so
 * they have to be turned off from script.
 *
 * TIMING IS LOAD-BEARING. Call this immediately after the module that defines
 * the element is imported and *before* awaiting `stage.ready`:
 *
 *   - `customElements.define()` upgrades the element synchronously, and the
 *     constructor builds the toolbar and the hint right then.
 *   - `stage.ready` doesn't resolve until three.js has downloaded and the
 *     renderer has booted — seconds, on a phone.
 *
 * Hiding them after the await leaves both visible for that whole window, which
 * is what the page used to do. Doing it here means it happens in the same task
 * as the upgrade, so there is no paint in between and nothing ever flashes.
 *
 * A stylesheet rather than inline styles, so it holds even if the component
 * rebuilds either element later. Drop this call to get the download buttons
 * back.
 */

const HIDDEN = '.toolbar, .note { display: none !important; }';

export function stripStageChrome(stage) {
  const style = document.createElement('style');
  style.textContent = HIDDEN;
  stage.shadowRoot.append(style);
  return stage;
}

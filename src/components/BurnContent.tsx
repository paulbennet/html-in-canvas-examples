import { useState } from 'react';

/**
 * The scene behind the Fire effect: four real, distinct buttons that the shader
 * addresses individually (it measures every `.burn__btn` box — see Fire.tsx).
 *
 * Each button carries live state on purpose. The whole claim of the Fire demo is
 * that a control can be visually engulfed in flame and still be a working
 * button, so every one of these must respond to clicks and keyboard focus while
 * burning. The changing labels are a second test: they resize the element, and
 * the flame silhouette has to follow within a frame.
 */
export default function BurnContent() {
  const [deploys, setDeploys] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [armed, setArmed] = useState(false);
  const [deleted, setDeleted] = useState(0);

  const reset = () => {
    setDeploys(0);
    setCancelled(false);
    setArmed(false);
    setDeleted(0);
  };

  return (
    <div className="burn">
      <div className="burn__head">
        <p className="burn__eyebrow">Everything is on fire</p>
        <h1 className="burn__title">Buttons that burn.</h1>
        <p className="burn__body">
          Each button is a live <code>&lt;button&gt;</code> element, laid out by the
          browser and sampled into a WebGL heat simulation. They smoulder on their
          own — hover one to fan it into a blaze, or tab through them. Click while
          engulfed: it still works.
        </p>
      </div>

      <div className="burn__grid">
        <button className="burn__btn burn__btn--primary" onClick={() => setDeploys((d) => d + 1)}>
          {deploys === 0 ? 'Deploy' : `Deployed ×${deploys}`}
        </button>

        <button className="burn__btn" onClick={() => setCancelled((c) => !c)}>
          {cancelled ? 'Cancelled' : 'Cancel'}
        </button>

        <button
          className="burn__btn burn__btn--danger"
          onClick={() => {
            if (armed) {
              setDeleted((n) => n + 1);
              setArmed(false);
            } else {
              setArmed(true);
            }
          }}
        >
          {armed ? 'Really delete?' : 'Delete everything'}
        </button>

        <button className="burn__btn burn__btn--icon" onClick={reset} aria-label="Reset all state">
          ↻
        </button>
      </div>

      <p className="burn__status" aria-live="polite">
        {deleted > 0
          ? `Deleted everything ${deleted}× — and the DOM is still alive.`
          : 'State updates beneath the flames. Try the keyboard: Tab, then Space.'}
      </p>
    </div>
  );
}

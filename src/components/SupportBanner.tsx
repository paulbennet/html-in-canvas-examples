/**
 * Shown when the HTML-in-Canvas API is unavailable. The effects gracefully
 * fall back to plain interactive DOM; this explains how to unlock the real
 * shader-driven rendering.
 */
export default function SupportBanner() {
  return (
    <div className="banner" role="status">
      <span className="banner__dot" aria-hidden="true" />
      <div className="banner__text">
        <strong>Fallback mode.</strong> Your browser doesn&rsquo;t expose the{' '}
        <code>HTML-in-Canvas</code> API, so the content below renders as plain DOM.
        To see the live shader effects, open in <strong>Chrome Canary&nbsp;149+</strong> and enable{' '}
        <code>chrome://flags/#canvas-draw-element</code>.
      </div>
    </div>
  );
}

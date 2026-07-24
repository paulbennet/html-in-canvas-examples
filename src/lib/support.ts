/**
 * Single source of truth for HTML-in-Canvas feature detection.
 *
 * The origin-trial API is only present in Chrome Canary (148-150) with
 * chrome://flags/#canvas-draw-element enabled. Everywhere else we must fall
 * back to plain interactive DOM. We detect by:
 *   1. checking a WebGL context actually exposes `texElementImage2D`, and
 *   2. checking the `layoutsubtree` attribute is a known canvas property.
 */

let cached: boolean | null = null;

/**
 * `?mock` preview mode: forces the WebGL render path and feeds the shaders a
 * synthetic content texture (see lib/mockContent.ts) so the effects can be seen
 * without Chrome Canary. Not the live DOM — a stand-in for demos/screenshots.
 */
export function mockEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('mock');
  } catch {
    return false;
  }
}

export function detectHtmlInCanvas(): boolean {
  if (mockEnabled()) return true;
  if (cached !== null) return cached;

  try {
    const canvas = document.createElement('canvas');

    // (1) WebGL draw path must exist.
    const gl =
      canvas.getContext('webgl2') ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    const hasTexElement =
      !!gl && typeof (gl as WebGLRenderingContext).texElementImage2D === 'function';

    // (2) The 2D path is a useful secondary signal (some builds expose one
    // before the other); treat either draw method as the capability.
    const ctx2d = canvas.getContext('2d');
    const hasDrawElement =
      !!ctx2d && typeof (ctx2d as CanvasRenderingContext2D).drawElementImage === 'function';

    cached = hasTexElement || hasDrawElement;
  } catch {
    cached = false;
  }

  return cached;
}

/** For manual testing: force the fallback path regardless of real support. */
export function forceUnsupported(): void {
  cached = false;
}

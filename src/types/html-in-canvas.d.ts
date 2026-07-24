/**
 * Ambient type declarations for Chrome's experimental HTML-in-Canvas API
 * (origin trial, Chrome 148-150). These are NOT in lib.dom.d.ts yet, so we
 * augment the relevant interfaces here. All members are optional because the
 * API may be absent at runtime — always feature-detect (see lib/support.ts).
 *
 * Ref: https://developer.chrome.com/blog/html-in-canvas-origin-trial
 */

interface CanvasRenderingContext2D {
  /**
   * Draws the current visual state of a live DOM element into the 2D canvas.
   * Returns a transform that should be written back to the element's
   * `style.transform` so DOM hit-testing stays aligned with what was drawn.
   */
  drawElementImage?(element: Element, x: number, y: number): DOMMatrix;

  /** Captures an element's image without drawing it (for manual compositing). */
  captureElementImage?(element: Element, options?: unknown): unknown;
}

interface WebGLRenderingContextBase {
  /**
   * Uploads a live DOM element's current visual state into the bound texture.
   *
   * Real origin-trial signature (Chrome 148-150, WebGL2): 3 args, where
   * `internalformat` must be a sized format — one of RGBA8, SRGB8_ALPHA8,
   * RGBA16F, or RGBA32F. (The Chrome blog's 6-arg example is stale.)
   */
  texElementImage2D?(target: GLenum, internalformat: GLint, element: Element): void;

  /**
   * Computes the transform mapping the element into screen space given a
   * screen-space transform (e.g. derived from a WebGL MVP matrix).
   */
  getElementTransform?(element: Element, screenSpaceTransform: DOMMatrix): DOMMatrix;
}

interface HTMLCanvasElement {
  /** Fires when nested (layoutsubtree) content needs to be repainted. */
  onpaint: ((this: HTMLCanvasElement, ev: Event) => unknown) | null;
}

interface GPUQueue {
  /** WebGPU path: copies a live element's image into a destination texture. */
  copyElementImageToTexture?(source: Element, destination: unknown): void;
}

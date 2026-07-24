import { useEffect, useRef, useState } from 'react';
import { bindQuad, createElementTexture, createGL, createProgram } from './webgl';
import { mockEnabled } from './support';
import { drawMockContent } from './mockContent';

/**
 * Per-frame state handed to an effect's `setUniforms` callback so it can push
 * its own uniforms on top of the standard set.
 */
export interface EffectFrame {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  /** Seconds since the effect mounted. */
  time: number;
  /** Pointer position in [0,1] UV space, origin top-left (matches v_uv). */
  mouse: [number, number];
  /** Whether a pointer button is currently held. */
  pointerDown: boolean;
  /** Canvas size in device pixels. */
  resolution: [number, number];
}

export interface UseElementTextureArgs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
  /** Effect fragment shader. Receives u_tex, u_resolution, u_mouse, u_time, u_pointerDown. */
  fragmentShader: string;
  /** Whether the HTML-in-Canvas API is available; when false the hook is inert. */
  supported: boolean;
  /** Optional hook to set effect-specific uniforms each frame. */
  setUniforms?: (frame: EffectFrame) => void;
  /** Called on pointer down with the UV position (for event-driven effects like Ripple). */
  onPointerDownUV?: (uv: [number, number], time: number) => void;
}

/**
 * Core of every effect. When supported, it:
 *   - marks the canvas with `layoutsubtree` so the browser lays out (but does
 *     not paint) the child content, keeping it interactive & accessible;
 *   - keeps the canvas sized to the device pixel box (DPR-correct);
 *   - runs a render loop that re-uploads the live content element into a GL
 *     texture via `texElementImage2D` and draws it through the effect shader.
 *
 * Interactivity is preserved for free: because the content is laid out at its
 * natural position and we draw it in-place across a fullscreen quad, pointer
 * events hit the real DOM underneath. (Displacement effects visually offset the
 * content from its hit target — an inherent, acceptable trade-off for demos.)
 */
export function useElementTexture({
  canvasRef,
  contentRef,
  fragmentShader,
  supported,
  setUniforms,
  onPointerDownUV,
}: UseElementTextureArgs): { error: string | null } {
  const [error, setError] = useState<string | null>(null);

  // Live interaction state kept in refs so the RAF loop reads current values
  // without re-subscribing.
  const mouse = useRef<[number, number]>([0.5, 0.5]);
  const pointerDown = useRef(false);

  useEffect(() => {
    if (!supported) return;
    const canvas = canvasRef.current;
    const content = contentRef.current;
    if (!canvas || !content) return;

    // Opt the canvas into laying out its subtree without painting it.
    canvas.setAttribute('layoutsubtree', '');

    let gl: WebGLRenderingContext;
    let program: WebGLProgram;
    let texture: WebGLTexture;
    try {
      gl = createGL(canvas);
      program = createProgram(gl, fragmentShader);
      texture = createElementTexture(gl);
      bindQuad(gl, program);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    // Mock preview: when the real draw method is missing but `?mock` is on, we
    // upload a synthetic content canvas instead of the live element.
    const useMock = typeof gl.texElementImage2D !== 'function' && mockEnabled();
    const mockCanvas = useMock ? document.createElement('canvas') : null;
    const mockCtx = mockCanvas?.getContext('2d') ?? null;
    const paintMock = () => {
      if (!mockCanvas || !mockCtx) return;
      if (mockCanvas.width !== canvas.width || mockCanvas.height !== canvas.height) {
        mockCanvas.width = canvas.width;
        mockCanvas.height = canvas.height;
        const scale = window.devicePixelRatio || 1;
        drawMockContent(mockCtx, canvas.width, canvas.height, scale);
      }
    };

    gl.useProgram(program);
    const uTex = gl.getUniformLocation(program, 'u_tex');
    const uRes = gl.getUniformLocation(program, 'u_resolution');
    const uMouse = gl.getUniformLocation(program, 'u_mouse');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uPointerDown = gl.getUniformLocation(program, 'u_pointerDown');

    // DPR-correct sizing via the device pixel content box (per the blog).
    const resize = (entry?: ResizeObserverEntry) => {
      const dpr = window.devicePixelRatio || 1;
      let w: number, h: number;
      const dpc = entry?.devicePixelContentBoxSize;
      if (dpc && dpc[0]) {
        w = dpc[0].inlineSize;
        h = dpc[0].blockSize;
      } else {
        const rect = canvas.getBoundingClientRect();
        w = Math.round(rect.width * dpr);
        h = Math.round(rect.height * dpr);
      }
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
    };
    resize();
    const ro = new ResizeObserver(([entry]) => resize(entry));
    ro.observe(canvas);

    // Pointer tracking (UV space, origin top-left to match v_uv).
    const toUV = (ev: PointerEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [(ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height];
    };
    const onMove = (ev: PointerEvent) => {
      mouse.current = toUV(ev);
    };
    const onDown = (ev: PointerEvent) => {
      pointerDown.current = true;
      const uv = toUV(ev);
      mouse.current = uv;
      onPointerDownUV?.(uv, (performance.now() - start) / 1000);
    };
    const onUp = () => {
      pointerDown.current = false;
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);

    const start = performance.now();
    let raf = 0;
    let disposed = false;

    // The real API can only sample an element that the browser has already
    // painted ("cached paint record"). So we upload on the `paint` event, not
    // every frame; the shader still redraws every frame using the cached
    // texture (needed for time/mouse-driven effects on static content).
    let needsUpload = true; // try an initial upload; retry until a record exists
    let uploaded = false; // have we ever successfully uploaded a texture?
    if (!useMock) {
      canvas.onpaint = () => {
        needsUpload = true;
      };
    }

    const render = () => {
      if (disposed) return;
      const time = (performance.now() - start) / 1000;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);

      if (useMock && mockCanvas) {
        paintMock();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mockCanvas);
        uploaded = true;
      } else if (needsUpload) {
        // Real origin-trial API: texElementImage2D(target, internalformat, element)
        // with a WebGL2 sized internalformat (RGBA8).
        const internalformat = (gl as WebGL2RenderingContext).RGBA8 ?? gl.RGBA;
        try {
          gl.texElementImage2D!(gl.TEXTURE_2D, internalformat, content);
          needsUpload = false;
          uploaded = true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Before the browser has painted the subtree there is no paint record
          // yet — that's expected; keep retrying without surfacing an error.
          if (!/cached paint record/i.test(msg)) {
            setError(msg);
            disposed = true;
            return;
          }
        }
      }

      // Nothing to draw until we've uploaded at least once.
      if (!uploaded) {
        raf = requestAnimationFrame(render);
        return;
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);

      // Standard uniforms.
      gl.uniform1i(uTex, 0);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uMouse, mouse.current[0], mouse.current[1]);
      gl.uniform1f(uTime, time);
      gl.uniform1f(uPointerDown, pointerDown.current ? 1 : 0);

      // Effect-specific uniforms.
      setUniforms?.({
        gl,
        program,
        time,
        mouse: mouse.current,
        pointerDown: pointerDown.current,
        resolution: [canvas.width, canvas.height],
      });

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.onpaint = null;
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      gl.deleteTexture(texture);
      gl.deleteProgram(program);
    };
    // fragmentShader identity changes only when the effect changes → full rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, fragmentShader]);

  return { error };
}
